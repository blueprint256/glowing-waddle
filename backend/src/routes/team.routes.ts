import express, { Request, Response } from 'express';
import { Team } from '../models/Team';
import { User, UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canManageTeams } from '../middleware/rbac';
import { validateTeamCreation, validateMongoId } from '../middleware/validation';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';

const router = express.Router();

/**
 * @route   POST /api/teams
 * @desc    Create a new team (System Admin only)
 * @access  Private (System Admin)
 */
router.post('/', isAuthenticated, canManageTeams, validateTeamCreation, async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;

    // Check if team already exists
    const existingTeam = await Team.findOne({ name });
    if (existingTeam) {
      return res.status(400).json({
        success: false,
        message: 'Team with this name already exists'
      });
    }

    // Create team
    const team = await Team.create({
      name,
      description,
      createdBy: req.user!._id
    });

    // Log team creation
    await logAudit({
      action: AuditAction.TEAM_CREATED,
      userId: req.user!._id,
      targetType: 'Team',
      targetId: team._id,
      metadata: { name },
      req
    });

    res.status(201).json({
      success: true,
      message: 'Team created successfully',
      team
    });
  } catch (error: any) {
    console.error('Error creating team:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating team'
    });
  }
});

/**
 * @route   GET /api/teams
 * @desc    Get all teams
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = { isActive: true };

    // Non-admins can only see their own team
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId) {
        return res.json({
          success: true,
          teams: []
        });
      }
      query._id = req.user!.teamId;
    }

    const teams = await Team.find(query)
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      teams
    });
  } catch (error: any) {
    console.error('Error fetching teams:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching teams'
    });
  }
});

/**
 * @route   GET /api/teams/:id
 * @desc    Get team by ID
 * @access  Private
 */
router.get('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email');

    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    // Check access permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId || team._id.toString() !== req.user!.teamId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    // Get team members
    const members = await User.find({ teamId: team._id, isActive: true })
      .select('-password')
      .sort({ firstName: 1 });

    res.json({
      success: true,
      team: {
        ...team.toObject(),
        members
      }
    });
  } catch (error: any) {
    console.error('Error fetching team:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching team'
    });
  }
});

/**
 * @route   PUT /api/teams/:id
 * @desc    Update team (System Admin only)
 * @access  Private (System Admin)
 */
router.put('/:id', isAuthenticated, canManageTeams, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const { name, description, isActive } = req.body;

    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    const oldData = { ...team.toObject() };

    // Update fields
    if (name) team.name = name;
    if (description !== undefined) team.description = description;
    if (typeof isActive !== 'undefined') team.isActive = isActive;

    await team.save();

    // Log update
    await logAudit({
      action: AuditAction.TEAM_UPDATED,
      userId: req.user!._id,
      targetType: 'Team',
      targetId: team._id,
      changes: { old: oldData, new: team.toObject() },
      req
    });

    res.json({
      success: true,
      message: 'Team updated successfully',
      team
    });
  } catch (error: any) {
    console.error('Error updating team:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating team'
    });
  }
});

export default router;
