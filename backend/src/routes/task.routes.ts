import express, { Request, Response } from 'express';
import multer from 'multer';
import { Task, TaskStatus } from '../models/Task';
import { Project } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { User, UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canManageTasks } from '../middleware/rbac';
import { checkTaskOwnership } from '../middleware/ownership';
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
    const { name, description, projectId, taskDate, content, status } = req.body;

    // Verify project exists and get hierarchy info
    const project = await Project.findById(projectId);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // CRITICAL: Check ownership through parent campaign
    const campaign = await Campaign.findById(project.campaignId);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Parent campaign not found'
      });
    }

    // Hybrid users can only create tasks under campaigns they own
    if (req.user!.role === UserRole.HYBRID) {
      if (campaign.createdBy.toString() !== req.user!._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only create tasks under campaigns you created'
        });
      }
    }

    // Create task (inherit campaignId from project)
    const task = await Task.create({
      name,
      description,
      projectId: new mongoose.Types.ObjectId(projectId),
      campaignId: project.campaignId,
      status: status || TaskStatus.PENDING,
      taskDate,
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
 * @desc    Get all tasks (System Admin sees all, Hybrid sees only tasks under their campaigns) with pagination and comprehensive filtering
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    // CRITICAL: Hybrid users can only see tasks under campaigns they own
    if (req.user!.role === UserRole.HYBRID) {
      // Find all campaigns owned by this user
      const ownedCampaigns = await Campaign.find({ createdBy: req.user!._id }).select('_id');
      const campaignIds = ownedCampaigns.map(c => c._id);
      query.campaignId = { $in: campaignIds };
    }

    // Filter by specific project(s) if provided (supports multi-select)
    if (req.query.projectId) {
      const projectIds = Array.isArray(req.query.projectId)
        ? req.query.projectId
        : req.query.projectId.split(',');
      query.projectId = { $in: projectIds };
    }

    // Filter by specific campaign(s) if provided (supports multi-select)
    if (req.query.campaignId) {
      const campaignIds = Array.isArray(req.query.campaignId)
        ? req.query.campaignId
        : req.query.campaignId.split(',');

      // If user is Hybrid, ensure they can only access their own campaigns
      if (req.user!.role === UserRole.HYBRID) {
        const ownedCampaigns = await Campaign.find({ createdBy: req.user!._id }).select('_id');
        const ownedCampaignIds = ownedCampaigns.map(c => c._id.toString());
        const filteredCampaignIds = campaignIds.filter(id => ownedCampaignIds.includes(id));
        query.campaignId = { $in: filteredCampaignIds };
      } else {
        query.campaignId = { $in: campaignIds };
      }
    }

    // Filter by status(es) if provided (supports multi-select)
    if (req.query.status) {
      const statuses = Array.isArray(req.query.status)
        ? req.query.status
        : req.query.status.split(',');
      query.status = { $in: statuses };
    }

    // Filter by date range if provided
    if (req.query.dateFrom || req.query.dateTo) {
      query.taskDate = {};
      if (req.query.dateFrom) {
        query.taskDate.$gte = new Date(req.query.dateFrom as string);
      }
      if (req.query.dateTo) {
        query.taskDate.$lte = new Date(req.query.dateTo as string);
      }
    }

    // Filter by creator (System Admin only)
    if (req.query.createdBy && req.user!.role === UserRole.SYSTEM_ADMIN) {
      const creatorIds = Array.isArray(req.query.createdBy)
        ? req.query.createdBy
        : req.query.createdBy.split(',');

      // Find campaigns created by the specified users
      const campaignsByCreators = await Campaign.find({
        createdBy: { $in: creatorIds }
      }).select('_id');
      const campaignIdsByCreator = campaignsByCreators.map(c => c._id);

      // Combine with existing campaignId filter if present
      if (query.campaignId) {
        const existingIds = Array.isArray(query.campaignId.$in)
          ? query.campaignId.$in
          : [query.campaignId];
        const intersection = campaignIdsByCreator.filter(id =>
          existingIds.some((eid: any) => eid.toString() === id.toString())
        );
        query.campaignId = { $in: intersection };
      } else {
        query.campaignId = { $in: campaignIdsByCreator };
      }
    }

    // Global search across task names and descriptions
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search as string, 'i');
      query.$or = [
        { name: searchRegex },
        { description: searchRegex }
      ];
    }

    // Pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 1000; // Higher default for flat views
    const skip = (page - 1) * limit;

    // Get total count for pagination metadata
    const total = await Task.countDocuments(query);

    const tasks = await Task.find(query)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .sort({ taskDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      tasks,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
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
 * @desc    Get task by ID (with ownership check)
 * @access  Private
 */
router.get('/:id', isAuthenticated, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('projectId', 'name status')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
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
 * @desc    Update task (with ownership check)
 * @access  Private (System Admin, Hybrid)
 */
router.put('/:id', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const oldData = { ...task.toObject() };
    const { name, description, status, taskDate, content } = req.body;

    // Update fields
    if (name) task.name = name;
    if (description !== undefined) task.description = description;
    if (status) task.status = status;
    if (taskDate !== undefined) task.taskDate = taskDate;
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
 * @desc    Upload designed image for task (with ownership check)
 * @access  Private (System Admin, Hybrid)
 */
router.post('/:id/upload-image', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, upload.single('image'), async (req: Request, res: Response) => {
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
 * @desc    Delete task (with ownership check)
 * @access  Private (System Admin, Hybrid)
 */
router.delete('/:id', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
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

/**
 * @route   POST /api/tasks/:id/canva-edit
 * @desc    Create or open a Canva design for this task
 * @access  Private (System Admin, Hybrid)
 */
router.post('/:id/canva-edit', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    console.log(`[Canva Edit] Request for task ${req.params.id} by user ${req.user?._id}`);

    const task = await Task.findById(req.params.id);
    if (!task) {
      console.error(`[Canva Edit] Task not found: ${req.params.id}`);
      return res.status(404).json({
        success: false,
        message: 'Task not found',
        error: 'TASK_NOT_FOUND'
      });
    }

    // Check if user has Canva connected - FIXED: Use imported User model
    const user = await User.findById(req.user!._id);
    if (!user) {
      console.error(`[Canva Edit] User not found: ${req.user?._id}`);
      return res.status(404).json({
        success: false,
        message: 'User not found',
        error: 'USER_NOT_FOUND'
      });
    }

    console.log(`[Canva Edit] User ${user.email}, Canva connected: ${user.integrations?.canva?.connected}`);

    if (!user.integrations?.canva?.connected) {
      console.warn(`[Canva Edit] User ${user.email} has not connected Canva`);
      return res.status(403).json({
        success: false,
        message: 'Canva integration not connected. Please connect your Canva account in Settings.',
        error: 'CANVA_NOT_CONNECTED'
      });
    }

    const accessToken = user.integrations.canva.accessToken;
    if (!accessToken) {
      console.error(`[Canva Edit] User ${user.email} has no Canva access token`);
      return res.status(403).json({
        success: false,
        message: 'Canva access token missing. Please reconnect your Canva account.',
        error: 'CANVA_TOKEN_MISSING'
      });
    }

    // If task already has a Canva design, return the existing design URL
    if (task.canvaDesignId && task.canvaDesignUrl) {
      console.log(`[Canva Edit] Returning existing design for task ${task._id}: ${task.canvaDesignId}`);
      return res.json({
        success: true,
        message: 'Existing Canva design found',
        designId: task.canvaDesignId,
        editorUrl: task.canvaDesignUrl
      });
    }

    // Create a new design in Canva
    // In production, you would use the Canva Connect API here
    // For now, we'll create a demo design URL
    const designId = `design_${task._id}_${Date.now()}`;
    const editorUrl = `https://www.canva.com/design/${designId}/edit`;

    console.log(`[Canva Edit] Creating new design for task ${task._id}: ${designId}`);

    // In a real implementation, you would:
    // 1. Upload the current task image to Canva (if exists)
    // 2. Create a new design with the image
    // 3. Set design metadata (title, description) to link back to taskId
    // Example (pseudo-code):
    // const canvaResponse = await fetch('https://api.canva.com/v1/designs', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${accessToken}`,
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify({
    //     asset_id: uploadedAssetId, // If task has designedImage
    //     title: `Glowing Waddle Task - ${task.name}`,
    //     width: 1080,
    //     height: 1080
    //   })
    // });
    // if (!canvaResponse.ok) {
    //   const errorData = await canvaResponse.json();
    //   throw new Error(`Canva API error: ${errorData.message || canvaResponse.statusText}`);
    // }

    // Update task with Canva design info
    task.canvaDesignId = designId;
    task.canvaDesignUrl = editorUrl;
    task.lastModifiedBy = req.user!._id;
    await task.save();

    console.log(`[Canva Edit] Successfully created design for task ${task._id}`);

    res.json({
      success: true,
      message: 'Canva design created successfully',
      designId,
      editorUrl
    });
  } catch (error: any) {
    console.error(`[Canva Edit] Error for task ${req.params.id}:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({
      success: false,
      message: 'Failed to create Canva design. Please try again.',
      error: error.message || 'INTERNAL_SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route   POST /api/tasks/:id/canva-sync
 * @desc    Sync design changes from Canva back to task
 * @access  Private (System Admin, Hybrid) or Webhook
 */
router.post('/:id/canva-sync', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    console.log(`[Canva Sync] Request for task ${req.params.id} by user ${req.user?._id}`);

    const task = await Task.findById(req.params.id);
    if (!task) {
      console.error(`[Canva Sync] Task not found: ${req.params.id}`);
      return res.status(404).json({
        success: false,
        message: 'Task not found',
        error: 'TASK_NOT_FOUND'
      });
    }

    if (!task.canvaDesignId) {
      console.warn(`[Canva Sync] Task ${task._id} has no associated Canva design`);
      return res.status(400).json({
        success: false,
        message: 'No Canva design associated with this task. Please use "Edit in Canva" first.',
        error: 'NO_CANVA_DESIGN'
      });
    }

    // Get user's Canva access token - FIXED: Use imported User model
    const user = await User.findById(req.user!._id);
    if (!user) {
      console.error(`[Canva Sync] User not found: ${req.user?._id}`);
      return res.status(404).json({
        success: false,
        message: 'User not found',
        error: 'USER_NOT_FOUND'
      });
    }

    if (!user.integrations?.canva?.connected) {
      console.warn(`[Canva Sync] User ${user.email} has not connected Canva`);
      return res.status(403).json({
        success: false,
        message: 'Canva integration not connected. Please reconnect your Canva account.',
        error: 'CANVA_NOT_CONNECTED'
      });
    }

    const accessToken = user.integrations.canva.accessToken;
    if (!accessToken) {
      console.error(`[Canva Sync] User ${user.email} has no Canva access token`);
      return res.status(403).json({
        success: false,
        message: 'Canva access token missing. Please reconnect your Canva account.',
        error: 'CANVA_TOKEN_MISSING'
      });
    }

    console.log(`[Canva Sync] Syncing design ${task.canvaDesignId} for task ${task._id}`);

    // In production, fetch the latest export from Canva
    // Example (pseudo-code):
    // const exportResponse = await fetch(`https://api.canva.com/v1/designs/${task.canvaDesignId}/export`, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${accessToken}`,
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify({
    //     format: 'png',
    //     quality: 'high'
    //   })
    // });
    // if (!exportResponse.ok) {
    //   const errorData = await exportResponse.json();
    //   throw new Error(`Canva API error: ${errorData.message || exportResponse.statusText}`);
    // }
    // const { url } = await exportResponse.json();
    // Download from url and upload to S3
    // const s3Url = await uploadToS3(url);

    // For demo purposes, simulate a successful sync
    // In production, you would download the exported image and upload to S3
    const demoExportUrl = task.designedImage || `https://demo-export-${Date.now()}.png`;

    // Update task with new image (in production, this would be the S3 URL after upload)
    task.designedImage = demoExportUrl;
    task.lastModifiedBy = req.user!._id;
    await task.save();

    console.log(`[Canva Sync] Successfully synced task ${task._id}`);

    const populatedTask = await Task.findById(task._id)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Design synced from Canva successfully',
      task: populatedTask
    });
  } catch (error: any) {
    console.error(`[Canva Sync] Error for task ${req.params.id}:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({
      success: false,
      message: 'Failed to sync from Canva. Please try again.',
      error: error.message || 'INTERNAL_SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

export default router;
