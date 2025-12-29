import express, { Request, Response } from 'express';
import { Campaign, CampaignStatus } from '../models/Campaign';
import { User, UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canCreateCampaign } from '../middleware/rbac';
import { validateCampaignCreation, validateMongoId } from '../middleware/validation';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { fetchAndCompilePrompt, generateWithPrompt } from '../services/llmService';

const router = express.Router();

/**
 * @route   POST /api/campaigns
 * @desc    Create a new campaign
 * @access  Private (System Admin, Hybrid)
 */
router.post('/', isAuthenticated, canCreateCampaign, validateCampaignCreation, async (req: Request, res: Response) => {
  try {
    const { name, description, status, startDate, endDate, goals, coreMessages, hashtags } = req.body;

    // Create campaign owned by the creator
    const campaign = await Campaign.create({
      name,
      description,
      status: status || CampaignStatus.DRAFT,
      startDate,
      endDate,
      goals,
      coreMessages,
      hashtags,
      createdBy: req.user!._id
    });

    // Log campaign creation
    await logAudit({
      action: AuditAction.CAMPAIGN_CREATED,
      userId: req.user!._id,
      targetType: 'Campaign',
      targetId: campaign._id,
      metadata: { name },
      req
    });

    const populatedCampaign = await Campaign.findById(campaign._id)
      .populate('createdBy', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Campaign created successfully',
      campaign: populatedCampaign
    });
  } catch (error: any) {
    console.error('Error creating campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating campaign'
    });
  }
});

/**
 * @route   GET /api/campaigns
 * @desc    Get all campaigns (System Admin) or owned campaigns (Hybrid User) with pagination and comprehensive filtering
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    // CRITICAL: Hybrid Users can ONLY see campaigns they created
    if (req.user!.role === UserRole.HYBRID) {
      query.createdBy = req.user!._id;
    }
    // System Admins see all campaigns (no filter)

    // Filter archived campaigns unless explicitly requested
    if (req.query.includeArchived !== 'true') {
      query.archived = false;
    }

    // Optional status filter (supports multi-select)
    if (req.query.status) {
      const statuses = Array.isArray(req.query.status)
        ? req.query.status
        : req.query.status.split(',');
      query.status = { $in: statuses };
    }

    // Filter by creator (System Admin only)
    if (req.query.createdBy && req.user!.role === UserRole.SYSTEM_ADMIN) {
      const creatorIds = Array.isArray(req.query.createdBy)
        ? req.query.createdBy
        : req.query.createdBy.split(',');
      query.createdBy = { $in: creatorIds };
    }

    // Global search across campaign names and descriptions
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search as string, 'i');
      query.$or = [
        { name: searchRegex },
        { description: searchRegex }
      ];
    }

    // Filter by date range (startDate or endDate)
    if (req.query.dateFrom || req.query.dateTo) {
      const dateQuery: any = {};
      if (req.query.dateFrom) {
        dateQuery.$gte = new Date(req.query.dateFrom as string);
      }
      if (req.query.dateTo) {
        dateQuery.$lte = new Date(req.query.dateTo as string);
      }
      // Match campaigns where either startDate or endDate falls in range
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { startDate: dateQuery },
          { endDate: dateQuery }
        ]
      });
    }

    // Pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 1000; // Higher default for comprehensive views
    const skip = (page - 1) * limit;

    // Get total count for pagination metadata
    const total = await Campaign.countDocuments(query);

    const campaigns = await Campaign.find(query)
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      campaigns,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching campaigns'
    });
  }
});

/**
 * @route   GET /api/campaigns/:id
 * @desc    Get campaign by ID (with ownership check for Hybrid Users)
 * @access  Private
 */
router.get('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email');

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // CRITICAL: Hybrid Users can ONLY access campaigns they own
    if (req.user!.role === UserRole.HYBRID) {
      if (campaign.createdBy._id.toString() !== req.user!._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only view campaigns you created'
        });
      }
    }

    res.json({
      success: true,
      campaign
    });
  } catch (error: any) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching campaign'
    });
  }
});

/**
 * @route   PUT /api/campaigns/:id
 * @desc    Update campaign (with ownership check for Hybrid Users)
 * @access  Private (System Admin, Hybrid)
 */
router.put('/:id', isAuthenticated, canCreateCampaign, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // CRITICAL: Hybrid Users can ONLY update campaigns they own
    if (req.user!.role === UserRole.HYBRID) {
      if (campaign.createdBy.toString() !== req.user!._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only update campaigns you created'
        });
      }
    }

    const oldData = { ...campaign.toObject() };
    const { name, description, status, startDate, endDate, goals, coreMessages, hashtags } = req.body;

    // Update fields
    if (name) campaign.name = name;
    if (description !== undefined) campaign.description = description;
    if (status) campaign.status = status;
    if (startDate !== undefined) campaign.startDate = startDate;
    if (endDate !== undefined) campaign.endDate = endDate;
    if (goals !== undefined) campaign.goals = goals;
    if (coreMessages !== undefined) campaign.coreMessages = coreMessages;
    if (hashtags !== undefined) campaign.hashtags = hashtags;

    await campaign.save();

    // Log update
    await logAudit({
      action: AuditAction.CAMPAIGN_UPDATED,
      userId: req.user!._id,
      targetType: 'Campaign',
      targetId: campaign._id,
      changes: { old: oldData, new: campaign.toObject() },
      req
    });

    const updatedCampaign = await Campaign.findById(campaign._id)
      .populate('createdBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Campaign updated successfully',
      campaign: updatedCampaign
    });
  } catch (error: any) {
    console.error('Error updating campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating campaign'
    });
  }
});

