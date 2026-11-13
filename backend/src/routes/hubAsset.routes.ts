import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { isAuthenticated } from '../middleware/auth';
import { UserRole } from '../models/User';
import { HubAsset } from '../models/HubAsset';
import { getSignedDownloadUrl } from '../utils/s3Service';

const router = express.Router();

const SIGNED_URL_SECONDS = 300;

/** Asset the caller may read: their own, or any for a System Admin. */
async function findReadableAsset(req: Request, res: Response) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ success: false, message: 'Invalid asset id' });
    return null;
  }
  const asset = await HubAsset.findById(req.params.id);
  if (!asset) {
    res.status(404).json({ success: false, message: 'Asset not found' });
    return null;
  }
  if (asset.userId.toString() !== req.user!._id.toString() && req.user!.role !== UserRole.SYSTEM_ADMIN) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return null;
  }
  return asset;
}

/**
 * @route GET /api/hub/assets/:id
 * @desc  Asset details (never exposes the storage key)
 */
router.get('/assets/:id', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const asset = await findReadableAsset(req, res);
    if (!asset) return;
    const { storageKey, ...safe } = asset.toObject();
    res.json({ success: true, asset: safe });
  } catch (error) {
    console.error('Get hub asset error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route GET /api/hub/assets/:id/content
 * @desc  Redirect to a short-lived signed URL for the file (usable directly as an <img src>)
 */
router.get('/assets/:id/content', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const asset = await findReadableAsset(req, res);
    if (!asset) return;
    const url = await getSignedDownloadUrl(asset.storageKey, SIGNED_URL_SECONDS);
    res.set('Cache-Control', 'private, max-age=60');
    res.redirect(url);
  } catch (error) {
    console.error('Hub asset content error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route GET /api/hub/assets/:id/url
 * @desc  Same as /content but returns the signed URL as JSON (for connectors and clients)
 */
router.get('/assets/:id/url', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const asset = await findReadableAsset(req, res);
    if (!asset) return;
    const url = await getSignedDownloadUrl(asset.storageKey, SIGNED_URL_SECONDS);
    res.json({ success: true, url, expiresInSeconds: SIGNED_URL_SECONDS });
  } catch (error) {
    console.error('Hub asset url error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
