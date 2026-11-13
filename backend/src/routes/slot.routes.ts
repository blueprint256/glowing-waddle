import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { randomBytes } from 'crypto';
import { isAuthenticated } from '../middleware/auth';
import { Slot } from '../models/Slot';
import { PendingRequest } from '../models/PendingRequest';
import { loadOwnedProject } from './hubProject.routes';

const router = express.Router();

const MAX_SLOTS_PER_PROJECT = 100;
const UPLOAD_LINK_MINUTES = 15;

/** Slot that belongs to the given project (404 otherwise). */
async function findSlot(res: Response, projectId: string, slotId: string) {
  if (!mongoose.isValidObjectId(slotId)) {
    res.status(400).json({ success: false, message: 'Invalid slot id' });
    return null;
  }
  const slot = await Slot.findOne({ _id: slotId, projectId });
  if (!slot) {
    res.status(404).json({ success: false, message: 'Slot not found' });
    return null;
  }
  return slot;
}

/**
 * @route POST /api/hub/projects/:projectId/slots
 * @desc  Create a slot (an empty place for one uploaded image)
 */
router.post('/projects/:projectId/slots', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const project = await loadOwnedProject(req, res, req.params.projectId);
    if (!project) return;

    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) {
      return res.status(400).json({ success: false, message: 'Slot name is required (max 80 characters)' });
    }
    if ((await Slot.countDocuments({ projectId: project._id })) >= MAX_SLOTS_PER_PROJECT) {
      return res.status(400).json({ success: false, message: `A project can have at most ${MAX_SLOTS_PER_PROJECT} slots` });
    }

    // Files always belong to the project owner, even when a System Admin creates the slot.
    const slot = await Slot.create({ name, projectId: project._id, userId: project.userId });
    res.status(201).json({ success: true, slot });
  } catch (error) {
    console.error('Create slot error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route GET /api/hub/projects/:projectId/slots
 */
router.get('/projects/:projectId/slots', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const project = await loadOwnedProject(req, res, req.params.projectId);
    if (!project) return;

    const slots = await Slot.find({ projectId: project._id })
      .populate('assetId', 'originalFileName contentType size width height createdAt')
      .sort({ createdAt: 1 });

    // Only report a pending request that is still valid.
    const pendingIds = slots
      .map((s) => s.pendingRequestId)
      .filter((id): id is mongoose.Types.ObjectId => !!id);
    const live = await PendingRequest.find({ _id: { $in: pendingIds }, expiresAt: { $gt: new Date() } }).select('expiresAt');
    const expiryBy = new Map<string, Date>(live.map((p): [string, Date] => [p._id.toString(), p.expiresAt]));

    res.json({
      success: true,
      slots: slots.map((s) => ({
        ...s.toObject(),
        pendingUntil: s.pendingRequestId ? expiryBy.get(s.pendingRequestId.toString()) || null : null
      }))
    });
  } catch (error) {
    console.error('List slots error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route GET /api/hub/projects/:projectId/slots/:slotId
 */
router.get('/projects/:projectId/slots/:slotId', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const project = await loadOwnedProject(req, res, req.params.projectId);
    if (!project) return;
    const slot = await findSlot(res, req.params.projectId, req.params.slotId);
    if (!slot) return;

    await slot.populate('assetId', 'originalFileName contentType size width height createdAt');
    res.json({ success: true, slot });
  } catch (error) {
    console.error('Get slot error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route DELETE /api/hub/projects/:projectId/slots/:slotId
 */
router.delete('/projects/:projectId/slots/:slotId', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const project = await loadOwnedProject(req, res, req.params.projectId);
    if (!project) return;
    const slot = await findSlot(res, req.params.projectId, req.params.slotId);
    if (!slot) return;

    await PendingRequest.deleteMany({ slotId: slot._id });
    await slot.deleteOne();
    res.json({ success: true, message: 'Slot deleted' });
  } catch (error) {
    console.error('Delete slot error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route POST /api/hub/projects/:projectId/slots/:slotId/request-upload
 * @desc  Issue a single-use, 15-minute upload link for this slot. Requesting again revokes the
 *        previous link and issues a new one (so a lost link is never a dead end).
 */
router.post('/projects/:projectId/slots/:slotId/request-upload', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const project = await loadOwnedProject(req, res, req.params.projectId);
    if (!project) return;
    const slot = await findSlot(res, req.params.projectId, req.params.slotId);
    if (!slot) return;

    await PendingRequest.deleteMany({ slotId: slot._id });

    const expiresAt = new Date(Date.now() + UPLOAD_LINK_MINUTES * 60 * 1000);
    const token = randomBytes(24).toString('hex');
    const pending = await PendingRequest.create({ slotId: slot._id, expiresAt, token });

    slot.pendingRequestId = pending._id as any;
    await slot.save();

    const frontend = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    res.json({
      success: true,
      uploadUrl: `/api/hub/upload?token=${token}`, // API endpoint (what a connector/AI calls)
      pageUrl: `${frontend}/upload?token=${token}`, // human-friendly page: drop, paste or pick a file
      expiresAt
    });
  } catch (error) {
    console.error('Request upload error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
