import express, { Request, Response } from 'express';
import { isAuthenticated } from '../middleware/auth';
import { Version } from '../models/Version';
import { HubAsset } from '../models/HubAsset';
import { uploadPrivateBuffer, deleteFromS3 } from '../utils/s3Service';
import { renderPoster, validatePoster, PosterValidationError } from '../services/renderService';
import { loadOwnedProject } from './hubProject.routes';

const router = express.Router();

const MAX_NUMBER_RETRIES = 5;

/**
 * @route POST /api/hub/projects/:projectId/versions
 * @desc  Render the structured poster to a PNG and save it as the project's next version.
 *        Body: { structuredData: { width, height, background?, layers: [...] } }
 */
router.post('/projects/:projectId/versions', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const project = await loadOwnedProject(req, res, req.params.projectId);
    if (!project) return;

    const poster = validatePoster(req.body.structuredData);
    const buffer = await renderPoster(poster, project.userId);

    const { key } = await uploadPrivateBuffer(buffer, 'image/png', `content-hub-renders/${project._id}`);
    const renderedAsset = await HubAsset.create({
      userId: project.userId,
      originalFileName: 'poster.png',
      storageKey: key,
      contentType: 'image/png',
      size: buffer.length,
      width: poster.width,
      height: poster.height
    });

    // Version numbers are unique per project (DB index). Two simultaneous saves can pick the same
    // number; the loser simply tries the next one.
    for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
      const latest = await Version.findOne({ projectId: project._id }).sort({ number: -1 }).select('number');
      try {
        const version = await Version.create({
          projectId: project._id,
          number: (latest?.number ?? 0) + 1,
          structuredData: poster,
          renderedAssetId: renderedAsset._id
        });
        project.set('updatedAt', new Date());
        await project.save();
        return res.status(201).json({ success: true, version });
      } catch (error: any) {
        if (error?.code !== 11000) throw error; // not a number collision
      }
    }

    // Could not claim a number: don't leave an orphaned file behind.
    await renderedAsset.deleteOne();
    await deleteFromS3(key).catch(() => undefined);
    res.status(409).json({ success: false, message: 'Could not save the version, please try again' });
  } catch (error) {
    if (error instanceof PosterValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Create version error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route GET /api/hub/projects/:projectId/versions
 * @desc  List versions, newest first
 */
router.get('/projects/:projectId/versions', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const project = await loadOwnedProject(req, res, req.params.projectId);
    if (!project) return;

    const versions = await Version.find({ projectId: project._id })
      .populate('renderedAssetId', 'originalFileName contentType size width height createdAt')
      .sort({ number: -1 });
    res.json({ success: true, versions });
  } catch (error) {
    console.error('List versions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route GET /api/hub/projects/:projectId/versions/:number
 */
router.get('/projects/:projectId/versions/:number', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const project = await loadOwnedProject(req, res, req.params.projectId);
    if (!project) return;

    const number = Number(req.params.number);
    if (!Number.isInteger(number) || number < 1) {
      return res.status(400).json({ success: false, message: 'Invalid version number' });
    }

    const version = await Version.findOne({ projectId: project._id, number })
      .populate('renderedAssetId', 'originalFileName contentType size width height createdAt');
    if (!version) return res.status(404).json({ success: false, message: 'Version not found' });

    res.json({ success: true, version });
  } catch (error) {
    console.error('Get version error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
