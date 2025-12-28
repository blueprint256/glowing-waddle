import express, { Request, Response } from 'express';
import { isAuthenticated } from '../middleware/auth';
import { User } from '../models/User';
import crypto from 'crypto';

const router = express.Router();

// Store state values temporarily (in production, use Redis or session store)
const oauthStates = new Map<string, { userId: string; timestamp: number }>();

// Clean up old states (older than 10 minutes)
setInterval(() => {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [state, data] of oauthStates.entries()) {
    if (data.timestamp < tenMinutesAgo) {
      oauthStates.delete(state);
    }
  }
}, 60 * 1000);

/**
 * Helper function to refresh Canva access token if expired
 * @param user User document with Canva integration
 * @returns Updated user document with fresh token
 */
export async function refreshCanvaTokenIfNeeded(user: any): Promise<any> {
  if (!user.integrations?.canva?.connected) {
    throw new Error('Canva integration not connected');
  }

  const { accessToken, refreshToken, expiresAt } = user.integrations.canva;

  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  // Check if token is expired or expiring soon (within 5 minutes)
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const tokenExpired = !expiresAt || new Date(expiresAt) <= fiveMinutesFromNow;

  if (!tokenExpired) {
    console.log('[Canva Token] Access token still valid for user:', user.email);
    return user;
  }

  console.log('[Canva Token] Refreshing expired access token for user:', user.email);

  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Canva client credentials not configured');
  }

  // Create Basic Auth header: base64(client_id:client_secret)
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenResponse = await fetch('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('[Canva Token] Refresh failed:', {
      status: tokenResponse.status,
      error: errorText
    });

    // If refresh fails, disconnect the integration
    user.integrations.canva.connected = false;
    await user.save();

    throw new Error('Failed to refresh Canva token. Please reconnect your Canva account.');
  }

  const tokenData = await tokenResponse.json();
  const { access_token, refresh_token, expires_in } = tokenData;

  console.log('[Canva Token] Token refreshed successfully for user:', user.email);

  // Update user's tokens
  user.integrations.canva.accessToken = access_token;
  if (refresh_token) {
    user.integrations.canva.refreshToken = refresh_token;
  }
  user.integrations.canva.expiresAt = new Date(Date.now() + expires_in * 1000);

  await user.save();

  return user;
}

/**
 * @route   GET /api/integrations/canva
 * @desc    Initiate Canva OAuth flow
 * @access  Private
 */
router.get('/canva', isAuthenticated, (req: Request, res: Response) => {
  try {
    const clientId = process.env.CANVA_CLIENT_ID;
    const redirectUri = process.env.CANVA_CALLBACK_URL || 'http://localhost:5000/api/integrations/canva/callback';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    console.log('[Canva OAuth] Initiated by user:', req.user?.email);
    console.log('[Canva OAuth] Client ID configured:', !!clientId);
    console.log('[Canva OAuth] Redirect URI:', redirectUri);

    if (!clientId) {
      console.error('[Canva OAuth] Client ID not configured in environment variables');
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=not_configured`);
    }

    if (!req.user?._id) {
      console.error('[Canva OAuth] User ID not found in session');
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=user_not_authenticated`);
    }

    // Generate random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state with user ID (expires in 10 minutes)
    oauthStates.set(state, {
      userId: req.user._id.toString(),
      timestamp: Date.now()
    });

    // Required scopes for Canva Connect API
    // Based on official docs: https://www.canva.com/api/docs/connect/quickstart
    const scopes = [
      'design:content:read',
      'design:content:write',
      'design:meta:read',
      'asset:read',
      'asset:write',
      'profile:read'
    ].join(' ');

    // Build Canva OAuth URL following official Quickstart guide
    const canvaAuthUrl = new URL('https://www.canva.com/api/oauth/authorize');
    canvaAuthUrl.searchParams.append('client_id', clientId);
    canvaAuthUrl.searchParams.append('redirect_uri', redirectUri);
    canvaAuthUrl.searchParams.append('response_type', 'code');
    canvaAuthUrl.searchParams.append('state', state);
    canvaAuthUrl.searchParams.append('scope', scopes);

    console.log('[Canva OAuth] Redirecting to Canva authorization:', canvaAuthUrl.toString());

    // Redirect user to Canva for authorization
    res.redirect(canvaAuthUrl.toString());
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
    // Validate state parameter to prevent CSRF attacks
    const stateData = oauthStates.get(state as string);
    if (!stateData) {
      console.error('[Canva Callback] Invalid or expired state:', state);
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=invalid_state`);
    }

    const { userId } = stateData;
    console.log('[Canva Callback] Looking up user:', userId);

    const user = await User.findById(userId);
    if (!user) {
      console.error('[Canva Callback] User not found:', userId);
      oauthStates.delete(state as string); // Clean up state
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=user_not_found`);
    }

    console.log('[Canva Callback] Processing for user:', user.email);

    // Exchange authorization code for access token
    // Following Canva Connect API Quickstart: https://www.canva.com/api/docs/connect/quickstart
    const clientId = process.env.CANVA_CLIENT_ID;
    const clientSecret = process.env.CANVA_CLIENT_SECRET;
    const redirectUri = process.env.CANVA_CALLBACK_URL || 'http://localhost:5000/api/integrations/canva/callback';

    if (!clientId || !clientSecret) {
      console.error('[Canva Callback] Missing client credentials');
      oauthStates.delete(state as string);
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=server_misconfigured`);
    }

    // Create Basic Auth header: base64(client_id:client_secret)
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    console.log('[Canva Callback] Exchanging code for tokens...');

    const tokenResponse = await fetch('https://api.canva.com/rest/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[Canva Callback] Token exchange failed:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: errorText
      });
      oauthStates.delete(state as string);
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error&message=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    console.log('[Canva Callback] Tokens received successfully:', {
      hasAccessToken: !!access_token,
      hasRefreshToken: !!refresh_token,
      expiresIn: expires_in
    });

    // Update user's Canva integration with real tokens
    if (!user.integrations) {
      user.integrations = {};
    }

    user.integrations.canva = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: new Date(Date.now() + expires_in * 1000),
      connected: true,
      connectedAt: new Date()
    };

    await user.save();

    // Clean up used state
    oauthStates.delete(state as string);

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
