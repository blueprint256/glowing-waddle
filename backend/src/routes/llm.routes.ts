import express, { Request, Response } from 'express';
import { User, UserRole } from '../models/User';
import { Campaign } from '../models/Campaign';
import { isAuthenticated } from '../middleware/auth';
import { isSystemAdmin } from '../middleware/rbac';
import { generateWithPrompt, SuperPromptParams } from '../services/llmService';
import { LLMUsage } from '../models/LLMUsage';
import { validateMongoId } from '../middleware/validation';

const router = express.Router();

/**
 * @route   POST /api/llm/run
 * @desc    Run a prompt through LLM (System Admin only)
 * @access  Private (System Admin)
 */
router.post('/run', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { promptName, dynamicData } = req.body;

    if (!promptName) {
      return res.status(400).json({
        success: false,
        message: 'Prompt name is required'
      });
    }

    // Build parameters for prompt compilation
    const params: SuperPromptParams = {
      ...dynamicData
    };

    // Generate content using LLM
    const result = await generateWithPrompt(promptName, params, {
      userId: req.user!._id
    });

    res.json({
      success: true,
      message: 'Content generated successfully',
      content: result.content,
      compiledPrompt: result.compiledPrompt,
      usage: result.usage
    });
  } catch (error: any) {
    console.error('Error running LLM:', error);

    // Check for specific error messages
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    } else if (error.message.includes('API key')) {
      return res.status(500).json({
        success: false,
        message: 'OpenAI API is not configured. Please contact your administrator.'
      });
    } else if (error.message.includes('rate limit')) {
      return res.status(429).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error generating content',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/llm/generate-campaign-tasks
 * @desc    Generate tasks for a campaign using LLM (System Admin only)
 * @access  Private (System Admin)
 */
router.post('/generate-campaign-tasks', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { campaignId, promptName } = req.body;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        message: 'Campaign ID is required'
      });
    }

    // Fetch campaign
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // Fetch user with company info
    const user = await User.findById(req.user!._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prepare parameters for prompt compilation
    const params: SuperPromptParams = {
      companyInfo: user.companyInfo || {},
      campaignDetails: {
        name: campaign.name,
        description: campaign.description,
        goals: campaign.goals,
        coreMessages: campaign.coreMessages,
        hashtags: campaign.hashtags,
        startDate: campaign.startDate,
        endDate: campaign.endDate
      }
    };

    // Use the provided prompt name or default
    const promptToUse = promptName || 'Generate Campaign Tasks';

    // Generate content using LLM
    const result = await generateWithPrompt(promptToUse, params, {
      userId: req.user!._id
    });

    res.json({
      success: true,
      message: 'Campaign tasks generated successfully',
      content: result.content,
      compiledPrompt: result.compiledPrompt,
      usage: result.usage,
      campaignId: campaign._id,
      campaignName: campaign.name
    });
  } catch (error: any) {
    console.error('Error generating campaign tasks:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    } else if (error.message.includes('API key')) {
      return res.status(500).json({
        success: false,
        message: 'OpenAI API is not configured. Please contact your administrator.'
      });
    } else if (error.message.includes('rate limit')) {
      return res.status(429).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error generating campaign tasks',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/llm/usage
 * @desc    Get LLM usage statistics (System Admin only)
 * @access  Private (System Admin)
 */
router.get('/usage', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Optional filters
    const query: any = {};
    if (req.query.userId) {
      query.userId = req.query.userId;
    }
    if (req.query.promptName) {
      query.promptName = req.query.promptName;
    }
    if (req.query.success !== undefined) {
      query.success = req.query.success === 'true';
    }

    const total = await LLMUsage.countDocuments(query);
    const usageLogs = await LLMUsage.find(query)
      .populate('userId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Calculate totals
    const totals = await LLMUsage.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$estimatedCost' },
          successCount: {
            $sum: { $cond: ['$success', 1, 0] }
          },
          failureCount: {
            $sum: { $cond: ['$success', 0, 1] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      usageLogs,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      },
      totals: totals[0] || {
        totalTokens: 0,
        totalCost: 0,
        successCount: 0,
        failureCount: 0
      }
    });
  } catch (error: any) {
    console.error('Error fetching LLM usage:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching usage statistics'
    });
  }
});

export default router;
