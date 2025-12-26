import express, { Request, Response } from 'express';
import { Project, ProjectRole, ProjectStatus } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canCreateCampaign, canAssignToProject } from '../middleware/rbac';
import { validateProjectCreation, validateMongoId } from '../middleware/validation';
import { logAudit, logProjectAssignment } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import mongoose from 'mongoose';

const router = express.Router();

/**
 * @route   POST /api/projects
 * @desc    Create a new project
 * @access  Private (System Admin, Hybrid)
 */
router.post('/', isAuthenticated, canCreateCampaign, validateProjectCreation, async (req: Request, res: Response) => {
  try {
    const { name, description, campaignId, startDate, dueDate } = req.body;

    // Verify campaign exists
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // Create project
    const project = await Project.create({
      name,
      description,
      campaignId: new mongoose.Types.ObjectId(campaignId),
      status: ProjectStatus.PLANNING,
      startDate,
      dueDate,
      createdBy: req.user!._id,
      assignments: []
    });

    // Log project creation
    await logAudit({
      action: AuditAction.PROJECT_CREATED,
      userId: req.user!._id,
      targetType: 'Project',
      targetId: project._id,
      metadata: { name, campaignId },
      req
    });

    const populatedProject = await Project.findById(project._id)
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName');

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      project: populatedProject
    });
  } catch (error: any) {
    console.error('Error creating project:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating project'
    });
  }
});

/**
 * @route   GET /api/projects
 * @desc    Get all projects
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    // Filter by campaign if provided
    if (req.query.campaignId) {
      query.campaignId = req.query.campaignId;
    }

    const projects = await Project.find(query)
      .populate('campaignId', 'name status')
      .populate('createdBy', 'firstName lastName')
      .populate('assignments.userId', 'firstName lastName email role')
      .populate('assignments.assignedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      projects
    });
  } catch (error: any) {
    console.error('Error fetching projects:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching projects'
    });
  }
});

/**
 * @route   GET /api/projects/:id
 * @desc    Get project by ID
 * @access  Private
 */
router.get('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('campaignId', 'name status description')
      .populate('createdBy', 'firstName lastName email')
      .populate('assignments.userId', 'firstName lastName email role')
      .populate('assignments.assignedBy', 'firstName lastName');

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.json({
      success: true,
      project
    });
  } catch (error: any) {
    console.error('Error fetching project:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching project'
    });
  }
});

/**
 * @route   PUT /api/projects/:id
 * @desc    Update project
 * @access  Private (System Admin, Hybrid)
 */
router.put('/:id', isAuthenticated, canCreateCampaign, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const oldData = { ...project.toObject() };
    const { name, description, status, startDate, dueDate } = req.body;

    // Update fields
    if (name) project.name = name;
    if (description !== undefined) project.description = description;
    if (status) project.status = status;
    if (startDate !== undefined) project.startDate = startDate;
    if (dueDate !== undefined) project.dueDate = dueDate;

    await project.save();

    // Log update
    await logAudit({
      action: AuditAction.PROJECT_UPDATED,
      userId: req.user!._id,
      targetType: 'Project',
      targetId: project._id,
      changes: { old: oldData, new: project.toObject() },
      req
    });

    const updatedProject = await Project.findById(project._id)
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Project updated successfully',
      project: updatedProject
    });
  } catch (error: any) {
    console.error('Error updating project:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating project'
    });
  }
});

/**
 * @route   POST /api/projects/:id/assignments
 * @desc    Assign user to project
 * @access  Private (System Admin, Hybrid)
 */
router.post('/:id/assignments',
  isAuthenticated,
  validateMongoId('id'),
  canAssignToProject,
  async (req: Request, res: Response) => {
    try {
      const { userId, role } = req.body;

      if (!userId || !role) {
        return res.status(400).json({
          success: false,
          message: 'userId and role are required'
        });
      }

      const project = await Project.findById(req.params.id);
      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found'
        });
      }

      // Check if user is already assigned
      const existingAssignment = project.assignments.find(
        (a) => a.userId.toString() === userId
      );

      if (existingAssignment) {
        return res.status(400).json({
          success: false,
          message: 'User is already assigned to this project'
        });
      }

      // Add assignment
      project.assignments.push({
        userId: new mongoose.Types.ObjectId(userId),
        role: role as ProjectRole,
        assignedBy: req.user!._id,
        assignedAt: new Date()
      });

      await project.save();

      // Log assignment
      await logProjectAssignment(
        req.user!._id,
        project._id,
        new mongoose.Types.ObjectId(userId),
        role,
        req
      );

      const updatedProject = await Project.findById(project._id)
        .populate('assignments.userId', 'firstName lastName email role')
        .populate('assignments.assignedBy', 'firstName lastName');

      res.json({
        success: true,
        message: 'User assigned to project successfully',
        project: updatedProject
      });
    } catch (error: any) {
      console.error('Error assigning user to project:', error);
      res.status(500).json({
        success: false,
        message: 'Error assigning user to project'
      });
    }
  }
);

/**
 * @route   DELETE /api/projects/:id/assignments/:userId
 * @desc    Remove user from project
 * @access  Private (System Admin, Hybrid)
 */
router.delete('/:id/assignments/:userId',
  isAuthenticated,
  validateMongoId('id'),
  canAssignToProject,
  async (req: Request, res: Response) => {
    try {
      const { id, userId } = req.params;

      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found'
        });
      }

      // Remove assignment
      project.assignments = project.assignments.filter(
        (a) => a.userId.toString() !== userId
      );

      await project.save();

      // Log removal
      await logAudit({
        action: AuditAction.PROJECT_ASSIGNMENT_REMOVED,
        userId: req.user!._id,
        targetType: 'Project',
        targetId: project._id,
        metadata: { removedUserId: userId },
        req
      });

      res.json({
        success: true,
        message: 'User removed from project successfully'
      });
    } catch (error: any) {
      console.error('Error removing user from project:', error);
      res.status(500).json({
        success: false,
        message: 'Error removing user from project'
      });
    }
  }
);

export default router;
