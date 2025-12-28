import express, { Request, Response } from 'express';
import { isAuthenticated } from '../middleware/auth';
import { User } from '../models/User';

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

    res.json({
      success: true,
      integrations: {
        canva: {
          connected: user.integrations?.canva?.connected || false,
          connectedAt: user.integrations?.canva?.connectedAt
        }
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

export default router;
