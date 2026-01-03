import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { CommandMapping } from '../models/CommandMapping';
import { Prompt } from '../models/Prompt';
import { Chain } from '../models/Chain';
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
      .populate('chainId') // Populate chain with all steps
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
      .populate('chainId') // Populate chain with all steps
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
    const { command, promptId, chainId, steps } = req.body;

    // Validation
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Command name is required'
      });
    }

    // Must provide exactly one of: promptId, chainId, or steps
    const hasPromptId = !!promptId;
    const hasChainId = !!chainId;
    const hasSteps = !!(steps && Array.isArray(steps) && steps.length > 0);
    const count = [hasPromptId, hasChainId, hasSteps].filter(Boolean).length;

    if (count === 0) {
      return res.status(400).json({
        success: false,
        message: 'Must provide either promptId, chainId, or steps array'
      });
    }

    if (count > 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot provide multiple of: promptId, chainId, steps. Choose only one.'
      });
    }

    // Validate promptId (single prompt)
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

    // Validate chainId (multi-step chain)
    if (chainId) {
      if (typeof chainId !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Chain ID must be a string'
        });
      }

      // Check if chain exists
      const chain = await Chain.findById(chainId);
      if (!chain) {
        return res.status(404).json({
          success: false,
          message: 'Chain not found'
        });
      }
    }

    // Validate steps array format (legacy)
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

    // Create mapping with promptId, chainId, or steps
    const mappingData: any = {
      command: command.trim()
    };

    if (promptId) {
      // Single prompt
      mappingData.promptId = promptId;
    } else if (chainId) {
      // Multi-step chain
      mappingData.chainId = chainId;
    } else if (steps && Array.isArray(steps) && steps.length > 0) {
      // Legacy steps array
      mappingData.steps = steps;
    }

    const mapping = await CommandMapping.create(mappingData);

    const populatedMapping = await CommandMapping.findById(mapping._id)
      .populate('promptId', 'name details')
      .populate('chainId')
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
    const { command, promptId, chainId, steps } = req.body;

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

      // Clear other fields and set steps
      mapping.promptId = undefined;
      mapping.chainId = undefined;
      mapping.steps = steps;
    }
    // Update chainId if provided
    else if (chainId !== undefined) {
      if (typeof chainId !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Chain ID must be a string'
        });
      }

      // Check if chain exists
      const chain = await Chain.findById(chainId);
      if (!chain) {
        return res.status(404).json({
          success: false,
          message: 'Chain not found'
        });
      }

      // Clear other fields and set chainId
      mapping.promptId = undefined;
      mapping.steps = undefined;
      mapping.chainId = new mongoose.Types.ObjectId(chainId);
    }
    // Update promptId if provided
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

      // Clear other fields and set promptId
      mapping.steps = undefined;
      mapping.chainId = undefined;
      mapping.promptId = new mongoose.Types.ObjectId(promptId);
    }

    await mapping.save();

    const updatedMapping = await CommandMapping.findById(mapping._id)
      .populate('promptId', 'name details')
      .populate('chainId')
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
