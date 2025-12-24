import { Request, Response, NextFunction } from 'express';
import { IUser } from '../models/User';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface User extends IUser {}
  }
}

/**
 * Middleware to ensure user is authenticated
 */
export const isAuthenticated = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.isAuthenticated()) {
    return next();
  }

  res.status(401).json({
    success: false,
    message: 'Authentication required'
  });
};

/**
 * Middleware to check if user is authenticated (optional)
 * Does not block request if not authenticated
 */
export const optionalAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  next();
};
