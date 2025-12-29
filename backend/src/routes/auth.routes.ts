import express, { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { isAuthenticated } from '../middleware/auth';

const router = express.Router();

/**
 * @route   POST /api/auth/signup
 * @desc    Register new user
 * @access  Public
 */
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Check if user already exists
    const { User } = await import('../models/User');
    const existingUser = await User.findOne({ email: email.toLowerCase() });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create new user
    const newUser = new User({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      role: 'hybrid',
      authProvider: 'local',
      isActive: true
    });

    await newUser.save();

    // Log the user in automatically after signup
    req.login(newUser, (err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: 'Account created but login failed'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Account created successfully',
        user: {
          id: newUser._id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          role: newUser.role
        }
      });
    });
  } catch (error: any) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating account'
    });
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('local', (err: any, user: any, info: any) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Authentication error'
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: info?.message || 'Invalid credentials'
      });
    }

    req.login(user, (err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: 'Login error'
        });
      }

      return res.json({
        success: true,
        message: 'Login successful',
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
        }
      });
    });
  })(req, res, next);
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', isAuthenticated, (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Logout error'
      });
    }

    res.json({
      success: true,
      message: 'Logout successful'
    });
  });
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get('/me', isAuthenticated, (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  res.json({
    success: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      role: req.user.role,
      isActive: req.user.isActive
    }
  });
});

/**
 * @route   GET /api/auth/check
 * @desc    Check authentication status
 * @access  Public
 */
router.get('/check', (req: Request, res: Response) => {
  res.json({
    success: true,
    authenticated: req.isAuthenticated()
  });
});

/**
 * @route   GET /api/auth/google
 * @desc    Initiate Google OAuth flow
 * @access  Public
 */
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

/**
 * @route   GET /api/auth/google/callback
 * @desc    Google OAuth callback
 * @access  Public
 */
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req: Request, res: Response) => {
    // Successful authentication
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/?auth=success`);
  }
);

export default router;
