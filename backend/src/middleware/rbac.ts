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
 * Middleware to check if user can assign users to projects
 * Allowed: System Admin, Hybrid
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