/**
 * @route   PUT /api/campaigns/:id/archive
 * @desc    Archive campaign (with ownership check for Hybrid Users)
 * @access  Private (System Admin, Hybrid)
 */
router.put('/:id/archive', isAuthenticated, canCreateCampaign, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // CRITICAL: Hybrid Users can ONLY archive campaigns they own
    if (req.user!.role === UserRole.HYBRID) {
      if (campaign.createdBy.toString() !== req.user!._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only archive campaigns you created'
        });
      }
    }

    // Archive campaign
    campaign.archived = true;
    await campaign.save();

    // Log archive action
    await logAudit({
      action: AuditAction.CAMPAIGN_UPDATED,
      userId: req.user!._id,
      targetType: 'Campaign',
      targetId: campaign._id,
      metadata: { archived: true },
      req
    });

    const archivedCampaign = await Campaign.findById(campaign._id)
      .populate('createdBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Campaign archived successfully',
      campaign: archivedCampaign
    });
  } catch (error: any) {
    console.error('Error archiving campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Error archiving campaign'
    });
  }
});

/**
 * @route   DELETE /api/campaigns/:id
 * @desc    Delete campaign (with ownership check for Hybrid Users)
 * @access  Private (System Admin, Hybrid)
 */
router.delete('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const allowedRoles = [UserRole.SYSTEM_ADMIN, UserRole.HYBRID];
    if (!allowedRoles.includes(req.user!.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // CRITICAL: Hybrid Users can ONLY delete campaigns they own
    if (req.user!.role === UserRole.HYBRID) {
      if (campaign.createdBy.toString() !== req.user!._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only delete campaigns you created'
        });
      }
    }

    // Archive campaign (soft delete)
    campaign.archived = true;
    await campaign.save();

    // Log deletion
    await logAudit({
      action: AuditAction.CAMPAIGN_DELETED,
      userId: req.user!._id,
      targetType: 'Campaign',
      targetId: campaign._id,
      req
    });

    res.json({
      success: true,
      message: 'Campaign archived successfully'
    });
  } catch (error: any) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting campaign'
    });
  }
});

/**
 * @route   POST /api/campaigns/:id/generate-tasks
 * @desc    Generate campaign tasks using LLM with prompt compilation
 * @access  Private (System Admin, Hybrid - owner only)
 */
router.post('/:id/generate-tasks', isAuthenticated, canCreateCampaign, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email companyInfo');

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // CRITICAL: Hybrid Users can ONLY generate tasks for campaigns they own
    if (req.user!.role === UserRole.HYBRID) {
      if (campaign.createdBy._id.toString() !== req.user!._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only generate tasks for campaigns you created'
        });
      }
    }

    // Get the full user object to access company info
    const user = await User.findById(req.user!._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prepare parameters for prompt compilation
    const promptParams = {
      companyInfo: user.companyInfo || {},
      campaignDetails: {
        name: campaign.name,
        description: campaign.description,
        goals: campaign.goals,
        coreMessages: campaign.coreMessages,
        hashtags: campaign.hashtags,
        startDate: campaign.startDate,
        endDate: campaign.endDate
      }
    };

    // Fetch and compile the prompt
    // By default, look for a prompt named "Generate Campaign Tasks"
    // Frontend can pass a custom prompt name in the request body
    const promptName = req.body.promptName || 'Generate Campaign Tasks';

    let generatedContent: string;
    try {
      // Compile the super prompt with dynamic data
      const compiledPrompt = await fetchAndCompilePrompt(promptName, promptParams);

      // For now, return the compiled prompt
      // In a real implementation with LLM API integration, uncomment the line below:
      // generatedContent = await generateWithPrompt(promptName, promptParams);
      generatedContent = compiledPrompt;

      res.json({
        success: true,
        message: 'Tasks generated successfully',
        compiledPrompt,
        generatedContent,
        note: 'This is a demonstration. Integrate with actual LLM API (OpenAI, Anthropic, etc.) to generate real content.'
      });

      // Log the generation
      await logAudit({
        action: AuditAction.CAMPAIGN_UPDATED,
        userId: req.user!._id,
        targetType: 'Campaign',
        targetId: campaign._id,
        metadata: { action: 'generate_tasks', promptName },
        req
      });
    } catch (error: any) {
      console.error('Error generating tasks:', error);
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: `Prompt '${promptName}' not found. Please create it in Settings > Prompts first.`
        });
      }
      throw error;
    }
  } catch (error: any) {
    console.error('Error in generate-tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating tasks',
      error: error.message
    });
  }
});

export default router;
