import express, { Request, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { PendingRequest } from '../models/PendingRequest';
import { HubAsset } from '../models/HubAsset';
import { HubProject } from '../models/HubProject';
import { Slot } from '../models/Slot';
import { uploadPrivateBuffer } from '../utils/s3Service';

const router = express.Router();

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED_FORMATS: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (Object.values(ALLOWED_FORMATS).includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only PNG, JPEG, WebP or GIF images are allowed'));
  }
});

/**
 * Public by design: the one-time token IS the credential, so a guest browser (or an AI tool)
 * can upload without logging in. Everything is scoped to exactly one slot.
 */

/**
 * @route GET /api/hub/upload/info?token=...
 * @desc  Tell the upload page what the link is for (slot + project name, expiry) — nothing else.
 */
router.get('/upload/info', async (req: Request, res: Response) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const pending = token ? await PendingRequest.findOne({ token, expiresAt: { $gt: new Date() } }) : null;
    if (!pending) {
      return res.status(404).json({ success: false, message: 'This upload link is invalid, expired or already used' });
    }
    const slot = await Slot.findById(pending.slotId);
    const project = slot ? await HubProject.findById(slot.projectId).select('name') : null;
    if (!slot || !project) {
      return res.status(404).json({ success: false, message: 'This upload link is no longer valid' });
    }
    res.json({ success: true, slotName: slot.name, projectName: project.name, expiresAt: pending.expiresAt });
  } catch (error) {
    console.error('Upload info error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route POST /api/hub/upload?token=...   (multipart, field "file")
 * @desc  Consume the one-time token and put the image into its slot.
 */
router.post(
  '/upload',
  (req: Request, res: Response, next) => {
    upload.single('file')(req, res, (err: any) => {
      if (!err) return next();
      const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      res.status(tooBig ? 413 : 400).json({
        success: false,
        message: tooBig ? 'File is too large (max 20 MB)' : err.message || 'Invalid upload'
      });
    });
  },
  async (req: Request, res: Response) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token) return res.status(400).json({ success: false, message: 'Upload token is required' });
      if (!req.file) return res.status(400).json({ success: false, message: 'No file was provided (field name: file)' });

      // 1) Cheap check first, so a bad file or dead link never burns a valid token.
      const peek = await PendingRequest.findOne({ token, expiresAt: { $gt: new Date() } });
      if (!peek) {
        return res.status(410).json({ success: false, message: 'This upload link is invalid, expired or already used' });
      }

      // 2) The bytes must really be an allowed image (the declared MIME type is not trusted).
      let meta: sharp.Metadata;
      try {
        meta = await sharp(req.file.buffer).metadata();
      } catch {
        return res.status(400).json({ success: false, message: 'The file is not a readable image' });
      }
      const contentType = meta.format ? ALLOWED_FORMATS[meta.format] : undefined;
      if (!contentType) {
        return res.status(400).json({ success: false, message: 'Only PNG, JPEG, WebP or GIF images are allowed' });
      }

      // 3) Claim the token atomically: of two simultaneous uploads, exactly one wins.
      const claimed = await PendingRequest.findOneAndDelete({ token, expiresAt: { $gt: new Date() } });
      if (!claimed) {
        return res.status(410).json({ success: false, message: 'This upload link was just used' });
      }

      try {
        const slot = await Slot.findById(claimed.slotId);
        if (!slot) {
          return res.status(404).json({ success: false, message: 'The slot for this link no longer exists' });
        }

        const { key } = await uploadPrivateBuffer(req.file.buffer, contentType, `content-hub/${slot.projectId}/${slot._id}`);

        const asset = await HubAsset.create({
          userId: slot.userId,
          originalFileName: req.file.originalname,
          storageKey: key,
          contentType,
          size: req.file.size,
          width: meta.width,
          height: meta.height
        });

        slot.assetId = asset._id as any;
        slot.pendingRequestId = undefined;
        await slot.save();

        res.json({ success: true, message: 'File uploaded successfully', assetId: asset._id });
      } catch (error) {
        // Storage/database failed after we claimed the token: give the link back so the user can retry.
        await PendingRequest.create(claimed.toObject()).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

export default router;
