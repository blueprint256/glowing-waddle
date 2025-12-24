import express, { Request, Response } from 'express';
import { Comment } from '../models/Comment';
import { Event } from '../models/Event';
import { Project } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { validateCommentCreation, validateMongoId } from '../middleware/validation';
import mongoose from 'mongoose';

const router = express.Router();

/**
 * @route   POST /api/comments
 * @desc    Create a new comment
 * @access  Private
 */
router.post('/', isAuthenticated, validateCommentCreation, async (req: Request, res: Response) => {
  try {
    const { content, eventId, projectId, campaignId, mentions, parentCommentId } = req.body;

    // At least one target is required
    if (!eventId && !projectId && !campaignId) {
      return res.status(400).json({
        success: false,
        message: 'Comment must be attached to an event, project, or campaign'
      });
    }

    // Verify access to the target entity
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Check team access
      if (eventId) {
        const event = await Event.findById(eventId);
        if (!event || event.teamId.toString() !== req.user!.teamId.toString()) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      } else if (projectId) {
        const project = await Project.findById(projectId);
        if (!project || project.teamId.toString() !== req.user!.teamId.toString()) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      } else if (campaignId) {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign || campaign.teamId.toString() !== req.user!.teamId.toString()) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      }
    }

    // Create comment
    const comment = await Comment.create({
      content,
      eventId: eventId ? new mongoose.Types.ObjectId(eventId) : undefined,
      projectId: projectId ? new mongoose.Types.ObjectId(projectId) : undefined,
      campaignId: campaignId ? new mongoose.Types.ObjectId(campaignId) : undefined,
      authorId: req.user!._id,
      mentions: mentions ? mentions.map((id: string) => new mongoose.Types.ObjectId(id)) : [],
      parentCommentId: parentCommentId ? new mongoose.Types.ObjectId(parentCommentId) : undefined
    });

    const populatedComment = await Comment.findById(comment._id)
      .populate('authorId', 'firstName lastName email role')
      .populate('mentions', 'firstName lastName email')
      .populate('parentCommentId');

    res.status(201).json({
      success: true,
      message: 'Comment created successfully',
      comment: populatedComment
    });
  } catch (error: any) {
    console.error('Error creating comment:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating comment'
    });
  }
});

/**
 * @route   GET /api/comments
 * @desc    Get comments (filtered by event/project/campaign)
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    // Filter by entity
    if (req.query.eventId) {
      query.eventId = req.query.eventId;
    } else if (req.query.projectId) {
      query.projectId = req.query.projectId;
    } else if (req.query.campaignId) {
      query.campaignId = req.query.campaignId;
    }

    const comments = await Comment.find(query)
      .populate('authorId', 'firstName lastName email role')
      .populate('mentions', 'firstName lastName email')
      .populate('parentCommentId')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      comments
    });
  } catch (error: any) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching comments'
    });
  }
});

/**
 * @route   PUT /api/comments/:id
 * @desc    Update comment (author only)
 * @access  Private
 */
router.put('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required'
      });
    }

    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Only author or system admin can edit
    if (req.user!.role !== UserRole.SYSTEM_ADMIN &&
        comment.authorId.toString() !== req.user!._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the author can edit this comment'
      });
    }

    comment.content = content;
    comment.isEdited = true;
    await comment.save();

    const updatedComment = await Comment.findById(comment._id)
      .populate('authorId', 'firstName lastName email role');

    res.json({
      success: true,
      message: 'Comment updated successfully',
      comment: updatedComment
    });
  } catch (error: any) {
    console.error('Error updating comment:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating comment'
    });
  }
});

/**
 * @route   DELETE /api/comments/:id
 * @desc    Delete comment (author only or system admin)
 * @access  Private
 */
router.delete('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Only author or system admin can delete
    if (req.user!.role !== UserRole.SYSTEM_ADMIN &&
        comment.authorId.toString() !== req.user!._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the author can delete this comment'
      });
    }

    await Comment.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting comment:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting comment'
    });
  }
});

export default router;
