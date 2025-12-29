import express, { Request, Response } from 'express';
import { Prompt } from '../models/Prompt';
import { isAuthenticated } from '../middleware/auth';
import { isSystemAdmin } from '../middleware/rbac';
import { validateMongoId } from '../middleware/validation';

const router = express.Router();

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
router.get('/name/:name', isAuthenticated, async (req: Request, res: Response) => {
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
    const { name, details } = req.body;

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

    const prompt = await Prompt.create({ name, details });

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
    const { name, details, llmProvider, llmModel } = req.body;

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

    // Handle LLM provider/model overrides
    if (llmProvider !== undefined) {
      prompt.llmProvider = llmProvider || undefined;
    }

    if (llmModel !== undefined) {
      prompt.llmModel = llmModel || undefined;
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
