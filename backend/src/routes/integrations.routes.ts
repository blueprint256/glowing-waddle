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
  try {
    const clientId = process.env.CANVA_CLIENT_ID;
    const redirectUri = process.env.CANVA_CALLBACK_URL || 'http://localhost:5000/api/integrations/canva/callback';
    const state = req.user?._id.toString();
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    console.log('[Canva OAuth] Initiated by user:', req.user?.email);
    console.log('[Canva OAuth] Client ID configured:', !!clientId);
    console.log('[Canva OAuth] Redirect URI:', redirectUri);

    if (!clientId) {
      console.error('[Canva OAuth] Client ID not configured in environment variables');
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=not_configured`);
    }

    if (!state) {
      console.error('[Canva OAuth] User ID not found in session');
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=user_not_authenticated`);
    }

    // For demo purposes, we'll simulate a successful connection without actual Canva OAuth
    // In production, you would use the actual Canva OAuth URL:
    // const canvaAuthUrl = `https://www.canva.com/api/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}&scope=design:read design:content:read design:content:write asset:read asset:write`;
    // return res.redirect(canvaAuthUrl);

    // For now, redirect directly to callback with a demo code
    console.log('[Canva OAuth] Demo mode: Simulating OAuth success');
    const demoCode = `demo_${Date.now()}`;
    res.redirect(`${redirectUri}?code=${demoCode}&state=${state}`);
  } catch (error: any) {
    console.error('[Canva OAuth] Error initiating OAuth:', {
      message: error.message,
      stack: error.stack
    });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=server_error`);
  }
});

/**
 * @route   GET /api/integrations/canva/callback
 * @desc    Canva OAuth callback
 * @access  Public
 */
router.get('/canva/callback', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  console.log('[Canva Callback] Received:', {
    hasCode: !!code,
    hasState: !!state,
    error: oauthError
  });

  if (oauthError) {
    console.error('[Canva Callback] OAuth error from Canva:', oauthError);
    return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=${oauthError}`);
  }

  if (!code || !state) {
    console.error('[Canva Callback] Missing required parameters:', { code: !!code, state: !!state });
    return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=missing_params`);
  }

  try {
    const userId = state as string;
    console.log('[Canva Callback] Looking up user:', userId);

    const user = await User.findById(userId);
    if (!user) {
      console.error('[Canva Callback] User not found:', userId);
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=user_not_found`);
    }

    console.log('[Canva Callback] Processing for user:', user.email);

    // In a real implementation, exchange code for access token:
    // const tokenResponse = await fetch('https://api.canva.com/oauth/token', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    //   body: new URLSearchParams({
    //     grant_type: 'authorization_code',
    //     code: code as string,
    //     client_id: process.env.CANVA_CLIENT_ID!,
    //     client_secret: process.env.CANVA_CLIENT_SECRET!,
    //     redirect_uri: process.env.CANVA_CALLBACK_URL!
    //   })
    // });
    // if (!tokenResponse.ok) {
    //   throw new Error('Failed to exchange code for token');
    // }
    // const tokenData = await tokenResponse.json();
    // const { access_token, refresh_token, expires_in } = tokenData;

    // Update user's Canva integration
    if (!user.integrations) {
      user.integrations = {};
    }

    user.integrations.canva = {
      accessToken: code as string, // In production, use actual access_token
      refreshToken: undefined, // In production, store refresh_token
      expiresAt: undefined, // In production, calculate expiry: new Date(Date.now() + expires_in * 1000)
      connected: true,
      connectedAt: new Date()
    };

    await user.save();

    console.log('[Canva Callback] Integration saved successfully for:', user.email);
    res.redirect(`${frontendUrl}/settings?integration=canva&status=success`);
  } catch (error: any) {
    console.error('[Canva Callback] Error processing callback:', {
      message: error.message,
      stack: error.stack
    });
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
