import express, { Request, Response } from 'express';
import multer from 'multer';
import { Task, TaskStatus } from '../models/Task';
import { SocialPost } from '../models/SocialPost';
import { Project } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { User, UserRole } from '../models/User';
import { CommandMapping } from '../models/CommandMapping';
import { isAuthenticated } from '../middleware/auth';
import { canManageTasks } from '../middleware/rbac';
import { checkTaskOwnership } from '../middleware/ownership';
import { validateMongoId, validateTaskCreate, validateTaskUpdate } from '../middleware/validation';
import { Comment } from '../models/Comment';
import { queueTaskImage } from '../library/hooks';
import { onTaskDeleted } from '../services/lifecycle';
import { USER_SETTABLE_STATUSES, hasPublishingInPlay, normalizePostStatus } from '../services/postStatus';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { searchRegex } from '../utils/regex';
import { uploadTaskImage, uploadImageFromUrl } from '../utils/s3Service';
import { generateWithPrompt, generateImageWithPrompt, executeCommandChain } from '../services/llmService';
import { BUILTIN_IMPROVE_BRIEF, BUILTIN_IMPROVE_CAPTION, CAPTION_STYLES, aiErrorMessage, postContext, runPostCommand } from '../services/postAI';
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
router.post('/', isAuthenticated, canManageTasks, validateTaskCreate, async (req: Request, res: Response) => {
  try {
    const { name, description, projectId, taskDate, content } = req.body;
    const status = req.body.status === undefined ? TaskStatus.DRAFT : normalizePostStatus(req.body.status);
    if (!status || !USER_SETTABLE_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `A new post can be ${USER_SETTABLE_STATUSES.join(', ')}` });
    }

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
      status,
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
        : typeof req.query.projectId === 'string' ? req.query.projectId.split(',') : [];
      query.projectId = { $in: projectIds };
    }

    // Filter by specific campaign(s) if provided (supports multi-select)
    if (req.query.campaignId) {
      const campaignIds = Array.isArray(req.query.campaignId)
        ? req.query.campaignId
        : typeof req.query.campaignId === 'string' ? req.query.campaignId.split(',') : [];

      // If user is Hybrid, ensure they can only access their own campaigns
      if (req.user!.role === UserRole.HYBRID) {
        const ownedCampaigns = await Campaign.find({ createdBy: req.user!._id }).select('_id');
        const ownedCampaignIds = ownedCampaigns.map(c => c._id.toString());
        const filteredCampaignIds = campaignIds.filter((id: any) => ownedCampaignIds.includes(id));
        query.campaignId = { $in: filteredCampaignIds };
      } else {
        query.campaignId = { $in: campaignIds };
      }
    }

    // Filter by status(es) if provided (supports multi-select)
    if (req.query.status) {
      const statuses = Array.isArray(req.query.status)
        ? req.query.status
        : typeof req.query.status === 'string' ? req.query.status.split(',') : [];
      // Older names (Pending, Completed…) are translated, so saved filters and links keep working.
      query.status = { $in: [...new Set(statuses.map((s) => normalizePostStatus(s)).filter(Boolean))] };
    }

    // Filter by date range if provided (unreadable dates are ignored rather than failing the request)
    const dateParam = (v: unknown) => {
      if (typeof v !== 'string' || !v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const dateFrom = dateParam(req.query.dateFrom);
    const dateTo = dateParam(req.query.dateTo);
    if (req.query.unscheduled === 'true') {
      // Posts without a day yet (the Planner's "Not scheduled" tray).
      query.taskDate = null;
    } else if (dateFrom || dateTo) {
      query.taskDate = {};
      if (dateFrom) query.taskDate.$gte = dateFrom;
      if (dateTo) query.taskDate.$lte = dateTo;
    }

    // Leave out posts of archived campaigns (the Planner and Today).
    if (req.query.excludeArchived === 'true') {
      const archived = await Campaign.find({ archived: true }).select('_id');
      if (archived.length) {
        const ids = archived.map((c) => String(c._id));
        if (query.campaignId?.$in) query.campaignId.$in = query.campaignId.$in.filter((id: any) => !ids.includes(String(id)));
        else query.campaignId = { $nin: archived.map((c) => c._id) };
      }
    }

    // Filter by creator (System Admin only)
    if (req.query.createdBy && req.user!.role === UserRole.SYSTEM_ADMIN) {
      const creatorIds = Array.isArray(req.query.createdBy)
        ? req.query.createdBy
        : typeof req.query.createdBy === 'string' ? req.query.createdBy.split(',') : [];

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
    const searchPattern = searchRegex(req.query.search);
    if (searchPattern) {
      query.$or = [
        { name: searchPattern },
        { description: searchPattern }
      ];
    }

    // Pagination parameters
    // Bounded so one request can't ask for the whole database (Calendar asks for up to 5000).
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit as string) || 1000)); // Higher default for flat views
    const skip = (page - 1) * limit;

    // Get total count for pagination metadata
    const total = await Task.countDocuments(query);

    const tasks = await Task.find(query)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      // sort=recent: newest first (Dashboard "Recent tasks"); default: by task date.
      .sort(req.query.sort === 'recent' ? { createdAt: -1 } : { taskDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // include=publishing: where and when each post goes out (one query for the whole page),
    // so calendar cards can show platforms and times.
    let out: any[] = tasks;
    if (String(req.query.include || '').split(',').includes('publishing') && tasks.length) {
      const records = await SocialPost.find({ taskId: { $in: tasks.map((t) => t._id) }, status: { $ne: 'cancelled' } })
        .select('taskId platform status scheduledAt publishedAt')
        .lean();
      const byTask = new Map<string, any[]>();
      for (const r of records) byTask.set(String(r.taskId), [...(byTask.get(String(r.taskId)) || []), r]);
      out = tasks.map((t) => {
        const list = byTask.get(String(t._id)) || [];
        const upcoming = list.filter((r) => ['scheduled', 'publishing', 'processing', 'due'].includes(r.status) && r.scheduledAt);
        const published = list.filter((r) => r.status === 'published');
        const next = upcoming.sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))[0];
        return {
          ...t.toObject(),
          publishing: list.length
            ? {
                platforms: [...new Set(list.filter((r) => r.status !== 'draft').map((r) => r.platform))],
                nextAt: next?.scheduledAt || null,
                publishedAt: published.reduce<Date | null>((latest, r) => (r.publishedAt && (!latest || +new Date(r.publishedAt) > +latest) ? new Date(r.publishedAt) : latest), null),
                failed: list.some((r) => r.status === 'failed' || r.status === 'due')
              }
            : null
        };
      });
    }

    res.json({
      success: true,
      tasks: out,
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
      .populate('campaignId', 'name createdBy startDate endDate')
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // The brand the post belongs to (the campaign owner's), for true-to-life previews.
    const ownerId = (task.campaignId as any)?.createdBy;
    const owner = ownerId ? await User.findById(ownerId).select('companyInfo.companyName companyInfo.primaryLogoUrl firstName lastName') : null;
    const brand = {
      name: owner?.companyInfo?.companyName || (owner ? `${owner.firstName} ${owner.lastName}`.trim() : ''),
      logoUrl: owner?.companyInfo?.primaryLogoUrl || null
    };

    res.json({
      success: true,
      task,
      brand
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
router.put('/:id', isAuthenticated, canManageTasks, validateMongoId('id'), validateTaskUpdate, checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const oldData = { ...task.toObject() };
    const { name, description, taskDate, content } = req.body;

    if (req.body.status !== undefined && req.body.status !== null && req.body.status !== '') {
      const status = normalizePostStatus(req.body.status);
      if (!status) return res.status(400).json({ success: false, message: 'Unknown status' });
      if (status !== task.status) {
        // Scheduled and Needs attention follow Publishing; they can't be set by hand.
        if (!USER_SETTABLE_STATUSES.includes(status)) {
          return res.status(400).json({ success: false, message: `${status} is set by Publishing. Choose ${USER_SETTABLE_STATUSES.join(', ')}.` });
        }
        if (await hasPublishingInPlay(task._id as mongoose.Types.ObjectId)) {
          return res.status(409).json({
            success: false,
            message: 'This post is scheduled or needs attention in Publishing. Cancel or fix it there first.'
          });
        }
        task.status = status;
      }
    }

    // Update fields
    if (name) task.name = name;
    if (description !== undefined) task.description = description;
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
    // The image also becomes the next version of this task's Library item (background, never blocks).
    void queueTaskImage(task.campaignId, task._id, location, req.user!._id, 'Uploaded on the task page');

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
 * @desc    Improve brief: rewrites the post's brief with AI. Returns a suggestion only (nothing is saved).
 *          Body (optional): { brief } to improve unsaved text. Uses the "refine-task-description"
 *          command when it's set up, else a built-in prompt.
 * @access  Private (System Admin, Hybrid; AI on)
 */
router.post('/:id/refine-description', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Post not found' });

    const brief = typeof req.body?.brief === 'string' ? req.body.brief : task.description || '';
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : task.content || '';
    if (!brief.trim() && !task.name.trim()) {
      return res.status(400).json({ success: false, message: 'Write a few words in the brief first.' });
    }

    const { campaign, companyInfo } = await postContext(task, req.user!._id as mongoose.Types.ObjectId);
    const data: Record<string, unknown> = {
      taskName: task.name,
      taskDescription: brief,
      taskContent: caption,
      ...(campaign ? { campaignDetails: campaign } : {}),
      ...(companyInfo ? { companyInfo } : {})
    };
    const { text } = await runPostCommand(
      'refine-task-description',
      { name: 'Improve brief', template: BUILTIN_IMPROVE_BRIEF },
      data,
      req.user!._id as mongoose.Types.ObjectId
    );

    res.json({ success: true, message: 'Suggestion ready', originalDescription: brief, refinedDescription: text });
  } catch (error: any) {
    console.error('Error improving brief:', error);
    const { status, message } = aiErrorMessage(error, 'Couldn’t improve the brief. Try again.');
    res.status(status).json({ success: false, message });
  }
});

/**
 * @route   POST /api/tasks/:id/improve-caption
 * @desc    Improve caption with AI. Returns a suggestion only (nothing is saved).
 *          Body: { style?: improve|shorter|playful|professional|fix|cta|hashtags|x|linkedin|instagram|write,
 *                  caption?, brief? }  (caption/brief: unsaved text to work from)
 *          Uses the "improve-caption" command when it's set up, else a built-in prompt.
 * @access  Private (System Admin, Hybrid; AI on)
 */
router.post('/:id/improve-caption', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Post not found' });

    const caption = typeof req.body?.caption === 'string' ? req.body.caption : task.content || '';
    const brief = typeof req.body?.brief === 'string' ? req.body.brief : task.description || '';
    let styleKey = typeof req.body?.style === 'string' && CAPTION_STYLES[req.body.style] ? req.body.style : 'improve';
    if (!caption.trim()) styleKey = 'write';
    if (styleKey === 'write' && !brief.trim() && !task.name.trim()) {
      return res.status(400).json({ success: false, message: 'Add a brief or a title first, so the AI knows what to write.' });
    }
    const style = CAPTION_STYLES[styleKey];

    const { campaign, companyInfo } = await postContext(task, req.user!._id as mongoose.Types.ObjectId);
    const data: Record<string, unknown> = {
      taskName: task.name,
      taskDescription: brief,
      taskContent: caption,
      instruction: style.instruction,
      platform: style.platform || '',
      ...(campaign ? { campaignDetails: campaign } : {}),
      ...(companyInfo ? { companyInfo } : {})
    };
    const { text } = await runPostCommand(
      'improve-caption',
      { name: 'Improve caption', template: BUILTIN_IMPROVE_CAPTION },
      data,
      req.user!._id as mongoose.Types.ObjectId
    );

    res.json({ success: true, style: styleKey, label: style.label, original: caption, suggestion: text });
  } catch (error: any) {
    console.error('Error improving caption:', error);
    const { status, message } = aiErrorMessage(error, 'Couldn’t improve the caption. Try again.');
    res.status(status).json({ success: false, message });
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
    const mapping = await CommandMapping.findOne({ command: commandName })
      .populate('promptId')
      .populate('chainId')
      .populate('steps.promptId');

    if (!mapping || (!mapping.promptId && !mapping.chainId && (!mapping.steps || mapping.steps.length === 0))) {
      console.log('❌ No command mapping found for:', commandName);
      return res.status(400).json({
        success: false,
        message: `No prompt configured for "${commandName}" command. Please configure it in Settings → Command Mappings.`
      });
    }

    // Log which mapping type is being used
    if (mapping.chainId) {
      console.log('✅ Command Mapping Found: Chain -', (mapping.chainId as any).name);
    } else if (mapping.promptId) {
      console.log('✅ Command Mapping Found: Prompt -', (mapping.promptId as any).name);
    } else {
      console.log('✅ Command Mapping Found: Legacy Steps -', mapping.steps?.length, 'step(s)');
    }

    // Campaign details, and the campaign owner's brand/logos (not the clicking admin's).
    const campaign = await Campaign.findById(task.campaignId);
    const user = await User.findById(campaign?.createdBy || req.user!._id);
    const companyInfo = user?.companyInfo;

    // Build dynamic data for prompt compilation
    const dynamicData: any = {
      taskDescription: task.description || task.name,
      taskName: task.name,
      taskContent: task.content || ''
    };

    // Add available image URLs as individual placeholders (NOT automatically sent to API)
    // The compiled prompt will determine which images are actually used
    if (task.designedImage) {
      dynamicData.baseImage = task.designedImage;
      console.log('🖼️  Available - Base Image:', task.designedImage);
    } else {
      console.log('⚠️  No base image available');
    }

    // Add company logos as individual placeholders (for prompt-driven selection)
    if (companyInfo?.primaryLogoUrl) {
      dynamicData.primaryLogo = companyInfo.primaryLogoUrl;
      console.log('🏢 Available - Primary Logo:', companyInfo.primaryLogoUrl);
    }
    if (companyInfo?.secondaryLogoUrl) {
      dynamicData.secondaryLogo = companyInfo.secondaryLogoUrl;
      console.log('🏢 Available - Secondary Logo:', companyInfo.secondaryLogoUrl);
    }
    if (companyInfo?.tertiaryLogoUrl) {
      dynamicData.tertiaryLogo = companyInfo.tertiaryLogoUrl;
      console.log('🏢 Available - Tertiary Logo:', companyInfo.tertiaryLogoUrl);
    }

    // Add other attached images if task has them
    if (task.attachedImages && task.attachedImages.length > 0) {
      task.attachedImages.forEach((url, index) => {
        dynamicData[`attachedImage${index + 1}`] = url;
        console.log(`📎 Available - Attached Image ${index + 1}:`, url);
      });
    }

    console.log('\n📝 Prompt will determine which images (if any) are sent to API\n');

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

    console.log('\n🚀 Starting generation workflow...\n');

    // Execute command using chain execution (supports single prompts, chains, and legacy steps)
    const result = await executeCommandChain(
      mapping,
      dynamicData,
      {
        userId: req.user!._id
      }
    );

    if (!result.imageUrl) {
      console.log('❌ No image URL in result');
      return res.status(500).json({
        success: false,
        message: 'Image generation failed - no image URL returned'
      });
    }

    console.log('🎉 Image generated successfully, uploading to S3...\n');

    // Download the generated image from OpenAI's temporary URL and upload to S3
    const permanentImageUrl = await uploadImageFromUrl(result.imageUrl, 'generated-posters');

    // Save the generated image to the task as pending (not yet adopted)
    task.pendingGeneratedImage = permanentImageUrl;
    await task.save();

    console.log('\n========================================');
    console.log('✅ POSTER GENERATION SUCCESS');
    console.log('========================================');
    console.log('Task ID:', req.params.id);
    console.log('Permanent Image URL:', permanentImageUrl);
    console.log('Saved to task.pendingGeneratedImage');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    res.json({
      success: true,
      message: 'Poster generated successfully',
      generatedImageUrl: permanentImageUrl,
      compiledPrompts: result.compiledPrompts
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

    if (!task.pendingGeneratedImage) {
      return res.status(400).json({
        success: false,
        message: 'No pending generated image to adopt'
      });
    }

    // Move pendingGeneratedImage to designedImage (adopt the generated poster)
    task.designedImage = task.pendingGeneratedImage;
    void queueTaskImage(task.campaignId, task._id, task.pendingGeneratedImage || '', req.user!._id, 'AI poster adopted');
    task.pendingGeneratedImage = undefined; // Clear the pending image
    task.lastModifiedBy = req.user!._id;
    await task.save();

    // Log the update
    await logAudit({
      action: AuditAction.EVENT_UPDATED,
      userId: req.user!._id,
      targetType: 'Task',
      targetId: task._id,
      metadata: { action: 'adopted-poster', imageUrl: task.designedImage },
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
 * @route   PATCH /api/tasks/:id/discard-poster
 * @desc    Discard the pending generated poster
 * @access  Private (System Admin, Hybrid)
 */
router.patch('/:id/discard-poster', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!task.pendingGeneratedImage) {
      return res.status(400).json({
        success: false,
        message: 'No pending generated image to discard'
      });
    }

    // Clear the pending generated image
    const discardedImageUrl = task.pendingGeneratedImage;
    task.pendingGeneratedImage = undefined;
    task.lastModifiedBy = req.user!._id;
    await task.save();

    // Log the action
    await logAudit({
      action: AuditAction.EVENT_UPDATED,
      userId: req.user!._id,
      targetType: 'Task',
      targetId: task._id,
      metadata: { action: 'discarded-poster', imageUrl: discardedImageUrl },
      req
    });

    const updatedTask = await Task.findById(task._id)
      .populate('projectId', 'name')
      .populate('campaignId', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Poster discarded successfully',
      task: updatedTask
    });

  } catch (error: any) {
    console.error('Error discarding poster:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error discarding poster'
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
    await Comment.deleteMany({ taskId: task._id });
    // Stop its scheduled posts and unlink Library items/Canva edits (see services/lifecycle.ts).
    const { cancelledPosts } = await onTaskDeleted(task._id as any, req.user!._id as any);

    await logAudit({
      action: AuditAction.TASK_DELETED,
      userId: req.user!._id,
      targetType: 'Task',
      targetId: task._id,
      metadata: { name: task.name, projectId: task.projectId, cancelledPosts },
      req
    });

    res.json({
      success: true,
      message: cancelledPosts ? `Task deleted. ${cancelledPosts} scheduled post${cancelledPosts === 1 ? ' was' : 's were'} cancelled.` : 'Task deleted successfully',
      cancelledPosts
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
