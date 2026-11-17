import express, { Request, Response } from 'express';
import { Comment } from '../models/Comment';
import { Project } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { Task } from '../models/Task';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { validateCommentCreation, validateMongoId } from '../middleware/validation';
import mongoose from 'mongoose';

const router = express.Router();

type CommentTarget = { field: 'taskId' | 'projectId' | 'campaignId'; id: mongoose.Types.ObjectId };

/**
 * Resolve which campaign/project/task a comment request is about and check the user may access it
 * (System Admins: everything; Hybrid users: only resources under campaigns they created).
 */
async function resolveTarget(
  req: Request,
  source: { taskId?: unknown; projectId?: unknown; campaignId?: unknown }
): Promise<{ ok: true; target: CommentTarget } | { ok: false; status: number; message: string }> {
  const pick = (['taskId', 'projectId', 'campaignId'] as const).find((f) => source[f]);
  if (!pick) {
    return { ok: false, status: 400, message: 'Specify the post, theme or campaign (taskId, projectId or campaignId)' };
  }
  const rawId = source[pick];
  if (typeof rawId !== 'string' || !mongoose.isValidObjectId(rawId)) {
    return { ok: false, status: 400, message: `Valid ${pick} is required` };
  }

  let campaignId: unknown;
  if (pick === 'taskId') {
    const task = await Task.findById(rawId).select('campaignId');
    if (!task) return { ok: false, status: 404, message: 'Post not found' };
    campaignId = task.campaignId;
  } else if (pick === 'projectId') {
    const project = await Project.findById(rawId).select('campaignId');
    if (!project) return { ok: false, status: 404, message: 'Theme not found' };
    campaignId = project.campaignId;
  } else {
    campaignId = rawId;
  }

  const campaign = await Campaign.findById(campaignId).select('createdBy');
  if (!campaign) return { ok: false, status: 404, message: 'Campaign not found' };

  if (req.user!.role !== UserRole.SYSTEM_ADMIN && campaign.createdBy.toString() !== req.user!._id.toString()) {
    return { ok: false, status: 403, message: 'Access denied: You can only access comments on resources under campaigns you created' };
  }

  return { ok: true, target: { field: pick, id: new mongoose.Types.ObjectId(rawId) } };
}

/**
 * @route   POST /api/comments
 * @desc    Create a new comment on a task, project or campaign
 * @access  Private
 */
router.post('/', isAuthenticated, validateCommentCreation, async (req: Request, res: Response) => {
  try {
    const { content, taskId, projectId, campaignId, mentions, parentCommentId } = req.body;

    const resolved = await resolveTarget(req, { taskId, projectId, campaignId });
    if (!resolved.ok) {
      return res.status(resolved.status).json({ success: false, message: resolved.message });
    }

    if (parentCommentId !== undefined && parentCommentId !== null && parentCommentId !== '') {
      if (!mongoose.isValidObjectId(parentCommentId) || !(await Comment.exists({ _id: parentCommentId }))) {
        return res.status(400).json({ success: false, message: 'Comment being replied to was not found' });
      }
    }

    const mentionIds = Array.isArray(mentions)
      ? mentions.filter((m: unknown) => typeof m === 'string' && mongoose.isValidObjectId(m))
          .map((m: string) => new mongoose.Types.ObjectId(m))
      : [];

    const comment = await Comment.create({
      content,
      [resolved.target.field]: resolved.target.id,
      authorId: req.user!._id,
      mentions: mentionIds,
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
 * @route   GET /api/comments?taskId=|projectId=|campaignId=
 * @desc    Get comments for one task, project or campaign the user can access
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const resolved = await resolveTarget(req, {
      taskId: req.query.taskId,
      projectId: req.query.projectId,
      campaignId: req.query.campaignId
    });
    if (!resolved.ok) {
      return res.status(resolved.status).json({ success: false, message: resolved.message });
    }

    const comments = await Comment.find({ [resolved.target.field]: resolved.target.id })
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
