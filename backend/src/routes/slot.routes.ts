import express from 'express';
import { isAuthenticated } from '../middleware/auth';
import { Slot } from '../models/Slot';
import { PendingRequest } from '../models/PendingRequest';
import { randomBytes } from 'crypto';

const router = express.Router();

/**
 * @route POST /api/projects/:projectId/slots
 * @desc Create a new slot for a project
 * @access Private
 */
router.post('/projects/:projectId/slots', isAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    const { projectId } = req.params;

    const newSlot = new Slot({
      name,
      projectId,
      userId: req.user!._id
    });

    await newSlot.save();

    res.status(201).json(newSlot);
  } catch (error) {
    console.error('Create slot error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route GET /api/projects/:projectId/slots
 * @desc List slots for a project
 * @access Private
 */
router.get('/projects/:projectId/slots', isAuthenticated, async (req, res) => {
  try {
    const { projectId } = req.params;

    const slots = await Slot.find({ projectId }).populate('assetId').sort({ createdAt: 1 });

    res.json(slots);
  } catch (error) {
    console.error('List slots error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route GET /api/projects/:projectId/slots/:slotId
 * @desc Get details of a slot
 * @access Private
 */
router.get('/projects/:projectId/slots/:slotId', isAuthenticated, async (req, res) => {
  try {
    const { slotId } = req.params;

    const slot = await Slot.findById(slotId).populate('assetId');

    if (!slot) {
      return res.status(404).json({ message: 'Slot not found' });
    }

    res.json(slot);
  } catch (error) {
    console.error('Get slot error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route POST /api/projects/:projectId/slots/:slotId/request-upload
 * @desc Request an upload for a slot
 * @access Private
 */
router.post('/projects/:projectId/slots/:slotId/request-upload', isAuthenticated, async (req, res) => {
  try {
    const { slotId } = req.params;

    const existingPendingRequest = await PendingRequest.findOne({ slotId });

    if (existingPendingRequest) {
      if (existingPendingRequest.expiresAt < new Date()) {
        await existingPendingRequest.deleteOne();
      } else {
        return res.status(400).json({ message: 'A pending request already exists for this slot' });
      }
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
    const token = randomBytes(20).toString('hex');

    const pendingRequest = new PendingRequest({
      slotId,
      expiresAt,
      token
    });

    await pendingRequest.save();

    res.json({ uploadUrl: `/api/upload?token=${token}` });
  } catch (error) {
    console.error('Request upload error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;