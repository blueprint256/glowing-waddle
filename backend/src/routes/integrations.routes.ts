import express, { Request, Response } from 'express';
import { isAuthenticated } from '../middleware/auth';
import { isSystemAdmin } from '../middleware/rbac';
import { User, UserRole } from '../models/User';
import { AppConfig } from '../models/AppConfig';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, SELECTABLE_IMAGE_MODELS, resolveImageModel } from '../lib/imageModels';

const router = express.Router();

// Canva connect / Edit in Canva: see canva.routes.ts (mounted at /api/integrations/canva).

/**
 * @route   GET /api/integrations/status
 * @desc    Get user's integration status
 * @access  Private
 */
router.get('/status', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user?._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get LLM provider status for System Admins
    let llmProviders = {};
    if (req.user?.role === UserRole.SYSTEM_ADMIN) {
      const config = await AppConfig.getConfig();
      llmProviders = {
        openai: {
          configured: !!(config.openAIApiKey || process.env.OPENAI_API_KEY)
        },
        anthropic: {
          configured: !!(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY)
        },
        grok: {
          configured: !!(config.grokApiKey || process.env.GROK_API_KEY)
        },
        gemini: {
          configured: !!(config.geminiApiKey || process.env.GEMINI_API_KEY)
        }
      };
    }

    res.json({
      success: true,
      integrations: {
        canva: {
          // Only real (encrypted) Canva sign-ins count; the old demo connection stored no real token.
          connected: Boolean(user.integrations?.canva?.connected && String(user.integrations?.canva?.accessToken || '').startsWith('g1:')),
          connectedAt: user.integrations?.canva?.connectedAt
        },
        ...(req.user?.role === UserRole.SYSTEM_ADMIN && llmProviders)
      }
    });
  } catch (error) {
    console.error('Integration status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get integration status'
    });
  }
});

/**
 * @route   GET /api/integrations/openai/status
 * @desc    Get OpenAI configuration status (Admin only)
 * @access  Private (System Admin)
 */
router.get('/openai/status', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    res.json({
      success: true,
      configured: !!(config.openAIApiKey || process.env.OPENAI_API_KEY),
      // 'settings' = saved in the app; 'server' = from the server's .env (OPENAI_API_KEY)
      source: config.openAIApiKey ? 'settings' : process.env.OPENAI_API_KEY ? 'server' : null,
      updatedAt: config.openAIKeyUpdatedAt,
      updatedBy: config.openAIKeyUpdatedBy
    });
  } catch (error: any) {
    console.error('OpenAI status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get OpenAI status'
    });
  }
});

/**
 * @route   PATCH /api/integrations/openai/key
 * @desc    Save OpenAI API key (Admin only)
 * @access  Private (System Admin)
 */
router.patch('/openai/key', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'API key is required'
      });
    }

    // Basic validation: OpenAI keys start with 'sk-'
    if (!apiKey.startsWith('sk-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OpenAI API key format. Keys should start with "sk-"'
      });
    }

    const config = await AppConfig.getConfig();

    // Encrypt and save the key
    config.openAIApiKey = config.encryptApiKey(apiKey.trim());
    config.openAIKeyUpdatedAt = new Date();
    config.openAIKeyUpdatedBy = req.user!._id;

    await config.save();

    console.log(`OpenAI API key updated by: ${req.user!.email}`);

    res.json({
      success: true,
      message: 'OpenAI API key saved successfully',
      configured: true,
      updatedAt: config.openAIKeyUpdatedAt
    });
  } catch (error: any) {
    console.error('OpenAI key save error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save OpenAI API key'
    });
  }
});

/**
 * @route   POST /api/integrations/openai/test
 * @desc    Test OpenAI API connection (Admin only)
 * @access  Private (System Admin)
 */
router.post('/openai/test', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    if (!config.openAIApiKey) {
      return res.status(400).json({
        success: false,
        message: 'OpenAI API key not configured. Please save a key first.'
      });
    }

    // Decrypt the key and test it
    const decryptedKey = config.decryptApiKey(config.openAIApiKey);
    const openai = new OpenAI({ apiKey: decryptedKey });

    // Test the key by listing available models
    const models = await openai.models.list();

    res.json({
      success: true,
      message: 'OpenAI API connection successful',
      modelCount: models.data.length
    });
  } catch (error: any) {
    console.error('OpenAI test error:', error);

    // Handle specific OpenAI errors
    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        message: 'Invalid OpenAI API key. Please check your key and try again.'
      });
    } else if (error.status === 429) {
      return res.status(429).json({
        success: false,
        message: 'OpenAI API rate limit exceeded. Please try again later.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to test OpenAI connection',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/integrations/openai/key
 * @desc    Remove OpenAI API key (Admin only)
 * @access  Private (System Admin)
 */
router.delete('/openai/key', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    config.openAIApiKey = undefined;
    config.openAIKeyUpdatedAt = new Date();
    config.openAIKeyUpdatedBy = req.user!._id;

    await config.save();

    console.log(`OpenAI API key removed by: ${req.user!.email}`);

    res.json({
      success: true,
      message: 'OpenAI API key removed successfully',
      configured: false
    });
  } catch (error: any) {
    console.error('OpenAI key removal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove OpenAI API key'
    });
  }
});

