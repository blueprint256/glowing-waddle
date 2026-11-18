import express, { Request, Response } from 'express';
import { Prompt } from '../models/Prompt';
import { isAuthenticated } from '../middleware/auth';
import { isSystemAdmin } from '../middleware/rbac';
import { validateMongoId } from '../middleware/validation';
import mongoose from 'mongoose';
import { Task } from '../models/Task';
import { PLACEHOLDERS, checkPlaceholders } from '../lib/placeholders';
import { formatNote, isCorner, isFormat, logoNote, referenceNotes } from '../lib/postPicture';
import { compileSuperPrompt } from '../services/llmService';
import { CAPTION_STYLES, postContext } from '../services/postAI';

const router = express.Router();

/**
 * Prompt editor helpers (decision 22): the list of {placeholders}, a check for names that don't
 * exist, and a preview of the prompt filled in with a real post. Defined before '/:id'.
 */
router.get('/placeholders', isAuthenticated, isSystemAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, placeholders: PLACEHOLDERS });
});

router.post('/check', isAuthenticated, isSystemAdmin, (req: Request, res: Response) => {
  const template = typeof req.body?.template === 'string' ? req.body.template : '';
  res.json({ success: true, ...checkPlaceholders(template) });
});

router.post('/preview', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const template = typeof req.body?.template === 'string' ? req.body.template : '';
    const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : '';
    if (!template.trim()) return res.status(400).json({ success: false, message: 'Write the prompt first.' });
    if (!mongoose.isValidObjectId(taskId)) return res.status(400).json({ success: false, message: 'Choose a post to preview with.' });
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Post not found' });
    const { campaign, companyInfo } = await postContext(task, req.user!._id as mongoose.Types.ObjectId);
    const refs = task.references || [];
    const data: Record<string, unknown> = {
      taskName: task.name,
      taskDescription: task.description || '',
      taskContent: task.content || '',
      instruction: CAPTION_STYLES.improve.instruction,
      platform: '',
      ...(task.designedImage ? { baseImage: task.designedImage } : {}),
      ...Object.fromEntries(refs.map((r, i) => [`attachedImage${i + 1}`, r.url])),
      references: referenceNotes(refs.map((r) => ({ role: r.role, name: r.name }))) || 'None.',
      format: formatNote(isFormat(task.pictureOptions?.format) ? task.pictureOptions!.format : 'square'),
      logoNote: logoNote(isCorner(task.pictureOptions?.logo) ? task.pictureOptions!.logo : null),
      ...(campaign ? { campaignDetails: campaign } : {}),
      ...(companyInfo ? { companyInfo } : {})
    };
    const compiled = compileSuperPrompt(template, data as any);
    res.json({ success: true, compiled, post: { id: task._id, name: task.name }, ...checkPlaceholders(template) });
  } catch (error) {
    console.error('Error previewing prompt:', error);
    res.status(500).json({ success: false, message: 'Couldn’t preview the prompt.' });
  }
});

/**
 * @route   GET /api/prompts
 * @desc    Get all prompts (System Admin only)
 * @access  Private (System Admin)
 */
router.get('/', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    const total = await Prompt.countDocuments();
    const prompts = await Prompt.find()
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      prompts,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching prompts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching prompts'
    });
  }
});

/**
 * @route   GET /api/prompts/name/:name
 * @desc    Get prompt by name
 * @access  Private (authenticated users)
 */
router.get('/name/:name', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const prompt = await Prompt.findOne({ name: req.params.name });

    if (!prompt) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    res.json({
      success: true,
      prompt
    });
  } catch (error: any) {
    console.error('Error fetching prompt:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching prompt'
    });
  }
});

/**
 * @route   GET /api/prompts/:id
 * @desc    Get prompt by ID
 * @access  Private (System Admin)
 */
router.get('/:id', isAuthenticated, isSystemAdmin, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const prompt = await Prompt.findById(req.params.id);

    if (!prompt) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    res.json({
      success: true,
      prompt
    });
  } catch (error: any) {
    console.error('Error fetching prompt:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching prompt'
    });
  }
});

/**
 * @route   POST /api/prompts
 * @desc    Create a new prompt (System Admin only)
 * @access  Private (System Admin)
 */
router.post('/', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { name, details, llmProvider, llmModel, imageLLMProvider, imageLLMModel } = req.body;

    if (!name || !details) {
      return res.status(400).json({
        success: false,
        message: 'Name and details are required'
      });
    }

    // Check if prompt with same name already exists
    const existingPrompt = await Prompt.findOne({ name });
    if (existingPrompt) {
      return res.status(400).json({
        success: false,
        message: 'Prompt with this name already exists'
      });
    }

    // Keep the model settings sent with a new prompt (they used to be dropped until a later edit).
    const prompt = await Prompt.create({
      name,
      details,
      ...(llmProvider ? { llmProvider } : {}),
      ...(llmModel ? { llmModel } : {}),
      ...(imageLLMProvider ? { imageLLMProvider } : {}),
      ...(imageLLMModel ? { imageLLMModel } : {})
    });

    res.status(201).json({
      success: true,
      message: 'Prompt created successfully',
      prompt
    });
  } catch (error: any) {
    console.error('Error creating prompt:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating prompt',
      error: error.message
    });
  }
});

/**
 * @route   PATCH /api/prompts/:id
 * @desc    Update prompt (System Admin only)
 * @access  Private (System Admin)
 */
router.patch('/:id', isAuthenticated, isSystemAdmin, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const { name, details, llmProvider, llmModel, imageLLMProvider, imageLLMModel } = req.body;

    const prompt = await Prompt.findById(req.params.id);
    if (!prompt) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    // If name is being changed, check if new name already exists
    if (name && name !== prompt.name) {
      const existingPrompt = await Prompt.findOne({ name });
      if (existingPrompt) {
        return res.status(400).json({
          success: false,
          message: 'Prompt with this name already exists'
        });
      }
      prompt.name = name;
    }

    if (details !== undefined) {
      prompt.details = details;
    }

    // Handle LLM provider/model overrides (for text generation)
    if (llmProvider !== undefined) {
      prompt.llmProvider = llmProvider || undefined;
    }

    if (llmModel !== undefined) {
      prompt.llmModel = llmModel || undefined;
    }

    // Handle Image LLM provider/model overrides (for image generation)
    if (imageLLMProvider !== undefined) {
      prompt.imageLLMProvider = imageLLMProvider || undefined;
    }

    if (imageLLMModel !== undefined) {
      prompt.imageLLMModel = imageLLMModel || undefined;
    }

    await prompt.save();

    res.json({
      success: true,
      message: 'Prompt updated successfully',
      prompt
    });
  } catch (error: any) {
    console.error('Error updating prompt:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating prompt'
    });
  }
});

/**
 * @route   DELETE /api/prompts/:id
 * @desc    Delete prompt (System Admin only)
 * @access  Private (System Admin)
 */
router.delete('/:id', isAuthenticated, isSystemAdmin, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const prompt = await Prompt.findByIdAndDelete(req.params.id);

    if (!prompt) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    res.json({
      success: true,
      message: 'Prompt deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting prompt:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting prompt'
    });
  }
});

export default router;
