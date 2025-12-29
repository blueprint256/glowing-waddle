import express, { Request, Response } from 'express';
import { User, UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canManageUsers } from '../middleware/rbac';
import { validateUserCreation, validateUserUpdate, validateMongoId } from '../middleware/validation';
import { logUserCreated, logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';

const router = express.Router();

/**
 * @route   POST /api/users
 * @desc    Create a new user (System Admin only)
 * @access  Private (System Admin)
 */
router.post('/', isAuthenticated, canManageUsers, validateUserCreation, async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create user
    const user = await User.create({
      email,
      password,
      firstName,
      lastName,
      role
    });

    // Log user creation
    await logUserCreated(req.user!._id, user._id, { email, role }, req);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    });
  } catch (error: any) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/users
 * @desc    Get all users (System Admin only) with pagination
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    // Only System Admins can list all users
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Only System Administrators can list users'
      });
    }

    // Pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Get total count for pagination metadata
    const total = await User.countDocuments({ isActive: true });

    const users = await User.find({ isActive: true })
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      users,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
});

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID with detailed information
 * @access  Private (System Admin only)
 */
router.get('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    // Only System Admins can view user details
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Only System Administrators can view user details'
      });
    }

    const user = await User.findById(req.params.id)
      .select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get campaign count for this user
    const { Campaign } = await import('../models/Campaign');
    const campaignCount = await Campaign.countDocuments({ createdBy: user._id });

    // Prepare user data with additional info
    const userData = {
      ...user.toObject(),
      campaignCount,
      loginMethod: user.authProvider === 'google' ? 'Google OAuth' : 'Email/Password',
      hasCanvaIntegration: user.integrations?.canva?.connected || false
    };

    res.json({
      success: true,
      user: userData
    });
  } catch (error: any) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user'
    });
  }
});

/**
 * @route   PUT /api/users/:id
 * @desc    Update user (System Admin only)
 * @access  Private (System Admin)
 */
router.put('/:id', isAuthenticated, canManageUsers, validateMongoId('id'), validateUserUpdate, async (req: Request, res: Response) => {
  try {
    const { email, firstName, lastName, role, isActive } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const oldData = { ...user.toObject() };

    // Update fields
    if (email) user.email = email;
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (role) user.role = role;
    if (typeof isActive !== 'undefined') user.isActive = isActive;

    await user.save();

    // Log update
    await logAudit({
      action: AuditAction.USER_UPDATED,
      userId: req.user!._id,
      targetType: 'User',
      targetId: user._id,
      changes: { old: oldData, new: user.toObject() },
      req
    });

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isActive: user.isActive
      }
    });
  } catch (error: any) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user'
    });
  }
});

/**
 * @route   GET /api/users/me/company-info
 * @desc    Get company information for current user
 * @access  Private
 */
router.get('/me/company-info', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user!._id).select('companyInfo');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      companyInfo: user.companyInfo || {}
    });
  } catch (error: any) {
    console.error('Error fetching company info:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching company information'
    });
  }
});

/**
 * @route   PATCH /api/users/me/company-info
 * @desc    Update company information for current user
 * @access  Private (Hybrid Users)
 */
router.patch('/me/company-info', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { companyName, sector, about, productsServices, usp, brandTone, audienceProfile, globalRules } = req.body;

    const user = await User.findById(req.user!._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update company info (only for Hybrid users, but we'll allow it for all authenticated users)
    user.companyInfo = {
      companyName: companyName || user.companyInfo?.companyName,
      sector: sector || user.companyInfo?.sector,
      about: about || user.companyInfo?.about,
      productsServices: productsServices || user.companyInfo?.productsServices,
      usp: usp || user.companyInfo?.usp,
      brandTone: brandTone || user.companyInfo?.brandTone,
      audienceProfile: audienceProfile || user.companyInfo?.audienceProfile,
      globalRules: globalRules || user.companyInfo?.globalRules
    };

    await user.save();

    // Log update
    await logAudit({
      action: AuditAction.USER_UPDATED,
      userId: req.user!._id,
      targetType: 'User',
      targetId: user._id,
      metadata: { companyInfoUpdated: true },
      req
    });

    res.json({
      success: true,
      message: 'Company information updated successfully',
      companyInfo: user.companyInfo
    });
  } catch (error: any) {
    console.error('Error updating company info:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating company information'
    });
  }
});

/**
 * @route   DELETE /api/users/:id
 * @desc    Delete user (System Admin only)
 * @access  Private (System Admin)
 */
router.delete('/:id', isAuthenticated, canManageUsers, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Soft delete by setting isActive to false
    user.isActive = false;
    await user.save();

    // Log deletion
    await logAudit({
      action: AuditAction.USER_DELETED,
      userId: req.user!._id,
      targetType: 'User',
      targetId: user._id,
      req
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user'
    });
  }
});

export default router;
