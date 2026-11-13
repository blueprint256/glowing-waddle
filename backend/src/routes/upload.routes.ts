import express from 'express';
import multer from 'multer';
import { PendingRequest } from '../models/PendingRequest';
import { Asset } from '../models/Asset';
import { Slot } from '../models/Slot';
import { uploadFile } from '../utils/s3Service';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

/**
 * @route POST /api/upload
 * @desc Handle a one-time upload
 * @access Public
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: 'Upload token is required' });
    }

    const pendingRequest = await PendingRequest.findOne({ token });

    if (!pendingRequest) {
      return res.status(404).json({ message: 'Invalid or expired upload token' });
    }

    if (pendingRequest.expiresAt < new Date()) {
      await pendingRequest.remove();
      return res.status(410).json({ message: 'Upload token has expired' });
    }

    const slot = await Slot.findById(pendingRequest.slotId);

    if (!slot) {
      await pendingRequest.remove();
      return res.status(404).json({ message: 'Associated slot not found' });
    }

    const { originalname, mimetype, buffer } = req.file;
    const size = buffer.length;

    const s3Key = `uploads/${slot._id}/${Date.now()}-${originalname}`;

    const s3Upload = await uploadFile({
      key: s3Key,
      contentType: mimetype,
      body: buffer
    });

    const asset = new Asset({
      userId: slot.userId,
      originalFileName: originalname,
      storageKey: s3Upload.Key,
      contentType: mimetype,
      size
    });

    await asset.save();
    slot.assetId = asset._id;
    await slot.save();
    await pendingRequest.remove();

    res.json({ message: 'File uploaded successfully', assetId: asset._id });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;