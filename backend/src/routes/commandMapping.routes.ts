import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { CommandMapping } from '../models/CommandMapping';
import { Prompt } from '../models/Prompt';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { validateMongoId } from '../middleware/validation';

const router = express.Router();

/**
 * Middleware to ensure only System Admins can access command mappings
 */
const isSystemAdmin = (req: Request, res: Response, next: Function) => {
  if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Only System Administrators can manage command mappings'
    });
  }
  next();
};

/**
 * @route   GET /api/command-mappings
 * @desc    Get all command mappings (with populated prompt details)
 * @access  Private (System Admin only)
 */
router.get('/', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const mappings = await CommandMapping.find()
      .populate('promptId', 'name details')
      .populate('steps.promptId', 'name details')
      .sort({ command: 1 });

    res.json({
      success: true,
      mappings
    });
  } catch (error: any) {
    console.error('Error fetching command mappings:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching command mappings'
    });
  }
});

/**
 * @route   GET /api/command-mappings/command/:commandName
 * @desc    Get command mapping by command name (used for LLM execution)
 * @access  Private (Authenticated users can look up commands)
 */
router.get('/command/:commandName', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const mapping = await CommandMapping.findOne({ command: req.params.commandName })
      .populate('promptId', 'name details')
      .populate('steps.promptId', 'name details');

    if (!mapping) {
      return res.status(404).json({
        success: false,
        message: `Command '${req.params.commandName}' is not configured. Please contact your administrator.`
      });
    }

    res.json({
      success: true,
      mapping
    });
  } catch (error: any) {
    console.error('Error fetching command mapping:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching command mapping'
    });
  }
});

/**
 * @route   POST /api/command-mappings
 * @desc    Create a new command mapping (supports legacy promptId or new steps array)
 * @access  Private (System Admin only)
 */
