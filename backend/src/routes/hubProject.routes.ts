import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { isAuthenticated } from '../middleware/auth';
import { UserRole } from '../models/User';
import { HubProject, IHubProject } from '../models/HubProject';
import { Slot } from '../models/Slot';
import { Version } from '../models/Version';

const router = express.Router();

/**
 * Load a hub project and make sure the caller may use it.
 * Owners see their own projects; System Admins see all. Responds and returns null otherwise.
 */
export async function loadOwnedProject(
  req: Request,
  res: Response,
  projectId: string
): Promise<IHubProject | null> {
  if (!mongoose.isValidObjectId(projectId)) {
    res.status(400).json({ success: false, message: 'Invalid project id' });
    return null;
  }
  const project = await HubProject.findById(projectId);
  if (!project) {
    res.status(404).json({ success: false, message: 'Project not found' });
    return null;
  }
  const isOwner = project.userId.toString() === req.user!._id.toString();
  if (!isOwner && req.user!.role !== UserRole.SYSTEM_ADMIN) {
    res.status(403).json({ success: false, message: 'Access denied: this is not your project' });
    return null;
  }
  return project;
}

/**
 * @route POST /api/hub/projects
 * @desc  Create a hub project
 */
router.post('/projects', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : undefined;

    if (!name || name.length > 120) {
      return res.status(400).json({ success: false, message: 'Project name is required (max 120 characters)' });
    }

    const project = await HubProject.create({ userId: req.user!._id, name, description });
    res.status(201).json({ success: true, project });
  } catch (error) {
    console.error('Create hub project error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route GET /api/hub/projects
 * @desc  List the caller's hub projects (System Admins see everyone's) with slot/version counts
 */
router.get('/projects', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const filter = req.user!.role === UserRole.SYSTEM_ADMIN ? {} : { userId: req.user!._id };
    const projects = await HubProject.find(filter).sort({ updatedAt: -1 }).lean();
    const ids = projects.map((p) => p._id);

    const [slotCounts, versionCounts] = await Promise.all([
      Slot.aggregate([{ $match: { projectId: { $in: ids } } }, { $group: { _id: '$projectId', n: { $sum: 1 } } }]),
      Version.aggregate([{ $match: { projectId: { $in: ids } } }, { $group: { _id: '$projectId', n: { $sum: 1 } } }])
    ]);
    const slotsBy = new Map<string, number>(slotCounts.map((c): [string, number] => [c._id.toString(), c.n]));
    const versionsBy = new Map<string, number>(versionCounts.map((c): [string, number] => [c._id.toString(), c.n]));

    res.json({
      success: true,
      projects: projects.map((p) => ({
        ...p,
        slotCount: slotsBy.get(p._id.toString()) || 0,
        versionCount: versionsBy.get(p._id.toString()) || 0
      }))
    });
  } catch (error) {
    console.error('List hub projects error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route GET /api/hub/projects/:projectId
 */
router.get('/projects/:projectId', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const project = await loadOwnedProject(req, res, req.params.projectId);
    if (!project) return;
    res.json({ success: true, project });
  } catch (error) {
    console.error('Get hub project error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route PUT /api/hub/projects/:projectId
 */
router.put('/projects/:projectId', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const project = await loadOwnedProject(req, res, req.params.projectId);
    if (!project) return;

    if (typeof req.body.name === 'string') {
      const name = req.body.name.trim();
      if (!name || name.length > 120) {
        return res.status(400).json({ success: false, message: 'Project name must be 1–120 characters' });
      }
      project.name = name;
    }
    if (typeof req.body.description === 'string') project.description = req.body.description.trim();

    await project.save();
    res.json({ success: true, project });
  } catch (error) {
    console.error('Update hub project error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
