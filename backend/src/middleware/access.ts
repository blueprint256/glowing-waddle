import { Request, Response, NextFunction } from 'express';
import { AppPart, AccessMode, hasPartAccess } from '../models/User';

/**
 * Gate a whole area of the API by the user's access mode (set by a System Admin).
 *
 * Mounted in front of a router: authenticated users without access get a 403;
 * unauthenticated requests are passed through untouched so each route's own
 * `isAuthenticated` check still answers with the usual 401 (and public routes,
 * such as OAuth callbacks, keep working).
 */
export const requirePart = (part: AppPart) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) return next();

    if (hasPartAccess(req.user, part)) return next();

    res.status(403).json({
      success: false,
      code: 'ACCESS_RESTRICTED',
      message:
        part === AccessMode.PART_ONE
          ? 'Your account is restricted to the Content Hub'
          : 'Your account is not enabled for the Content Hub'
    });
  };
};

export const requirePartOne = requirePart(AccessMode.PART_ONE);
export const requirePartTwo = requirePart(AccessMode.PART_TWO);
