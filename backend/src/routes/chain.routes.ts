import express, { Request, Response } from 'express';
import { Chain } from '../models/Chain';
import { isAuthenticated, isSystemAdmin } from '../middleware/auth';

const router = express.Router();

/**
 * @route   GET /api/chains
 * @desc    Get all chains
 * @access  Private (System Admin only)
 */
router.get('/', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const chains = await Chain.find().sort({ name: 1 });

    res.json({
      success: true,
      chains
    });
  } catch (error: any) {
    console.error('Error fetching chains:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching chains'
    });
  }
});

/**
 * @route   GET /api/chains/:id
 * @desc    Get chain by ID
 * @access  Private (System Admin only)
 */
router.get('/:id', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const chain = await Chain.findById(req.params.id);

    if (!chain) {
      return res.status(404).json({
        success: false,
        message: 'Chain not found'
      });
    }

    res.json({
      success: true,
      chain
    });
  } catch (error: any) {
    console.error('Error fetching chain:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching chain'
    });
  }
});

/**
 * @route   POST /api/chains
 * @desc    Create a new chain
 * @access  Private (System Admin only)
 */
router.post('/', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { name, steps } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Chain name is required'
      });
    }

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one step is required'
      });
    }

    // Validate each step
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (!step.description || typeof step.description !== 'string' || step.description.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: `Step ${i + 1}: Description is required`
        });
      }

      if (!step.prompt || typeof step.prompt !== 'string' || step.prompt.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: `Step ${i + 1}: Prompt text is required`
        });
      }

      if (!step.provider || !['openai', 'anthropic', 'grok', 'gemini'].includes(step.provider)) {
        return res.status(400).json({
          success: false,
          message: `Step ${i + 1}: Valid provider is required (openai, anthropic, grok, gemini)`
        });
      }

      if (!step.model || typeof step.model !== 'string' || step.model.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: `Step ${i + 1}: Model is required`
        });
      }
    }

    // Check if chain name already exists
    const existingChain = await Chain.findOne({ name: name.trim() });
    if (existingChain) {
      return res.status(400).json({
        success: false,
        message: `Chain '${name.trim()}' already exists`
      });
    }

    // Create chain
    const chain = await Chain.create({
      name: name.trim(),
      steps: steps.map((step: any) => ({
        description: step.description.trim(),
        prompt: step.prompt,
        provider: step.provider,
        model: step.model.trim()
      }))
    });

    res.status(201).json({
      success: true,
      message: 'Chain created successfully',
      chain
    });
  } catch (error: any) {
    console.error('Error creating chain:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating chain'
    });
  }
});

/**
 * @route   PATCH /api/chains/:id
 * @desc    Update a chain
 * @access  Private (System Admin only)
 */
router.patch('/:id', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { name, steps } = req.body;

    const chain = await Chain.findById(req.params.id);
    if (!chain) {
      return res.status(404).json({
        success: false,
        message: 'Chain not found'
      });
    }

    // Update name if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Chain name must be a non-empty string'
        });
      }

      // Check if new name conflicts with another chain
      const existingChain = await Chain.findOne({
        name: name.trim(),
        _id: { $ne: chain._id }
      });
      if (existingChain) {
        return res.status(400).json({
          success: false,
          message: `Chain '${name.trim()}' already exists`
        });
      }

      chain.name = name.trim();
    }

    // Update steps if provided
    if (steps !== undefined) {
      if (!Array.isArray(steps) || steps.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one step is required'
        });
      }

      // Validate each step
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        if (!step.description || typeof step.description !== 'string' || step.description.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1}: Description is required`
          });
        }

        if (!step.prompt || typeof step.prompt !== 'string' || step.prompt.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1}: Prompt text is required`
          });
        }

        if (!step.provider || !['openai', 'anthropic', 'grok', 'gemini'].includes(step.provider)) {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1}: Valid provider is required (openai, anthropic, grok, gemini)`
          });
        }

        if (!step.model || typeof step.model !== 'string' || step.model.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1}: Model is required`
          });
        }
      }

      chain.steps = steps.map((step: any) => ({
        description: step.description.trim(),
        prompt: step.prompt,
        provider: step.provider,
        model: step.model.trim()
      }));
    }

    await chain.save();

    res.json({
      success: true,
      message: 'Chain updated successfully',
      chain
    });
  } catch (error: any) {
    console.error('Error updating chain:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating chain'
    });
  }
});

/**
 * @route   DELETE /api/chains/:id
 * @desc    Delete a chain
 * @access  Private (System Admin only)
 */
router.delete('/:id', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const chain = await Chain.findById(req.params.id);

    if (!chain) {
      return res.status(404).json({
        success: false,
        message: 'Chain not found'
      });
    }

    // TODO: Check if chain is referenced by any command mappings before deleting
    // For now, we'll allow deletion

    await chain.deleteOne();

    res.json({
      success: true,
      message: 'Chain deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting chain:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting chain'
    });
  }
});

export default router;
