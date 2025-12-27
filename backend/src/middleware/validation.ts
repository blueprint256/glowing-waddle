import { body, param, query, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to handle validation errors
 */
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: errors.array()
    });
    return;
  }
  next();
};

/**
 * User validation rules
 */
export const validateUserCreation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('role').isIn(['system_admin', 'hybrid'])
    .withMessage('Invalid role'),
  handleValidationErrors
];

export const validateUserUpdate = [
  body('email').optional().isEmail().normalizeEmail(),
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim().notEmpty(),
  body('role').optional().isIn(['system_admin', 'hybrid']),
  handleValidationErrors
];

/**
 * Campaign validation rules
 */
export const validateCampaignCreation = [
  body('name').trim().notEmpty().withMessage('Campaign name is required'),
  body('description').optional().trim(),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  handleValidationErrors
];

/**
 * Project validation rules
 */
export const validateProjectCreation = [
  body('name').trim().notEmpty().withMessage('Project name is required'),
  body('description').optional().trim(),
  body('campaignId').isMongoId().withMessage('Valid campaign ID is required'),
  body('startDate').optional().isISO8601(),
  body('dueDate').optional().isISO8601(),
  handleValidationErrors
];

/**
 * Task validation rules
 */
export const validateTaskCreation = [
  body('name').trim().notEmpty().withMessage('Task name is required'),
  body('description').optional().trim(),
  body('type').isIn(['post', 'launch', 'activation', 'deliverable', 'other'])
    .withMessage('Invalid task type'),
  body('projectId').isMongoId().withMessage('Valid project ID is required'),
  body('scheduledDate').optional().isISO8601(),
  body('publishDate').optional().isISO8601(),
  body('content').optional().trim(),
  body('status').optional().isIn(['Pending', 'In Progress', 'Completed'])
    .withMessage('Invalid task status'),
  handleValidationErrors
];

/**
 * Comment validation rules
 */
export const validateCommentCreation = [
  body('content').trim().notEmpty().withMessage('Comment content is required'),
  body('taskId').optional().isMongoId(),
  body('projectId').optional().isMongoId(),
  body('campaignId').optional().isMongoId(),
  handleValidationErrors
];

/**
 * Approval validation rules
 */
export const validateApprovalRequest = [
  body('taskId').isMongoId().withMessage('Valid task ID is required'),
  body('reviewerId').isMongoId().withMessage('Valid reviewer ID is required'),
  handleValidationErrors
];

/**
 * MongoDB ID validation
 */
export const validateMongoId = (paramName: string = 'id') => [
  param(paramName).isMongoId().withMessage(`Valid ${paramName} is required`),
  handleValidationErrors
];
