import express, { Request, Response } from 'express';
import { Campaign, CampaignStatus } from '../models/Campaign';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canCreateCampaign } from '../middleware/rbac';
import { validateCampaignCreation, validateMongoId } from '../middleware/validation';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';

const router = express.Router();

/**
 * @route   POST /api/campaigns
 * @desc    Create a new campaign
 * @access  Private (System Admin, Hybrid)
 */
router.post('/', isAuthenticated, canCreateCampaign, validateCampaignCreation, async (req: Request, res: Response) => {
  try {
    const { name, description, status, startDate, endDate, goals } = req.body;

    // Create campaign
    const campaign = await Campaign.create({
      name,
      description,
      status: status || CampaignStatus.DRAFT,
      startDate,
      endDate,
      goals,
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
      .populate('createdBy', 'firstName lastName');

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
 * @desc    Get all campaigns
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    // Filter archived campaigns unless explicitly requested
    if (req.query.includeArchived !== 'true') {
      query.archived = false;
    }

    // Optional status filter
    if (req.query.status) {
      query.status = req.query.status;
    }

    const campaigns = await Campaign.find(query)
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      campaigns
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
 * @desc    Get campaign by ID
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
 * @desc    Update campaign
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

    const oldData = { ...campaign.toObject() };
    const { name, description, status, startDate, endDate, goals } = req.body;

    // Update fields
    if (name) campaign.name = name;
    if (description !== undefined) campaign.description = description;
    if (status) campaign.status = status;
    if (startDate !== undefined) campaign.startDate = startDate;
    if (endDate !== undefined) campaign.endDate = endDate;
    if (goals !== undefined) campaign.goals = goals;

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
      .populate('createdBy', 'firstName lastName');

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
 * @desc    Archive campaign
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
      .populate('createdBy', 'firstName lastName');

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
 * @desc    Delete campaign (archive)
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

export default router;
