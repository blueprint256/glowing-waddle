import express, { Request, Response } from 'express';
import { Team } from '../models/Team';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canManageTeams } from '../middleware/rbac';
import { validateTeamCreation, validateMongoId } from '../middleware/validation';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';

const router = express.Router();

/**
 * @route   GET /api/teams
 * @desc    Get all teams
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const query: any = {};

    // Filter active teams unless explicitly requested
    if (req.query.includeInactive !== 'true') {
      query.isActive = true;
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

    res.json({
      success: true,
      team
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
 * @route   POST /api/teams
 * @desc    Create a new team
 * @access  Private (System Admin only)
 */
router.post('/', isAuthenticated, canManageTeams, validateTeamCreation, async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;

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

    const populatedTeam = await Team.findById(team._id)
      .populate('createdBy', 'firstName lastName');

    res.status(201).json({
      success: true,
      message: 'Team created successfully',
      team: populatedTeam
    });
  } catch (error: any) {
    console.error('Error creating team:', error);

    // Handle duplicate team name
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A team with this name already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating team'
    });
  }
});

/**
 * @route   PUT /api/teams/:id
 * @desc    Update team
 * @access  Private (System Admin only)
 */
router.put('/:id', isAuthenticated, canManageTeams, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    const oldData = { ...team.toObject() };
    const { name, description, isActive } = req.body;

    // Update fields
    if (name) team.name = name;
    if (description !== undefined) team.description = description;
    if (isActive !== undefined) team.isActive = isActive;

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

    const updatedTeam = await Team.findById(team._id)
      .populate('createdBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Team updated successfully',
      team: updatedTeam
    });
  } catch (error: any) {
    console.error('Error updating team:', error);

    // Handle duplicate team name
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A team with this name already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating team'
    });
  }
});

/**
 * @route   DELETE /api/teams/:id
 * @desc    Deactivate team
 * @access  Private (System Admin only)
 */
router.delete('/:id', isAuthenticated, canManageTeams, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    // Deactivate team (soft delete)
    team.isActive = false;
    await team.save();

    // Log deletion
    await logAudit({
      action: AuditAction.TEAM_DELETED,
      userId: req.user!._id,
      targetType: 'Team',
      targetId: team._id,
      req
    });

    res.json({
      success: true,
      message: 'Team deactivated successfully'
    });
  } catch (error: any) {
    console.error('Error deleting team:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting team'
    });
  }
});

export default router;
