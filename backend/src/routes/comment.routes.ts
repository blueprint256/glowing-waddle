import express, { Request, Response } from 'express';
import { Comment } from '../models/Comment';
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
    const { content, projectId, campaignId, mentions, parentCommentId } = req.body;

    // At least one target is required
    if (!projectId && !campaignId) {
      return res.status(400).json({
        success: false,
        message: 'Comment must be attached to a project or campaign'
      });
    }

    // CRITICAL: Verify ownership through parent campaign (Hybrid users only)
    if (req.user!.role === UserRole.HYBRID) {
      let targetCampaignId = null;

      if (projectId) {
        const project = await Project.findById(projectId);
        if (!project) {
          return res.status(404).json({
            success: false,
            message: 'Project not found'
          });
        }
        targetCampaignId = project.campaignId;
      } else if (campaignId) {
        targetCampaignId = new mongoose.Types.ObjectId(campaignId);
      }

      // Check campaign ownership
      const campaign = await Campaign.findById(targetCampaignId);
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }

      if (campaign.createdBy.toString() !== req.user!._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only comment on resources under campaigns you created'
        });
      }
    }

    // Create comment
    const comment = await Comment.create({
      content,
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
 * @desc    Get comments (filtered by project/campaign)
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    // Filter by entity
    if (req.query.projectId) {
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
