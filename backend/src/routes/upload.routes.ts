import express from 'express';
import multer from 'multer';
import { PendingRequest } from '../models/PendingRequest';
import { Asset } from '../models/Asset';
import { Slot } from '../models/Slot';
import { uploadToS3 } from '../utils/s3Service';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

/**
 * @route POST /api/upload
 * @desc Handle a one-time upload bound to a pending request token.
 *       Public by design: the token itself is the credential, so this
 *       works from a guest browser with no login.
 * @access Public
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'Upload token is required' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file was provided' });
    }

    const pendingRequest = await PendingRequest.findOne({ token });

    if (!pendingRequest) {
      return res.status(404).json({ message: 'Invalid or expired upload token' });
    }

    if (pendingRequest.expiresAt < new Date()) {
      await pendingRequest.deleteOne();
      return res.status(410).json({ message: 'Upload token has expired' });
    }

    const slot = await Slot.findById(pendingRequest.slotId);

    if (!slot) {
      await pendingRequest.deleteOne();
      return res.status(404).json({ message: 'Associated slot not found' });
    }

    const { key } = await uploadToS3(req.file, `content-hub/${slot._id}`);

    const asset = new Asset({
      userId: slot.userId,
      originalFileName: req.file.originalname,
      storageKey: key,
      contentType: req.file.mimetype,
      size: req.file.size
    });

    await asset.save();

    slot.assetId = asset._id as any;
    await slot.save();
    await pendingRequest.deleteOne();

    res.json({ message: 'File uploaded successfully', assetId: asset._id });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
