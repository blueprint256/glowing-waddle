import express, { Request, Response } from 'express';
import multer from 'multer';
import { Task, TaskStatus, TaskType } from '../models/Task';
import { Project } from '../models/Project';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canManageTasks } from '../middleware/rbac';
import { validateMongoId } from '../middleware/validation';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { uploadTaskImage } from '../utils/s3Service';
import mongoose from 'mongoose';

const router = express.Router();

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

/**
 * @route   POST /api/tasks
 * @desc    Create a new task
 * @access  Private (System Admin, Hybrid)
 */
router.post('/', isAuthenticated, canManageTasks, async (req: Request, res: Response) => {
  try {
    const { name, description, type, projectId, scheduledDate, publishDate, content, status } = req.body;

    // Verify project exists and get hierarchy info
    const project = await Project.findById(projectId)
      .populate('campaignId');

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Check access permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || project.teamId.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    // Create task (inherit campaignId and teamId from project)
    const task = await Task.create({
      name,
      description,
      type: type || TaskType.OTHER,
      projectId: new mongoose.Types.ObjectId(projectId),
      campaignId: project.campaignId,
      teamId: project.teamId,
      status: status || TaskStatus.PENDING,
      scheduledDate,
      publishDate,
      content,
      createdBy: req.user!._id
    });

    // Log task creation
    await logAudit({
      action: AuditAction.EVENT_CREATED,
      userId: req.user!._id,
      targetType: 'Task',
      targetId: task._id,
      metadata: { name, projectId },
      req
    });

    const populatedTask = await Task.findById(task._id)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName');

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      task: populatedTask
    });
  } catch (error: any) {
    console.error('Error creating task:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating task'
    });
  }
});

/**
 * @route   GET /api/tasks
 * @desc    Get all tasks (filtered by project/campaign/team)
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    // Filter by project if provided
    if (req.query.projectId) {
      query.projectId = req.query.projectId;
    }

    // Filter by campaign if provided
    if (req.query.campaignId) {
      query.campaignId = req.query.campaignId;
    }

    // Filter by status if provided
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Non-admins can only see tasks from their team
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId) {
        return res.json({
          success: true,
          tasks: []
        });
      }
      query.teamId = req.user!.teamId;
    }

    const tasks = await Task.find(query)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .sort({ publishDate: 1, scheduledDate: 1, createdAt: -1 });

    res.json({
      success: true,
      tasks
    });
  } catch (error: any) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tasks'
    });
  }
});

/**
 * @route   GET /api/tasks/:id
 * @desc    Get task by ID
 * @access  Private
 */
router.get('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('projectId', 'name status')
      .populate('campaignId', 'name')
      .populate('teamId', 'name')
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Check access permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || task.teamId._id.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    res.json({
      success: true,
      task
    });
  } catch (error: any) {
    console.error('Error fetching task:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching task'
    });
  }
});

/**
 * @route   PUT /api/tasks/:id
 * @desc    Update task
 * @access  Private (System Admin, Hybrid)
 */
router.put('/:id', isAuthenticated, canManageTasks, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Check access permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || task.teamId.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    const oldData = { ...task.toObject() };
    const { name, description, type, status, scheduledDate, publishDate, content } = req.body;

    // Update fields
    if (name) task.name = name;
    if (description !== undefined) task.description = description;
    if (type) task.type = type;
    if (status) task.status = status;
    if (scheduledDate !== undefined) task.scheduledDate = scheduledDate;
    if (publishDate !== undefined) task.publishDate = publishDate;
    if (content !== undefined) task.content = content;

    task.lastModifiedBy = req.user!._id;
    await task.save();

    // Log update
    await logAudit({
      action: AuditAction.EVENT_UPDATED,
      userId: req.user!._id,
      targetType: 'Task',
      targetId: task._id,
      changes: { old: oldData, new: task.toObject() },
      req
    });

    const updatedTask = await Task.findById(task._id)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Task updated successfully',
      task: updatedTask
    });
  } catch (error: any) {
    console.error('Error updating task:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating task'
    });
  }
});

/**
 * @route   POST /api/tasks/:id/upload-image
 * @desc    Upload designed image for task
 * @access  Private (System Admin, Hybrid)
 */
router.post('/:id/upload-image', isAuthenticated, canManageTasks, validateMongoId('id'), upload.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Check access permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || task.teamId.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    // Upload to S3 (or local storage fallback)
    const location = await uploadTaskImage(req.file);
    task.designedImage = location;
    await task.save();

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      task
    });
  } catch (error: any) {
    console.error('Error uploading image:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error uploading image'
    });
  }
});

/**
 * @route   DELETE /api/tasks/:id
 * @desc    Delete task
 * @access  Private (System Admin, Hybrid)
 */
router.delete('/:id', isAuthenticated, canManageTasks, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Check access permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || task.teamId.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    await Task.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting task:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting task'
    });
  }
});

export default router;