// ===========================
// ANTHROPIC ROUTES
// ===========================

/**
 * @route   GET /api/integrations/anthropic/status
 * @desc    Get Anthropic configuration status (Admin only)
 * @access  Private (System Admin)
 */
router.get('/anthropic/status', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    res.json({
      success: true,
      configured: !!config.anthropicApiKey,
      updatedAt: config.anthropicKeyUpdatedAt,
      updatedBy: config.anthropicKeyUpdatedBy
    });
  } catch (error: any) {
    console.error('Anthropic status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Anthropic status'
    });
  }
});

/**
 * @route   PATCH /api/integrations/anthropic/key
 * @desc    Save Anthropic API key (Admin only)
 * @access  Private (System Admin)
 */
router.patch('/anthropic/key', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'API key is required'
      });
    }

    // Basic validation: Anthropic keys start with 'sk-ant-'
    if (!apiKey.startsWith('sk-ant-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Anthropic API key format. Keys should start with "sk-ant-"'
      });
    }

    const config = await AppConfig.getConfig();

    // Encrypt and save the key
    config.anthropicApiKey = config.encryptApiKey(apiKey.trim());
    config.anthropicKeyUpdatedAt = new Date();
    config.anthropicKeyUpdatedBy = req.user!._id;

    await config.save();

    console.log(`Anthropic API key updated by: ${req.user!.email}`);

    res.json({
      success: true,
      message: 'Anthropic API key saved successfully',
      configured: true,
      updatedAt: config.anthropicKeyUpdatedAt
    });
  } catch (error: any) {
    console.error('Anthropic key save error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save Anthropic API key'
    });
  }
});

/**
 * @route   POST /api/integrations/anthropic/test
 * @desc    Test Anthropic API connection (Admin only)
 * @access  Private (System Admin)
 */
router.post('/anthropic/test', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    if (!config.anthropicApiKey) {
      return res.status(400).json({
        success: false,
        message: 'Anthropic API key not configured. Please save a key first.'
      });
    }

    // Decrypt the key and test it
    const decryptedKey = config.decryptApiKey(config.anthropicApiKey);
    const anthropic = new Anthropic({ apiKey: decryptedKey });

    // Test the key by making a simple API call
    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hello' }]
    });

    res.json({
      success: true,
      message: 'Anthropic API connection successful'
    });
  } catch (error: any) {
    console.error('Anthropic test error:', error);

    // Handle specific Anthropic errors
    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Anthropic API key. Please check your key and try again.'
      });
    } else if (error.status === 429) {
      return res.status(429).json({
        success: false,
        message: 'Anthropic API rate limit exceeded. Please try again later.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to test Anthropic connection',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/integrations/anthropic/key
 * @desc    Remove Anthropic API key (Admin only)
 * @access  Private (System Admin)
 */
router.delete('/anthropic/key', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    config.anthropicApiKey = undefined;
    config.anthropicKeyUpdatedAt = new Date();
    config.anthropicKeyUpdatedBy = req.user!._id;

    await config.save();

    console.log(`Anthropic API key removed by: ${req.user!.email}`);

    res.json({
      success: true,
      message: 'Anthropic API key removed successfully',
      configured: false
    });
  } catch (error: any) {
    console.error('Anthropic key removal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove Anthropic API key'
    });
  }
});

// ===========================
// GROK (xAI) ROUTES
// ===========================

/**
 * @route   GET /api/integrations/grok/status
 * @desc    Get Grok configuration status (Admin only)
 * @access  Private (System Admin)
 */
router.get('/grok/status', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    res.json({
      success: true,
      configured: !!config.grokApiKey,
      updatedAt: config.grokKeyUpdatedAt,
      updatedBy: config.grokKeyUpdatedBy
    });
  } catch (error: any) {
    console.error('Grok status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Grok status'
    });
  }
});

/**
 * @route   PATCH /api/integrations/grok/key
 * @desc    Save Grok API key (Admin only)
 * @access  Private (System Admin)
 */
