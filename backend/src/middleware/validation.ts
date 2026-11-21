import { body, param, query, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import { ACCEPTED_STATUS_VALUES } from '../lib/postStatus';

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
  body('accessMode').optional().isIn(['part_one', 'part_two'])
    .withMessage('Invalid access mode'),
  body('mcpEnabled').optional().custom((value) => typeof value === 'boolean')
    .withMessage('mcpEnabled must be true or false'),
  body('assistantEnabled').optional().custom((value) => typeof value === 'boolean')
    .withMessage('assistantEnabled must be true or false'),
  body('libraryEnabled').optional().custom((value) => typeof value === 'boolean')
    .withMessage('libraryEnabled must be true or false'),
  body('publishingEnabled').optional().custom((value) => typeof value === 'boolean')
    .withMessage('publishingEnabled must be true or false'),
  handleValidationErrors
];

export const validateUserUpdate = [
  body('email').optional().isEmail().normalizeEmail(),
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim().notEmpty(),
  body('role').optional().isIn(['system_admin', 'hybrid']),
  body('isActive').optional().custom((value) => typeof value === 'boolean')
    .withMessage('isActive must be true or false'),
  body('accessMode').optional().isIn(['part_one', 'part_two'])
    .withMessage('Invalid access mode'),
  body('mcpEnabled').optional().custom((value) => typeof value === 'boolean')
    .withMessage('mcpEnabled must be true or false'),
  body('assistantEnabled').optional().custom((value) => typeof value === 'boolean')
    .withMessage('assistantEnabled must be true or false'),
  body('libraryEnabled').optional().custom((value) => typeof value === 'boolean')
    .withMessage('libraryEnabled must be true or false'),
  body('publishingEnabled').optional().custom((value) => typeof value === 'boolean')
    .withMessage('publishingEnabled must be true or false'),
  body('tags').optional().isArray({ max: 30 }).withMessage('tags must be a list of up to 30 labels'),
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

/**
 * Field rules shared by the web app and the Claude connector: bad input gets a clear 400
 * instead of failing inside Mongoose with a generic 500.
 */
const isValidDateValue = (value: unknown) =>
  value === null ||
  value === '' ||
  ((typeof value === 'string' || typeof value === 'number') && !Number.isNaN(new Date(value).getTime()));

const optionalDate = (field: string) =>
  body(field).optional().custom(isValidDateValue).withMessage(`${field} must be a valid date`);

const optionalEnum = (field: string, values: string[]) =>
  body(field).optional({ values: 'falsy' }).isIn(values).withMessage(`${field} must be one of: ${values.join(', ')}`);

const optionalText = (field: string) =>
  body(field).optional({ values: 'null' }).isString().withMessage(`${field} must be text`);

export const CAMPAIGN_STATUS_VALUES = ['draft', 'planning', 'active', 'paused', 'completed', 'archived'];
export const PROJECT_STATUS_VALUES = ['planning', 'in_progress', 'review', 'completed', 'on_hold'];
// Post statuses: the new names plus the older ones (translated by services/postStatus.ts).
export const TASK_STATUS_VALUES = ACCEPTED_STATUS_VALUES;
export const PROJECT_ROLE_VALUES = ['project_manager', 'project_marketer', 'project_designer', 'viewer'];

export const validateCampaignFields = [
  body('name').optional({ values: 'falsy' }).isString().trim().notEmpty().withMessage('name cannot be empty'),
  optionalEnum('status', CAMPAIGN_STATUS_VALUES),
  optionalDate('startDate'),
  optionalDate('endDate'),
  optionalText('description'),
  optionalText('coreMessages'),
  body('goals').optional({ values: 'null' }).isArray().withMessage('goals must be a list'),
  body('hashtags').optional({ values: 'null' }).isArray().withMessage('hashtags must be a list'),
  handleValidationErrors
];

export const validateProjectUpdate = [
  body('name').optional({ values: 'falsy' }).isString().trim().notEmpty().withMessage('name cannot be empty'),
  optionalEnum('status', PROJECT_STATUS_VALUES),
  optionalDate('startDate'),
  optionalDate('dueDate'),
  optionalText('description'),
  handleValidationErrors
];

export const validateProjectAssignment = [
  body('userId').isMongoId().withMessage('Valid userId is required'),
  body('role').isIn(PROJECT_ROLE_VALUES).withMessage(`role must be one of: ${PROJECT_ROLE_VALUES.join(', ')}`),
  handleValidationErrors
];

/** A campaign id, or nothing / null / "none" (a post without a campaign). */
const optionalCampaign = (field: string) =>
  body(field)
    .optional({ values: 'null' })
    .custom((v) => v === '' || v === 'none' || (typeof v === 'string' && /^[a-f\d]{24}$/i.test(v)))
    .withMessage(`${field} must be a campaign id, or empty for no campaign`);

export const validateTaskCreate = [
  // The title is optional: without one it's taken from the caption or the brief.
  body('name').optional({ values: 'null' }).isString().trim().isLength({ max: 200 }).withMessage('The title can be 200 characters at most'),
  optionalCampaign('campaignId'),
  body('projectId').optional({ values: 'falsy' }).isMongoId().withMessage('projectId must be an id'),
  body('ownerId').optional({ values: 'falsy' }).isMongoId().withMessage('ownerId must be an account id'),
  optionalEnum('status', TASK_STATUS_VALUES),
  optionalDate('taskDate'),
  optionalText('description'),
  optionalText('content'),
  handleValidationErrors
];

export const validateTaskUpdate = [
  // An empty title switches back to the automatic one.
  body('name').optional({ values: 'null' }).isString().trim().isLength({ max: 200 }).withMessage('The title can be 200 characters at most'),
  optionalEnum('status', TASK_STATUS_VALUES),
  optionalDate('taskDate'),
  optionalText('description'),
  optionalText('content'),
  optionalCampaign('campaignId'),
  body('projectId').optional({ values: 'falsy' }).isMongoId().withMessage('projectId must be an id'),
  handleValidationErrors
];
