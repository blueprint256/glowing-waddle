import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../models/User';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { Task } from '../models/Task';
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
 * Allowed: System Admin, Hybrid
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

  const allowedRoles = [UserRole.SYSTEM_ADMIN, UserRole.HYBRID];

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
 * Simplified: Both System Admin and Hybrid can assign
 */
export const canAssignToProject = (
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

  const allowedRoles = [UserRole.SYSTEM_ADMIN, UserRole.HYBRID];

  if (allowedRoles.includes(req.user.role)) {
    return next();
  }

  res.status(403).json({
    success: false,
    message: 'Insufficient permissions to assign users to projects'
  });
};

/**
 * Middleware to check if user can manage tasks
 * Allowed: System Admin, Hybrid
 */
export const canManageTasks = hasRole(UserRole.SYSTEM_ADMIN, UserRole.HYBRID);

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
