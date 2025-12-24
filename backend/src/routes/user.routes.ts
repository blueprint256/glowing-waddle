import express, { Request, Response } from 'express';
import { User, UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canManageUsers } from '../middleware/rbac';
import { validateUserCreation, validateUserUpdate, validateMongoId } from '../middleware/validation';
import { logUserCreated, logUserAddedToTeam, logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import mongoose from 'mongoose';

const router = express.Router();

/**
 * @route   POST /api/users
 * @desc    Create a new user (System Admin only)
 * @access  Private (System Admin)
 */
router.post('/', isAuthenticated, canManageUsers, validateUserCreation, async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, role, teamId } = req.body;

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
      role,
      teamId: teamId ? new mongoose.Types.ObjectId(teamId) : null
    });

    // Log user creation
    await logUserCreated(req.user!._id, user._id, { email, role }, req);

    // If user is added to team, log that too
    if (teamId) {
      await logUserAddedToTeam(req.user!._id, user._id, new mongoose.Types.ObjectId(teamId), req);
    }

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        teamId: user.teamId
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
 * @desc    Get all users (System Admin) or team users
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = { isActive: true };

    // Non-admins can only see users from their team
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId) {
        return res.json({
          success: true,
          users: []
        });
      }
      query.teamId = req.user!.teamId;
    }

    const users = await User.find(query)
      .select('-password')
      .populate('teamId', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      users
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
 * @desc    Get user by ID
 * @access  Private
 */
router.get('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('teamId', 'name');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || user.teamId?.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    res.json({
      success: true,
      user
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
    const { email, firstName, lastName, role, teamId, isActive } = req.body;

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

    // Handle team change
    if (teamId !== undefined) {
      const oldTeamId = user.teamId;
      user.teamId = teamId ? new mongoose.Types.ObjectId(teamId) : null;

      // Log team change
      if (teamId && oldTeamId?.toString() !== teamId) {
        await logUserAddedToTeam(req.user!._id, user._id, new mongoose.Types.ObjectId(teamId), req);
      }
    }

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
        teamId: user.teamId,
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
