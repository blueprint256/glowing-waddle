import express, { Request, Response } from 'express';
import { Approval, ApprovalStatus } from '../models/Approval';
import { Event, EventStatus } from '../models/Event';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { validateApprovalRequest, validateMongoId } from '../middleware/validation';
import { logApprovalAction } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import mongoose from 'mongoose';

const router = express.Router();

/**
 * @route   POST /api/approvals
 * @desc    Request approval for an event
 * @access  Private
 */
router.post('/', isAuthenticated, validateApprovalRequest, async (req: Request, res: Response) => {
  try {
    const { eventId, reviewerId } = req.body;

    // Verify event exists and user has access
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check access
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || event.teamId.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    // Check if approval already exists
    const existingApproval = await Approval.findOne({
      eventId,
      reviewerId,
      status: ApprovalStatus.PENDING
    });

    if (existingApproval) {
      return res.status(400).json({
        success: false,
        message: 'Approval request already exists for this event and reviewer'
      });
    }

    // Create approval request
    const approval = await Approval.create({
      eventId: new mongoose.Types.ObjectId(eventId),
      requestedBy: req.user!._id,
      reviewerId: new mongoose.Types.ObjectId(reviewerId),
      status: ApprovalStatus.PENDING
    });

    // Update event status
    event.status = EventStatus.PENDING_APPROVAL;
    await event.save();

    // Log approval request
    await logApprovalAction(
      req.user!._id,
      event._id,
      AuditAction.APPROVAL_REQUESTED,
      undefined,
      req
    );

    const populatedApproval = await Approval.findById(approval._id)
      .populate('eventId', 'name type')
      .populate('requestedBy', 'firstName lastName email')
      .populate('reviewerId', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Approval request created successfully',
      approval: populatedApproval
    });
  } catch (error: any) {
    console.error('Error creating approval request:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating approval request'
    });
  }
});

/**
 * @route   GET /api/approvals
 * @desc    Get approvals (filtered by event or reviewer)
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    // Filter by event
    if (req.query.eventId) {
      query.eventId = req.query.eventId;
    }

    // Filter by reviewer
    if (req.query.reviewerId) {
      query.reviewerId = req.query.reviewerId;
    }

    // Filter by status
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Get approvals assigned to current user (if not admin)
    if (req.query.mine === 'true') {
      query.reviewerId = req.user!._id;
    }

    const approvals = await Approval.find(query)
      .populate('eventId', 'name type content')
      .populate('requestedBy', 'firstName lastName email')
      .populate('reviewerId', 'firstName lastName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      approvals
    });
  } catch (error: any) {
    console.error('Error fetching approvals:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching approvals'
    });
  }
});

/**
 * @route   PUT /api/approvals/:id/approve
 * @desc    Approve an event
 * @access  Private (Reviewer only)
 */
router.put('/:id/approve', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const { feedback } = req.body;

    const approval = await Approval.findById(req.params.id);
    if (!approval) {
      return res.status(404).json({
        success: false,
        message: 'Approval request not found'
      });
    }

    // Check if user is the reviewer or system admin
    if (req.user!.role !== UserRole.SYSTEM_ADMIN &&
        approval.reviewerId.toString() !== req.user!._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned reviewer can approve this request'
      });
    }

    // Update approval
    approval.status = ApprovalStatus.APPROVED;
    approval.feedback = feedback;
    approval.reviewedAt = new Date();
    await approval.save();

    // Update event status
    const event = await Event.findById(approval.eventId);
    if (event) {
      event.status = EventStatus.APPROVED;
      await event.save();
    }

    // Log approval
    await logApprovalAction(
      req.user!._id,
      approval.eventId,
      AuditAction.APPROVAL_GRANTED,
      feedback,
      req
    );

    const populatedApproval = await Approval.findById(approval._id)
      .populate('eventId', 'name type')
      .populate('requestedBy', 'firstName lastName')
      .populate('reviewerId', 'firstName lastName');

    res.json({
      success: true,
      message: 'Event approved successfully',
      approval: populatedApproval
    });
  } catch (error: any) {
    console.error('Error approving event:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving event'
    });
  }
});

/**
 * @route   PUT /api/approvals/:id/reject
 * @desc    Reject an event
 * @access  Private (Reviewer only)
 */
router.put('/:id/reject', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const { feedback } = req.body;

    if (!feedback) {
      return res.status(400).json({
        success: false,
        message: 'Feedback is required when rejecting'
      });
    }

    const approval = await Approval.findById(req.params.id);
    if (!approval) {
      return res.status(404).json({
        success: false,
        message: 'Approval request not found'
      });
    }

    // Check if user is the reviewer or system admin
    if (req.user!.role !== UserRole.SYSTEM_ADMIN &&
        approval.reviewerId.toString() !== req.user!._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned reviewer can reject this request'
      });
    }

    // Update approval
    approval.status = ApprovalStatus.REJECTED;
    approval.feedback = feedback;
    approval.reviewedAt = new Date();
    await approval.save();

    // Update event status
    const event = await Event.findById(approval.eventId);
    if (event) {
      event.status = EventStatus.REJECTED;
      await event.save();
    }

    // Log rejection
    await logApprovalAction(
      req.user!._id,
      approval.eventId,
      AuditAction.APPROVAL_REJECTED,
      feedback,
      req
    );

    const populatedApproval = await Approval.findById(approval._id)
      .populate('eventId', 'name type')
      .populate('requestedBy', 'firstName lastName')
      .populate('reviewerId', 'firstName lastName');

    res.json({
      success: true,
      message: 'Event rejected',
      approval: populatedApproval
    });
  } catch (error: any) {
    console.error('Error rejecting event:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting event'
    });
  }
});

export default router;
