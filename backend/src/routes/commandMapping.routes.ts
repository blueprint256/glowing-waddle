import express, { Request, Response } from 'express';
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
      .populate('promptId', 'name details');

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
 * @desc    Create a new command mapping
 * @access  Private (System Admin only)
 */
router.post('/', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { command, promptId } = req.body;

    // Validation
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Command name is required'
      });
    }

    if (!promptId || typeof promptId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Prompt ID is required'
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

    // Check if command already exists
    const existingMapping = await CommandMapping.findOne({ command: command.trim() });
    if (existingMapping) {
      return res.status(400).json({
        success: false,
        message: `Command '${command.trim()}' already has a mapping. Use PATCH to update it.`
      });
    }

    // Create mapping
    const mapping = await CommandMapping.create({
      command: command.trim(),
      promptId
    });

    const populatedMapping = await CommandMapping.findById(mapping._id)
      .populate('promptId', 'name details');

    res.status(201).json({
      success: true,
      message: 'Command mapping created successfully',
      mapping: populatedMapping
    });
  } catch (error: any) {
    console.error('Error creating command mapping:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating command mapping'
    });
  }
});

/**
 * @route   PATCH /api/command-mappings/:id
 * @desc    Update a command mapping
 * @access  Private (System Admin only)
 */
router.patch('/:id', isAuthenticated, isSystemAdmin, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const { command, promptId } = req.body;

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

    // Update promptId if provided
    if (promptId !== undefined) {
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

      mapping.promptId = new mongoose.Types.ObjectId(promptId);
    }

    await mapping.save();

    const updatedMapping = await CommandMapping.findById(mapping._id)
      .populate('promptId', 'name details');

    res.json({
      success: true,
      message: 'Command mapping updated successfully',
      mapping: updatedMapping
    });
  } catch (error: any) {
    console.error('Error updating command mapping:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating command mapping'
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
