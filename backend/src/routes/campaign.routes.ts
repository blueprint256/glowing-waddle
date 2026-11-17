import express, { Request, Response } from 'express';
import { onCampaignArchived } from '../services/lifecycle';
import { Campaign, CampaignStatus } from '../models/Campaign';
import { User, UserRole } from '../models/User';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { normalizePostStatus } from '../services/postStatus';
import { applyCampaignPlan, draftCampaignPlan, validatePlan, type PlanOptions } from '../services/campaignPlan';
import { aiErrorMessage } from '../services/postAI';
import { isAuthenticated } from '../middleware/auth';
import { canCreateCampaign } from '../middleware/rbac';
import { validateCampaignCreation, validateCampaignFields, validateMongoId } from '../middleware/validation';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { searchRegex } from '../utils/regex';
import { generateWithPrompt } from '../services/llmService';

const router = express.Router();

/**
 * @route   POST /api/campaigns
 * @desc    Create a new campaign
 * @access  Private (System Admin, Hybrid)
 */
router.post('/', isAuthenticated, canCreateCampaign, validateCampaignCreation, validateCampaignFields, async (req: Request, res: Response) => {
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
        : typeof req.query.status === 'string' ? req.query.status.split(',') : [];
      query.status = { $in: statuses };
    }

    // Filter by creator (System Admin only)
    if (req.query.createdBy && req.user!.role === UserRole.SYSTEM_ADMIN) {
      const creatorIds = Array.isArray(req.query.createdBy)
        ? req.query.createdBy
        : typeof req.query.createdBy === 'string' ? req.query.createdBy.split(',') : [];
      query.createdBy = { $in: creatorIds };
    }

    // Global search across campaign names and descriptions
    const searchPattern = searchRegex(req.query.search);
    if (searchPattern) {
      query.$or = [
        { name: searchPattern },
        { description: searchPattern }
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
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit as string) || 1000)); // Higher default for comprehensive views
    const skip = (page - 1) * limit;

    // Get total count for pagination metadata
    const total = await Campaign.countDocuments(query);

    const campaigns = await Campaign.find(query)
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // ?include=counts: posts by status and number of themes, for the campaign cards.
    let counts: Record<string, { posts: number; themes: number; byStatus: Record<string, number>; nextDay: Date | null }> | undefined;
    if (String(req.query.include || '').split(',').includes('counts') && campaigns.length) {
      const ids = campaigns.map((c) => c._id);
      const [byStatus, themes, next] = await Promise.all([
        Task.aggregate([{ $match: { campaignId: { $in: ids } } }, { $group: { _id: { c: '$campaignId', s: '$status' }, n: { $sum: 1 } } }]),
        Project.aggregate([{ $match: { campaignId: { $in: ids } } }, { $group: { _id: '$campaignId', n: { $sum: 1 } } }]),
        Task.aggregate([
          { $match: { campaignId: { $in: ids }, taskDate: { $gte: new Date(new Date().toISOString().slice(0, 10)) } } },
          { $group: { _id: '$campaignId', d: { $min: '$taskDate' } } }
        ])
      ]);
      counts = {};
      for (const c of campaigns) counts[String(c._id)] = { posts: 0, themes: 0, byStatus: {}, nextDay: null };
      for (const r of byStatus) {
        const e = counts[String(r._id.c)];
        if (!e) continue;
        const s = normalizePostStatus(r._id.s) || String(r._id.s);
        e.byStatus[s] = (e.byStatus[s] || 0) + r.n;
        e.posts += r.n;
      }
      for (const r of themes) if (counts[String(r._id)]) counts[String(r._id)].themes = r.n;
      for (const r of next) if (counts[String(r._id)]) counts[String(r._id)].nextDay = r.d;
    }

    res.json({
      success: true,
      campaigns,
      ...(counts ? { counts } : {}),
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
    // (createdBy may be null after population if the creator record no longer exists)
    if (req.user!.role === UserRole.HYBRID) {
      const ownerId = (campaign.createdBy as any)?._id ?? campaign.createdBy;
      if (!ownerId || ownerId.toString() !== req.user!._id.toString()) {
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
router.put('/:id', isAuthenticated, canCreateCampaign, validateMongoId('id'), validateCampaignFields, async (req: Request, res: Response) => {
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
    // Posts of an archived campaign that haven't gone out are cancelled (see services/lifecycle.ts).
    const { cancelledPosts } = await onCampaignArchived(campaign._id as any, req.user!._id as any);

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
      message: cancelledPosts ? `Campaign archived. ${cancelledPosts} scheduled post${cancelledPosts === 1 ? ' was' : 's were'} cancelled.` : 'Campaign archived successfully',
      cancelledPosts,
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
 * @route   PUT /api/campaigns/:id/unarchive
 * @desc    Restore an archived campaign (with ownership check for Hybrid Users)
 * @access  Private (System Admin, Hybrid)
 */
router.put('/:id/unarchive', isAuthenticated, canCreateCampaign, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    if (req.user!.role === UserRole.HYBRID && campaign.createdBy.toString() !== req.user!._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You can only restore campaigns you created'
      });
    }

    campaign.archived = false;
    await campaign.save();

    await logAudit({
      action: AuditAction.CAMPAIGN_UPDATED,
      userId: req.user!._id,
      targetType: 'Campaign',
      targetId: campaign._id,
      metadata: { archived: false },
      req
    });

    const restoredCampaign = await Campaign.findById(campaign._id)
      .populate('createdBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Campaign restored successfully',
      campaign: restoredCampaign
    });
  } catch (error: any) {
    console.error('Error restoring campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Error restoring campaign'
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
    // Posts of an archived campaign that haven't gone out are cancelled (see services/lifecycle.ts).
    const { cancelledPosts } = await onCampaignArchived(campaign._id as any, req.user!._id as any);

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
      message: cancelledPosts ? `Campaign archived. ${cancelledPosts} scheduled post${cancelledPosts === 1 ? ' was' : 's were'} cancelled.` : 'Campaign archived successfully',
      cancelledPosts
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
 * @desc    Generate campaign tasks using LLM with prompt compilation (Admin only)
 * @access  Private (System Admin only)
 */
router.post('/:id/generate-tasks', isAuthenticated, async (req: Request, res: Response) => {
  try {
    // CRITICAL: Only System Admins can generate tasks with AI
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Only System Administrators can generate content with AI'
      });
    }

    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // Get campaign creator to access their company info
    const campaignOwner = await User.findById(campaign.createdBy);
    if (!campaignOwner) {
      return res.status(404).json({
        success: false,
        message: 'Campaign owner not found'
      });
    }

    // Prepare parameters for prompt compilation
    const promptParams = {
      companyInfo: campaignOwner.companyInfo || {},
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

    try {
      // Generate content with OpenAI
      const result = await generateWithPrompt(promptName, promptParams, {
        userId: req.user!._id
      });

      res.json({
        success: true,
        message: 'Tasks generated successfully with AI',
        content: result.content,
        compiledPrompt: result.compiledPrompt,
        usage: result.usage,
        campaignId: campaign._id,
        campaignName: campaign.name
      });

      // Log the generation
      await logAudit({
        action: AuditAction.CAMPAIGN_UPDATED,
        userId: req.user!._id,
        targetType: 'Campaign',
        targetId: campaign._id,
        metadata: { action: 'generate_tasks_ai', promptName, tokens: result.usage.total_tokens },
        req
      });
    } catch (error: any) {
      console.error('Error generating tasks:', error);
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: `Prompt '${promptName}' not found. Please create it in Settings > Prompts first.`
        });
      } else if (error.message.includes('API key')) {
        return res.status(500).json({
          success: false,
          message: 'OpenAI API is not configured. Please contact your administrator.'
        });
      } else if (error.message.includes('rate limit')) {
        return res.status(429).json({
          success: false,
          message: error.message
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

/** The campaign, if this person may plan for it (owner, or a System Admin). Sends the error otherwise. */
async function campaignForPlanning(req: Request, res: Response) {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) {
    res.status(404).json({ success: false, message: 'Campaign not found' });
    return null;
  }
  if (req.user!.role !== UserRole.SYSTEM_ADMIN && campaign.createdBy.toString() !== req.user!._id.toString()) {
    res.status(403).json({ success: false, message: 'Access denied: You can only plan campaigns you created' });
    return null;
  }
  if (campaign.archived) {
    res.status(409).json({ success: false, message: 'This campaign is archived. Restore it to plan posts.' });
    return null;
  }
  return campaign;
}

const planOptions = (body: any): PlanOptions => ({
  notes: typeof body?.notes === 'string' ? body.notes : undefined,
  from: typeof body?.from === 'string' ? body.from : undefined,
  to: typeof body?.to === 'string' ? body.to : undefined,
  perWeek: body?.perWeek !== undefined && body?.perWeek !== null && body?.perWeek !== '' ? Number(body.perWeek) : undefined,
  command: typeof body?.command === 'string' && body.command.trim() ? body.command.trim() : undefined
});

/**
 * @route   POST /api/campaigns/:id/plan
 * @desc    Plan with AI, step 1: a draft of themes and posts to review. Nothing is saved.
 *          Body: { notes?, from?, to?, perWeek?, command? }
 * @access  Private (campaign owner or System Admin; AI on)
 */
router.post('/:id/plan', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const campaign = await campaignForPlanning(req, res);
    if (!campaign) return;
    const draft = await draftCampaignPlan(campaign, planOptions(req.body), req.user!._id as any);
    res.json({ success: true, ...draft });
  } catch (error: any) {
    console.error('Error planning campaign:', error);
    const { status, message } = aiErrorMessage(error, 'The AI couldn’t plan this campaign. Try again.');
    res.status(status).json({ success: false, message });
  }
});

/**
 * @route   POST /api/campaigns/:id/plan/apply
 * @desc    Plan with AI, step 2: creates the reviewed themes and posts. Body: { themes: PlanTheme[] }
 * @access  Private (campaign owner or System Admin)
 */
router.post('/:id/plan/apply', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const campaign = await campaignForPlanning(req, res);
    if (!campaign) return;
    const themes = validatePlan(req.body?.themes);
    const result = await applyCampaignPlan(campaign, themes, req.user!._id as any);
    await logAudit({
      action: AuditAction.CAMPAIGN_UPDATED,
      userId: req.user!._id,
      targetType: 'Campaign',
      targetId: campaign._id,
      metadata: { action: 'plan_with_ai', themes: result.themes.length, posts: result.postCount },
      req
    });
    const newThemes = result.themes.filter((t) => t.isNew).length;
    res.status(201).json({
      success: true,
      message: `Created ${result.postCount} post${result.postCount === 1 ? '' : 's'}${newThemes ? ` and ${newThemes} new theme${newThemes === 1 ? '' : 's'}` : ''}.`,
      ...result
    });
  } catch (error: any) {
    console.error('Error creating the plan:', error);
    const { status, message } = aiErrorMessage(error, 'Couldn’t create the posts. Try again.');
    res.status(status).json({ success: false, message });
  }
});

/**
 * @route   POST /api/campaigns/:id/generate
 * @desc    Plan with AI in one step (draft + create), for the connector's generate_campaign_content.
 *          Body: { command?, notes?, from?, to?, perWeek? }
 * @access  Private (campaign owner or System Admin; AI on)
 */
router.post('/:id/generate', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const campaign = await campaignForPlanning(req, res);
    if (!campaign) return;
    const draft = await draftCampaignPlan(campaign, planOptions(req.body), req.user!._id as any);
    const result = await applyCampaignPlan(campaign, draft.themes, req.user!._id as any);
    await logAudit({
      action: AuditAction.CAMPAIGN_UPDATED,
      userId: req.user!._id,
      targetType: 'Campaign',
      targetId: campaign._id,
      metadata: { action: 'generate_campaign_content', source: draft.source, themes: result.themes.length, posts: result.postCount },
      req
    });
    const projects = await Project.find({ _id: { $in: result.themes.map((t) => t.id) } });
    const order = new Map(result.themes.map((t, i) => [t.id, i]));
    projects.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
    res.json({
      success: true,
      message: `Created ${result.postCount} post${result.postCount === 1 ? '' : 's'} in ${result.themes.length} theme${result.themes.length === 1 ? '' : 's'}.`,
      projects,
      taskCounts: projects.map((p) => result.themes.find((t) => t.id === String(p._id))?.posts ?? 0),
      campaignId: campaign._id,
      campaignName: campaign.name
    });
  } catch (error: any) {
    console.error('Error in generate campaign:', error);
    const { status, message } = aiErrorMessage(error, 'The AI couldn’t plan this campaign. Try again.');
    res.status(status).json({ success: false, message });
  }
});

export default router;
