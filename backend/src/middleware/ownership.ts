import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../models/User';
import { Campaign } from '../models/Campaign';
import { Project } from '../models/Project';
import { Task } from '../models/Task';

/**
 * Middleware to check if user owns or can access a campaign
 * System Admins can access all campaigns
 * Hybrid users can only access campaigns they created
 */
export const checkCampaignOwnership = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const campaignId = req.params.campaignId || req.params.id;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // System Admins have access to all campaigns
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

    // Hybrid users can only access campaigns they created
    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Access denied: You can only access campaigns you created'
      });
      return;
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking campaign ownership'
    });
  }
};

/**
 * Middleware to check if user owns or can access a project
 * Checks ownership through parent campaign
 */
export const checkProjectOwnership = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const projectId = req.params.projectId || req.params.id;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const project = await Project.findById(projectId);
    if (!project) {
      res.status(404).json({
        success: false,
        message: 'Project not found'
      });
      return;
    }

    // System Admins have access to all projects
    if (req.user.role === UserRole.SYSTEM_ADMIN) {
      return next();
    }

    // Check ownership through parent campaign
    const campaign = await Campaign.findById(project.campaignId);
    if (!campaign) {
      res.status(404).json({
        success: false,
        message: 'Parent campaign not found'
      });
      return;
    }

    // Hybrid users can only access projects under campaigns they created
    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Access denied: You can only access projects under campaigns you created'
      });
      return;
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking project ownership'
    });
  }
};

/**
 * Middleware to check if user owns or can access a task
 * Checks ownership through parent project and campaign
 */
export const checkTaskOwnership = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const taskId = req.params.taskId || req.params.id;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const task = await Task.findById(taskId);
    if (!task) {
      res.status(404).json({
        success: false,
        message: 'Task not found'
      });
      return;
    }

    // System Admins have access to all tasks
    if (req.user.role === UserRole.SYSTEM_ADMIN) {
      return next();
    }

    // Check ownership through parent campaign
    const campaign = await Campaign.findById(task.campaignId);
    if (!campaign) {
      res.status(404).json({
        success: false,
        message: 'Parent campaign not found'
      });
      return;
    }

    // Hybrid users can only access tasks under campaigns they created
    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Access denied: You can only access tasks under campaigns you created'
      });
      return;
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking task ownership'
    });
  }
};