router.post('/', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { command, promptId, steps } = req.body;

    // Validation
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Command name is required'
      });
    }

    // Must provide either promptId (legacy) or steps (new multi-step)
    if (!promptId && (!steps || !Array.isArray(steps) || steps.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Either promptId or steps array is required'
      });
    }

    // Validate legacy promptId format
    if (promptId) {
      if (typeof promptId !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Prompt ID must be a string'
        });
      }

      // Check if prompt exists
      const prompt = await Prompt.findById(promptId);
      if (!prompt) {
        return res.status(404).json({
          success: false,
          message: 'Prompt not found'
        });
      }
    }

    // Validate steps array format
    if (steps && Array.isArray(steps)) {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        if (!step.promptId || typeof step.promptId !== 'string') {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1}: promptId is required and must be a string`
          });
        }

        // Check if prompt exists
        const prompt = await Prompt.findById(step.promptId);
        if (!prompt) {
          return res.status(404).json({
            success: false,
            message: `Step ${i + 1}: Prompt not found`
          });
        }

        // Validate provider if provided
        if (step.provider && !['openai', 'anthropic', 'grok', 'gemini'].includes(step.provider)) {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1}: Invalid provider. Must be one of: openai, anthropic, grok, gemini`
          });
        }

        // Validate model if provided (basic validation - model must be a string)
        if (step.model && typeof step.model !== 'string') {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1}: Model must be a string`
          });
        }
      }
    }

    // Check if command already exists
    const existingMapping = await CommandMapping.findOne({ command: command.trim() });
    if (existingMapping) {
      return res.status(400).json({
        success: false,
        message: `Command '${command.trim()}' already has a mapping. Use PATCH to update it.`
      });
    }

    // Create mapping with either legacy promptId or new steps
    const mappingData: any = {
      command: command.trim()
    };

    if (steps && Array.isArray(steps) && steps.length > 0) {
      // Use new multi-step format
      mappingData.steps = steps;
    } else if (promptId) {
      // Use legacy single-prompt format
      mappingData.promptId = promptId;
    }

    const mapping = await CommandMapping.create(mappingData);

    const populatedMapping = await CommandMapping.findById(mapping._id)
      .populate('promptId', 'name details')
      .populate('steps.promptId', 'name details');

    res.status(201).json({
      success: true,
      message: 'Command mapping created successfully',
      mapping: populatedMapping
    });
  } catch (error: any) {
    console.error('Error creating command mapping:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating command mapping'
    });
  }
});

/**
 * @route   PATCH /api/command-mappings/:id
 * @desc    Update a command mapping (supports legacy promptId or new steps array)
 * @access  Private (System Admin only)
 */
router.patch('/:id', isAuthenticated, isSystemAdmin, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const { command, promptId, steps } = req.body;

    const mapping = await CommandMapping.findById(req.params.id);
    if (!mapping) {
      return res.status(404).json({
        success: false,
        message: 'Command mapping not found'
      });
    }

    // Update command if provided
    if (command !== undefined) {
      if (typeof command !== 'string' || command.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Command name must be a non-empty string'
        });
      }

      // Check if new command name conflicts with another mapping
      const existingMapping = await CommandMapping.findOne({
        command: command.trim(),
        _id: { $ne: mapping._id }
      });
      if (existingMapping) {
        return res.status(400).json({
          success: false,
          message: `Command '${command.trim()}' is already in use`
        });
      }

      mapping.command = command.trim();
    }

    // Update steps if provided (new multi-step format)
    if (steps !== undefined) {
      if (!Array.isArray(steps) || steps.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Steps must be a non-empty array'
        });
      }

      // Validate each step
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        if (!step.promptId || typeof step.promptId !== 'string') {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1}: promptId is required and must be a string`
          });
        }

        // Check if prompt exists
        const prompt = await Prompt.findById(step.promptId);
        if (!prompt) {
          return res.status(404).json({
            success: false,
            message: `Step ${i + 1}: Prompt not found`
          });
        }

        // Validate provider if provided
        if (step.provider && !['openai', 'anthropic', 'grok', 'gemini'].includes(step.provider)) {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1}: Invalid provider. Must be one of: openai, anthropic, grok, gemini`
          });
        }

        // Validate model if provided
        if (step.model && typeof step.model !== 'string') {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1}: Model must be a string`
          });
        }
      }

      // Clear legacy promptId and set new steps
      mapping.promptId = undefined;
      mapping.steps = steps;
    }
    // Update legacy promptId if provided (and steps not provided)
    else if (promptId !== undefined) {
      if (typeof promptId !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Prompt ID must be a string'
        });
      }

      // Check if prompt exists
      const prompt = await Prompt.findById(promptId);
      if (!prompt) {
        return res.status(404).json({
          success: false,
          message: 'Prompt not found'
        });
      }

      // Clear steps array and set legacy promptId
      mapping.steps = undefined;
      mapping.promptId = new mongoose.Types.ObjectId(promptId);
    }

    await mapping.save();

    const updatedMapping = await CommandMapping.findById(mapping._id)
      .populate('promptId', 'name details')
      .populate('steps.promptId', 'name details');

    res.json({
      success: true,
      message: 'Command mapping updated successfully',
      mapping: updatedMapping
    });
  } catch (error: any) {
    console.error('Error updating command mapping:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating command mapping'
    });
  }
});

/**
 * @route   DELETE /api/command-mappings/:id
 * @desc    Delete a command mapping
 * @access  Private (System Admin only)
 */
router.delete('/:id', isAuthenticated, isSystemAdmin, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const mapping = await CommandMapping.findById(req.params.id);
    if (!mapping) {
      return res.status(404).json({
        success: false,
        message: 'Command mapping not found'
      });
    }

    await CommandMapping.deleteOne({ _id: mapping._id });

    res.json({
      success: true,
      message: 'Command mapping deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting command mapping:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting command mapping'
    });
  }
});

export default router;
