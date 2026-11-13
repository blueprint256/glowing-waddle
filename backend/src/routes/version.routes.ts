import express from 'express';
import { isAuthenticated } from '../middleware/auth';
import { Version } from '../models/Version';
import { Asset } from '../models/Asset';
import { uploadFile } from '../utils/s3Service';
import { renderPoster } from '../services/renderService';

const router = express.Router();

/**
 * @route POST /api/projects/:projectId/versions
 * @desc Create a new version
 * @access Private
 */
router.post('/projects/:projectId/versions', isAuthenticated, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { structuredData } = req.body;

    const latestVersion = await Version.findOne({ projectId })
      .sort({ number: -1 })
      .limit(1);

    const nextNumber = latestVersion ? latestVersion.number + 1 : 1;

    const renderedBuffer = await renderPoster(structuredData);

    const s3Key = `renders/${projectId}/${Date.now()}-poster.png`;

    const s3Upload = await uploadFile({
      key: s3Key,
      contentType: 'image/png',
      body: renderedBuffer
    });

    const renderedAsset = new Asset({
      userId: req.user._id,
      originalFileName: `poster-${nextNumber}.png`,
      storageKey: s3Upload.Key,
      contentType: 'image/png',
      size: renderedBuffer.length,
      width: structuredData.width,
      height: structuredData.height
    });

    await renderedAsset.save();

    const version = new Version({
      projectId,
      number: nextNumber,
      structuredData,
      renderedAssetId: renderedAsset._id
    });

    await version.save();

    res.status(201).json(version);
  } catch (error) {
    console.error('Create version error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route GET /api/projects/:projectId/versions/:number
 * @desc Get details of a version
 * @access Private
 */
router.get('/projects/:projectId/versions/:number', isAuthenticated, async (req, res) => {
  try {
    const { projectId, number } = req.params;

    const version = await Version.findOne({ projectId, number }).populate('renderedAssetId');

    if (!version) {
      return res.status(404).json({ message: 'Version not found' });
    }

    res.json(version);
  } catch (error) {
    console.error('Get version error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;