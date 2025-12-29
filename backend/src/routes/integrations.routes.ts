import express, { Request, Response } from 'express';
import { isAuthenticated } from '../middleware/auth';
import { isSystemAdmin } from '../middleware/rbac';
import { User, UserRole } from '../models/User';
import { AppConfig } from '../models/AppConfig';
import OpenAI from 'openai';

const router = express.Router();

/**
 * @route   GET /api/integrations/canva
 * @desc    Initiate Canva OAuth flow
 * @access  Private
 */
router.get('/canva', isAuthenticated, (req: Request, res: Response) => {
  const clientId = process.env.CANVA_CLIENT_ID;
  const redirectUri = process.env.CANVA_CALLBACK_URL || 'http://localhost:5000/api/integrations/canva/callback';
  const state = req.user?._id.toString();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  console.log('Canva OAuth initiated by user:', req.user?.email);
  console.log('Canva Client ID configured:', !!clientId);

  if (!clientId) {
    console.error('Canva Client ID not configured');
    // Redirect to frontend with error instead of returning JSON
    return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=not_configured`);
  }

  // For demo purposes, we'll simulate a successful connection without actual Canva OAuth
  // In production, you would use the actual Canva OAuth URL
  // const canvaAuthUrl = `https://www.canva.com/api/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}&scope=design:read design:content:read`;

  // For now, redirect directly to callback with a demo code
  console.log('Demo mode: Simulating Canva OAuth success');
  const demoCode = `demo_${Date.now()}`;
  res.redirect(`${redirectUri}?code=${demoCode}&state=${state}`);
});

/**
 * @route   GET /api/integrations/canva/callback
 * @desc    Canva OAuth callback
 * @access  Public
 */
router.get('/canva/callback', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  console.log('Canva callback received:', { code: !!code, state: !!state, error: oauthError });

  if (oauthError) {
    console.error('Canva OAuth error:', oauthError);
    return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=${oauthError}`);
  }

  if (!code || !state) {
    console.error('Missing code or state in callback');
    return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=missing_params`);
  }

  try {
    // In a real implementation, you would exchange the code for an access token
    // For now, we'll simulate a successful connection
    const userId = state as string;
    const user = await User.findById(userId);

    if (!user) {
      console.error('User not found for ID:', userId);
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=user_not_found`);
    }

    console.log('Connecting Canva for user:', user.email);

    // Update user's Canva integration (in a real app, you'd exchange code for token)
    if (!user.integrations) {
      user.integrations = {};
    }
    if (!user.integrations.canva) {
      user.integrations.canva = {
        connected: false
      };
    }

    user.integrations.canva = {
      accessToken: code as string, // In production, exchange code for actual token
      connected: true,
      connectedAt: new Date()
    };

    await user.save();

    console.log('Canva integration saved successfully for:', user.email);
    res.redirect(`${frontendUrl}/settings?integration=canva&status=success`);
  } catch (error) {
    console.error('Canva callback error:', error);
    res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=server_error`);
  }
});

/**
 * @route   POST /api/integrations/canva/disconnect
 * @desc    Disconnect Canva integration
 * @access  Private
 */
router.post('/canva/disconnect', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user?._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.integrations?.canva) {
      user.integrations.canva = {
        connected: false
      };
      await user.save();
    }

    res.json({
      success: true,
      message: 'Canva integration disconnected'
    });
  } catch (error) {
    console.error('Canva disconnect error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect Canva integration'
    });
  }
});

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

    // Get OpenAI status for System Admins
    let openAIConfigured = false;
    if (req.user?.role === UserRole.SYSTEM_ADMIN) {
      const config = await AppConfig.getConfig();
      openAIConfigured = !!config.openAIApiKey;
    }

    res.json({
      success: true,
      integrations: {
        canva: {
          connected: user.integrations?.canva?.connected || false,
          connectedAt: user.integrations?.canva?.connectedAt
        },
        ...(req.user?.role === UserRole.SYSTEM_ADMIN && {
          openai: {
            configured: openAIConfigured
          }
        })
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
      configured: !!config.openAIApiKey,
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

export default router;
