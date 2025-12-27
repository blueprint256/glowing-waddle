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

  if (!clientId) {
    return res.status(500).json({
      success: false,
      message: 'Canva integration not configured'
    });
  }

  // Canva OAuth URL
  const canvaAuthUrl = `https://www.canva.com/api/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}&scope=design:read design:content:read`;

  res.redirect(canvaAuthUrl);
});

/**
 * @route   GET /api/integrations/canva/callback
 * @desc    Canva OAuth callback
 * @access  Public
 */
router.get('/canva/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (!code || !state) {
    return res.redirect(`${frontendUrl}/settings?integration=canva&status=error`);
  }

  try {
    // In a real implementation, you would exchange the code for an access token
    // For now, we'll simulate a successful connection
    const userId = state as string;
    const user = await User.findById(userId);

    if (!user) {
      return res.redirect(`${frontendUrl}/settings?integration=canva&status=error`);
    }

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

    res.redirect(`${frontendUrl}/settings?integration=canva&status=success`);
  } catch (error) {
    console.error('Canva callback error:', error);
    res.redirect(`${frontendUrl}/settings?integration=canva&status=error`);
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