router.patch('/grok/key', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'API key is required'
      });
    }

    // Basic validation: Grok keys start with 'xai-'
    if (!apiKey.startsWith('xai-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Grok API key format. Keys should start with "xai-"'
      });
    }

    const config = await AppConfig.getConfig();

    // Encrypt and save the key
    config.grokApiKey = config.encryptApiKey(apiKey.trim());
    config.grokKeyUpdatedAt = new Date();
    config.grokKeyUpdatedBy = req.user!._id;

    await config.save();

    console.log(`Grok API key updated by: ${req.user!.email}`);

    res.json({
      success: true,
      message: 'Grok API key saved successfully',
      configured: true,
      updatedAt: config.grokKeyUpdatedAt
    });
  } catch (error: any) {
    console.error('Grok key save error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save Grok API key'
    });
  }
});

/**
 * @route   POST /api/integrations/grok/test
 * @desc    Test Grok API connection (Admin only)
 * @access  Private (System Admin)
 */
router.post('/grok/test', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    if (!config.grokApiKey) {
      return res.status(400).json({
        success: false,
        message: 'Grok API key not configured. Please save a key first.'
      });
    }

    // Decrypt the key and test it
    const decryptedKey = config.decryptApiKey(config.grokApiKey);

    // Grok uses OpenAI-compatible API
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${decryptedKey}`
      },
      body: JSON.stringify({
        model: 'grok-beta',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(errorData.error?.message || 'API request failed');
    }

    res.json({
      success: true,
      message: 'Grok API connection successful'
    });
  } catch (error: any) {
    console.error('Grok test error:', error);

    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Grok API key. Please check your key and try again.'
      });
    } else if (error.message.includes('429') || error.message.includes('rate limit')) {
      return res.status(429).json({
        success: false,
        message: 'Grok API rate limit exceeded. Please try again later.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to test Grok connection',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/integrations/grok/key
 * @desc    Remove Grok API key (Admin only)
 * @access  Private (System Admin)
 */
router.delete('/grok/key', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    config.grokApiKey = undefined;
    config.grokKeyUpdatedAt = new Date();
    config.grokKeyUpdatedBy = req.user!._id;

    await config.save();

    console.log(`Grok API key removed by: ${req.user!.email}`);

    res.json({
      success: true,
      message: 'Grok API key removed successfully',
      configured: false
    });
  } catch (error: any) {
    console.error('Grok key removal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove Grok API key'
    });
  }
});

// ===========================
// GOOGLE GEMINI ROUTES
// ===========================

/**
 * @route   GET /api/integrations/gemini/status
 * @desc    Get Gemini configuration status (Admin only)
 * @access  Private (System Admin)
 */
router.get('/gemini/status', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    res.json({
      success: true,
      configured: !!config.geminiApiKey,
      updatedAt: config.geminiKeyUpdatedAt,
      updatedBy: config.geminiKeyUpdatedBy
    });
  } catch (error: any) {
    console.error('Gemini status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Gemini status'
    });
  }
});

/**
 * @route   PATCH /api/integrations/gemini/key
 * @desc    Save Gemini API key (Admin only)
 * @access  Private (System Admin)
 */
router.patch('/gemini/key', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'API key is required'
      });
    }

    // Basic validation: Gemini keys start with 'AIza'
    if (!apiKey.startsWith('AIza')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Gemini API key format. Keys should start with "AIza"'
      });
    }

    const config = await AppConfig.getConfig();

    // Encrypt and save the key
    config.geminiApiKey = config.encryptApiKey(apiKey.trim());
    config.geminiKeyUpdatedAt = new Date();
    config.geminiKeyUpdatedBy = req.user!._id;

    await config.save();

    console.log(`Gemini API key updated by: ${req.user!.email}`);

    res.json({
      success: true,
      message: 'Gemini API key saved successfully',
      configured: true,
      updatedAt: config.geminiKeyUpdatedAt
    });
  } catch (error: any) {
    console.error('Gemini key save error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save Gemini API key'
    });
  }
});

/**
 * @route   POST /api/integrations/gemini/test
 * @desc    Test Gemini API connection (Admin only)
 * @access  Private (System Admin)
 */
router.post('/gemini/test', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    if (!config.geminiApiKey) {
      return res.status(400).json({
        success: false,
        message: 'Gemini API key not configured. Please save a key first.'
      });
    }

    // Decrypt the key and test it
    const decryptedKey = config.decryptApiKey(config.geminiApiKey);
    const genAI = new GoogleGenerativeAI(decryptedKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Test the key by making a simple API call
    const result = await model.generateContent('Hello');
    const response = await result.response;

    res.json({
      success: true,
      message: 'Gemini API connection successful'
    });
  } catch (error: any) {
    console.error('Gemini test error:', error);

    if (error.message?.includes('API key not valid') || error.message?.includes('401')) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Gemini API key. Please check your key and try again.'
      });
    } else if (error.message?.includes('429') || error.message?.includes('quota')) {
      return res.status(429).json({
        success: false,
        message: 'Gemini API rate limit exceeded. Please try again later.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to test Gemini connection',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/integrations/gemini/key
 * @desc    Remove Gemini API key (Admin only)
 * @access  Private (System Admin)
 */
router.delete('/gemini/key', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    config.geminiApiKey = undefined;
    config.geminiKeyUpdatedAt = new Date();
    config.geminiKeyUpdatedBy = req.user!._id;

    await config.save();

    console.log(`Gemini API key removed by: ${req.user!.email}`);

    res.json({
      success: true,
      message: 'Gemini API key removed successfully',
      configured: false
    });
  } catch (error: any) {
    console.error('Gemini key removal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove Gemini API key'
    });
  }
});

// ===========================
// DEFAULT LLM CONFIGURATION
// ===========================

/**
 * @route   GET /api/integrations/llm/default
 * @desc    Get default LLM configuration (Admin only)
 * @access  Private (System Admin)
 */
router.get('/llm/default', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();

    res.json({
      success: true,
      defaultProvider: config.defaultLLMProvider || 'openai',
      defaultModel: config.defaultLLMModel || 'gpt-4o-mini'
    });
  } catch (error: any) {
    console.error('Get default LLM config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get default LLM configuration'
    });
  }
});

/**
 * @route   PATCH /api/integrations/llm/default
 * @desc    Set default LLM configuration (Admin only)
 * @access  Private (System Admin)
 */
router.patch('/llm/default', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { provider, model } = req.body;

    if (!provider || !model) {
      return res.status(400).json({
        success: false,
        message: 'Provider and model are required'
      });
    }

    // Validate provider
    const validProviders = ['openai', 'anthropic', 'grok', 'gemini'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        success: false,
        message: `Invalid provider. Must be one of: ${validProviders.join(', ')}`
      });
    }

    const config = await AppConfig.getConfig();

    // Check if the selected provider has an API key configured
    const providerKeyMap: Record<string, string | undefined> = {
      openai: config.openAIApiKey,
      anthropic: config.anthropicApiKey,
      grok: config.grokApiKey,
      gemini: config.geminiApiKey
    };

    if (!providerKeyMap[provider]) {
      return res.status(400).json({
        success: false,
        message: `Cannot set ${provider} as default provider. No API key configured for this provider.`
      });
    }

    config.defaultLLMProvider = provider;
    config.defaultLLMModel = model;

    await config.save();

    console.log(`Default LLM config updated by ${req.user!.email}: ${provider}/${model}`);

    res.json({
      success: true,
      message: 'Default LLM configuration saved successfully',
      defaultProvider: config.defaultLLMProvider,
      defaultModel: config.defaultLLMModel
    });
  } catch (error: any) {
    console.error('Set default LLM config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save default LLM configuration'
    });
  }
});

// =====================================
// DEFAULT IMAGE LLM CONFIGURATION
// =====================================

/**
 * @route   GET /api/integrations/image-llm/default
 * @desc    The image model used for pictures (Admin only). See lib/imageModels.ts.
 * @access  Private (System Admin)
 */
router.get('/image-llm/default', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();
    const stored = config.defaultImageLLMModel || DEFAULT_IMAGE_MODEL;
    res.json({
      success: true,
      defaultProvider: 'openai',
      defaultModel: resolveImageModel('create', stored),
      editModel: resolveImageModel('edit', stored),
      storedModel: stored,
      models: IMAGE_MODELS.filter((m) => !m.retired).map((m) => ({ id: m.id, label: m.label }))
    });
  } catch (error: any) {
    console.error('Get default Image LLM config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get default Image LLM configuration'
    });
  }
});

/**
 * @route   PATCH /api/integrations/image-llm/default
 * @desc    Set the image model (Admin only): one of the current OpenAI image models.
 * @access  Private (System Admin)
 */
router.patch('/image-llm/default', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { provider, model } = req.body;

    if ((provider && provider !== 'openai') || typeof model !== 'string' || !SELECTABLE_IMAGE_MODELS.includes(model)) {
      return res.status(400).json({
        success: false,
        message: `Pick one of these image models: ${SELECTABLE_IMAGE_MODELS.join(', ')}.`
      });
    }

    const config = await AppConfig.getConfig();

    if (!config.openAIApiKey && !process.env.OPENAI_API_KEY) {
      return res.status(400).json({
        success: false,
        message: 'Add an OpenAI API key first: pictures are made with OpenAI.'
      });
    }

    config.defaultImageLLMProvider = 'openai';
    config.defaultImageLLMModel = model;
    await config.save();

    console.log(`Image model updated by ${req.user!.email}: openai/${model}`);

    res.json({
      success: true,
      message: 'Image model saved',
      defaultProvider: 'openai',
      defaultModel: resolveImageModel('create', model),
      editModel: resolveImageModel('edit', model)
    });
  } catch (error: any) {
    console.error('Set default Image LLM config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save the image model'
    });
  }
});

export default router;
