import express, { Request, Response } from 'express';
import multer from 'multer';
import { Task, TaskStatus } from '../models/Task';
import { Project } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { User, UserRole } from '../models/User';
import { CommandMapping } from '../models/CommandMapping';
import { isAuthenticated } from '../middleware/auth';
import { canManageTasks } from '../middleware/rbac';
import { checkTaskOwnership } from '../middleware/ownership';
import { validateMongoId } from '../middleware/validation';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { uploadTaskImage, uploadImageFromUrl } from '../utils/s3Service';
import { generateWithPrompt, generateImageWithPrompt } from '../services/llmService';
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
 * @route   POST /api/tasks/:id/refine-description
 * @desc    Refine task description using LLM with command-to-prompt mapping
 * @access  Private (System Admin, Hybrid)
 */
router.post('/:id/refine-description', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!task.description || task.description.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Task has no description to refine'
      });
    }

    // Resolve command-to-prompt mapping for "refine-task-description"
    const commandName = 'refine-task-description';
    const mapping = await CommandMapping.findOne({ command: commandName }).populate('promptId');

    if (!mapping || !mapping.promptId) {
      return res.status(400).json({
        success: false,
        message: `No prompt configured for "${commandName}" command. Please configure it in Settings → Command Mappings.`
      });
    }

    // Get user's company info for placeholders
    const user = await User.findById(req.user!._id);
    const companyInfo = user?.companyInfo;

    // Build dynamic data for prompt compilation
    const dynamicData: any = {
      taskDescription: task.description
    };

    // Add company info if available
    if (companyInfo) {
      dynamicData.companyInfo = companyInfo;
    }

    // Call LLM service with the mapped prompt
    const result = await generateWithPrompt(
      (mapping.promptId as any).name, // Prompt name from mapping
      dynamicData,
      {
        userId: req.user!._id
      }
    );

    res.json({
      success: true,
      message: 'Task description refined successfully',
      originalDescription: task.description,
      refinedDescription: result.content.trim(),
      usage: result.usage
    });

  } catch (error: any) {
    console.error('Error refining task description:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error refining task description'
    });
  }
});

/**
 * @route   POST /api/tasks/:id/generate-poster
 * @desc    Generate a campaign poster image using AI with command-to-prompt mapping
 * @access  Private (System Admin, Hybrid)
 */
router.post('/:id/generate-poster', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  console.log('\n========================================');
  console.log('🎨 POSTER GENERATION REQUEST');
  console.log('========================================');
  console.log('Task ID:', req.params.id);
  console.log('User ID:', req.user!._id);
  console.log('User Email:', req.user!.email);
  console.log('Timestamp:', new Date().toISOString());
  console.log('========================================\n');

  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    console.log('📋 Task Found:', task.name);

    // Resolve command-to-prompt mapping for "generate-poster"
    const commandName = 'generate-poster';
    const mapping = await CommandMapping.findOne({ command: commandName }).populate('promptId');

    if (!mapping || !mapping.promptId) {
      console.log('❌ No command mapping found for:', commandName);
      return res.status(400).json({
        success: false,
        message: `No prompt configured for "${commandName}" command. Please configure it in Settings → Command Mappings.`
      });
    }

    console.log('✅ Command Mapping Found:', (mapping.promptId as any).name);

    // Get user's company info for placeholders
    const user = await User.findById(req.user!._id);
    const companyInfo = user?.companyInfo;

    // Get campaign details for placeholders
    const campaign = await Campaign.findById(task.campaignId);

    // Build dynamic data for prompt compilation
    const dynamicData: any = {
      taskDescription: task.description || task.name
    };

    // Add baseImage if task has a designed image
    if (task.designedImage) {
      dynamicData.baseImage = task.designedImage;
      console.log('🖼️  Task has base image:', task.designedImage);
    } else {
      console.log('⚠️  Task has no base image');
    }

    // Add company info if available
    if (companyInfo) {
      dynamicData.companyInfo = companyInfo;
      console.log('🏢 Company info included:', companyInfo.companyName || 'N/A');
    }

    // Add campaign details if available
    if (campaign) {
      dynamicData.campaignDetails = campaign;
      console.log('📢 Campaign details included:', campaign.name);
    }

    console.log('\n🚀 Starting image generation workflow...\n');

    // Call image generation LLM service with the mapped prompt
    const result = await generateImageWithPrompt(
      (mapping.promptId as any).name, // Prompt name from mapping
      dynamicData,
      {
        userId: req.user!._id
      }
    );

    console.log('🎉 Image generated successfully, uploading to S3...\n');

    // Download the generated image from OpenAI's temporary URL and upload to S3
    const permanentImageUrl = await uploadImageFromUrl(result.imageUrl, 'generated-posters');

    console.log('\n========================================');
    console.log('✅ POSTER GENERATION SUCCESS');
    console.log('========================================');
    console.log('Task ID:', req.params.id);
    console.log('Permanent Image URL:', permanentImageUrl);
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    res.json({
      success: true,
      message: 'Poster generated successfully',
      generatedImageUrl: permanentImageUrl,
      compiledPrompt: result.compiledPrompt
    });

  } catch (error: any) {
    console.log('\n========================================');
    console.log('❌ POSTER GENERATION FAILED');
    console.log('========================================');
    console.log('Task ID:', req.params.id);
    console.log('Error:', error.message);
    console.log('Stack:', error.stack);
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    res.status(500).json({
      success: false,
      message: error.message || 'Error generating poster'
    });
  }
});

/**
 * @route   PATCH /api/tasks/:id/adopt-poster
 * @desc    Adopt the generated poster as the main task image
 * @access  Private (System Admin, Hybrid)
 */
router.patch('/:id/adopt-poster', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const { generatedImageUrl } = req.body;

    if (!generatedImageUrl) {
      return res.status(400).json({
        success: false,
        message: 'Generated image URL is required'
      });
    }

    // Update task's designedImage with the generated poster
    task.designedImage = generatedImageUrl;
    task.lastModifiedBy = req.user!._id;
    await task.save();

    // Log the update
    await logAudit({
      action: AuditAction.EVENT_UPDATED,
      userId: req.user!._id,
      targetType: 'Task',
      targetId: task._id,
      metadata: { action: 'adopted-poster', imageUrl: generatedImageUrl },
      req
    });

    const updatedTask = await Task.findById(task._id)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Poster adopted successfully',
      task: updatedTask
    });

  } catch (error: any) {
    console.error('Error adopting poster:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error adopting poster'
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

export default router;
