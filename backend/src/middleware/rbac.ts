import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../models/User';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { Event } from '../models/Event';
import mongoose from 'mongoose';

/**
 * Middleware to check if user has required role(s)
 */
export const hasRole = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    if (roles.includes(req.user.role)) {
      return next();
    }

    res.status(403).json({
      success: false,
      message: 'Insufficient permissions'
    });
  };
};

/**
 * Middleware to check if user is System Admin
 */
export const isSystemAdmin = hasRole(UserRole.SYSTEM_ADMIN);

/**
 * Middleware to check if user can manage users (System Admin only)
 */
export const canManageUsers = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  if (req.user.role === UserRole.SYSTEM_ADMIN) {
    return next();
  }

  res.status(403).json({
    success: false,
    message: 'Only System Administrators can manage users'
  });
};

/**
 * Middleware to check if user can manage teams (System Admin only)
 */
export const canManageTeams = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  if (req.user.role === UserRole.SYSTEM_ADMIN) {
    return next();
  }

  res.status(403).json({
    success: false,
    message: 'Only System Administrators can manage teams'
  });
};

/**
 * Middleware to check if user can create campaigns
 * Allowed: System Admin, Hybrid, Marketer
 */
export const canCreateCampaign = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  const allowedRoles = [UserRole.SYSTEM_ADMIN, UserRole.HYBRID, UserRole.MARKETER];

  if (allowedRoles.includes(req.user.role)) {
    return next();
  }

  res.status(403).json({
    success: false,
    message: 'Insufficient permissions to create campaigns'
  });
};

/**
 * Middleware to check if user can assign team members to projects
 * Implements Assignment Authority Matrix
 */
export const canAssignToProject = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  const { userId, role: projectRole } = req.body;
  const assigningUserRole = req.user.role;

  // System Admin can assign anyone
  if (assigningUserRole === UserRole.SYSTEM_ADMIN) {
    return next();
  }

  // Hybrid can assign Marketers and Designers
  if (assigningUserRole === UserRole.HYBRID) {
    return next();
  }

  // Marketer can only assign Designers (optional - configurable)
  if (assigningUserRole === UserRole.MARKETER) {
    try {
      const targetUser = await User.findById(userId);
      if (!targetUser) {
        res.status(404).json({
          success: false,
          message: 'Target user not found'
        });
        return;
      }

      // Marketers can only assign Designers
      if (targetUser.role === UserRole.DESIGNER) {
        return next();
      }

      res.status(403).json({
        success: false,
        message: 'Marketers can only assign Designers to projects'
      });
      return;
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error checking assignment permissions'
      });
      return;
    }
  }

  res.status(403).json({
    success: false,
    message: 'Insufficient permissions to assign users to projects'
  });
};

/**
 * Middleware to check if user can edit content
 * Clients cannot edit
 */
export const canEditContent = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  if (req.user.role === UserRole.CLIENT) {
    res.status(403).json({
      success: false,
      message: 'Clients cannot edit content'
    });
    return;
  }

  next();
};

/**
 * Middleware to check if user can publish events
 * Clients and Designers (by default) cannot publish
 */
export const canPublishEvent = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  const allowedRoles = [UserRole.SYSTEM_ADMIN, UserRole.HYBRID, UserRole.MARKETER];

  if (allowedRoles.includes(req.user.role)) {
    return next();
  }

  res.status(403).json({
    success: false,
    message: 'Insufficient permissions to publish events'
  });
};

/**
 * Middleware to verify user belongs to team before project assignment
 */
export const verifyTeamMembership = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.body;
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      res.status(404).json({
        success: false,
        message: 'Project not found'
      });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Check if user belongs to the project's team
    if (!user.teamId || user.teamId.toString() !== project.teamId.toString()) {
      res.status(403).json({
        success: false,
        message: 'User must be a member of the team before being assigned to a project'
      });
      return;
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error verifying team membership'
    });
  }
};

/**
 * Middleware to check campaign access based on team membership
 */
export const checkCampaignAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { campaignId } = req.params;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // System Admin has access to all campaigns
    if (req.user.role === UserRole.SYSTEM_ADMIN) {
      return next();
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
      return;
    }

    // Check if user's team matches campaign's team
    if (!req.user.teamId || req.user.teamId.toString() !== campaign.teamId.toString()) {
      res.status(403).json({
        success: false,
        message: 'Access denied to this campaign'
      });
      return;
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking campaign access'
    });
  }
};
