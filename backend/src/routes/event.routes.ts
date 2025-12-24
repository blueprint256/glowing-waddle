import express, { Request, Response } from 'express';
import { Event, EventStatus, EventType } from '../models/Event';
import { Project } from '../models/Project';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canEditContent, canPublishEvent } from '../middleware/rbac';
import { validateEventCreation, validateMongoId } from '../middleware/validation';
import { logAudit, logEventPublished } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import mongoose from 'mongoose';

const router = express.Router();

/**
 * @route   POST /api/events
 * @desc    Create a new event
 * @access  Private (not Client)
 */
router.post('/', isAuthenticated, canEditContent, validateEventCreation, async (req: Request, res: Response) => {
  try {
    const { name, description, type, projectId, scheduledDate, assignedTo, content } = req.body;

    // Verify project exists and get hierarchy info
    const project = await Project.findById(projectId)
      .populate('campaignId');

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Check access permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || project.teamId.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    // Create event (inherit campaignId and teamId from project)
    const event = await Event.create({
      name,
      description,
      type: type || EventType.OTHER,
      projectId: new mongoose.Types.ObjectId(projectId),
      campaignId: project.campaignId,
      teamId: project.teamId,
      status: EventStatus.DRAFT,
      scheduledDate,
      assignedTo: assignedTo ? new mongoose.Types.ObjectId(assignedTo) : undefined,
      content,
      createdBy: req.user!._id
    });

    // Log event creation
    await logAudit({
      action: AuditAction.EVENT_CREATED,
      userId: req.user!._id,
      targetType: 'Event',
      targetId: event._id,
      metadata: { name, projectId },
      req
    });

    const populatedEvent = await Event.findById(event._id)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Event created successfully',
      event: populatedEvent
    });
  } catch (error: any) {
    console.error('Error creating event:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating event'
    });
  }
});

/**
 * @route   GET /api/events
 * @desc    Get all events (filtered by project/campaign/team)
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    // Filter by project if provided
    if (req.query.projectId) {
      query.projectId = req.query.projectId;
    }

    // Filter by campaign if provided
    if (req.query.campaignId) {
      query.campaignId = req.query.campaignId;
    }

    // Filter by status if provided
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Filter by assigned user
    if (req.query.assignedTo) {
      query.assignedTo = req.query.assignedTo;
    }

    // Non-admins can only see events from their team
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId) {
        return res.json({
          success: true,
          events: []
        });
      }
      query.teamId = req.user!.teamId;
    }

    const events = await Event.find(query)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName')
      .sort({ scheduledDate: 1, createdAt: -1 });

    res.json({
      success: true,
      events
    });
  } catch (error: any) {
    console.error('Error fetching events:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching events'
    });
  }
});

/**
 * @route   GET /api/events/:id
 * @desc    Get event by ID
 * @access  Private
 */
router.get('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('projectId', 'name status')
      .populate('campaignId', 'name')
      .populate('teamId', 'name')
      .populate('createdBy', 'firstName lastName email')
      .populate('assignedTo', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName');

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check access permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || event.teamId._id.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    res.json({
      success: true,
      event
    });
  } catch (error: any) {
    console.error('Error fetching event:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching event'
    });
  }
});

/**
 * @route   PUT /api/events/:id
 * @desc    Update event
 * @access  Private (not Client)
 */
router.put('/:id', isAuthenticated, canEditContent, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check access permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || event.teamId.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Designers can only edit events assigned to them
      if (req.user!.role === UserRole.DESIGNER) {
        if (!event.assignedTo || event.assignedTo.toString() !== req.user!._id.toString()) {
          return res.status(403).json({
            success: false,
            message: 'Designers can only edit events assigned to them'
          });
        }
      }
    }

    const oldData = { ...event.toObject() };
    const { name, description, type, status, scheduledDate, assignedTo, content } = req.body;

    // Update fields
    if (name) event.name = name;
    if (description !== undefined) event.description = description;
    if (type) event.type = type;
    if (status) event.status = status;
    if (scheduledDate !== undefined) event.scheduledDate = scheduledDate;
    if (assignedTo !== undefined) {
      event.assignedTo = assignedTo ? new mongoose.Types.ObjectId(assignedTo) : undefined;
    }
    if (content !== undefined) event.content = content;

    event.lastModifiedBy = req.user!._id;
    await event.save();

    // Log update
    await logAudit({
      action: AuditAction.EVENT_UPDATED,
      userId: req.user!._id,
      targetType: 'Event',
      targetId: event._id,
      changes: { old: oldData, new: event.toObject() },
      req
    });

    const updatedEvent = await Event.findById(event._id)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Event updated successfully',
      event: updatedEvent
    });
  } catch (error: any) {
    console.error('Error updating event:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating event'
    });
  }
});

/**
 * @route   POST /api/events/:id/publish
 * @desc    Publish event
 * @access  Private (System Admin, Hybrid, Marketer)
 */
router.post('/:id/publish', isAuthenticated, canPublishEvent, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if event is approved (if approval is required)
    if (event.status === EventStatus.REJECTED) {
      return res.status(400).json({
        success: false,
        message: 'Cannot publish rejected event'
      });
    }

    event.status = EventStatus.PUBLISHED;
    event.lastModifiedBy = req.user!._id;
    await event.save();

    // Log publish
    await logEventPublished(req.user!._id, event._id, req);

    const publishedEvent = await Event.findById(event._id)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Event published successfully',
      event: publishedEvent
    });
  } catch (error: any) {
    console.error('Error publishing event:', error);
    res.status(500).json({
      success: false,
      message: 'Error publishing event'
    });
  }
});

export default router;
