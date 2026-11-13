import { Request, Response, NextFunction } from 'express';
import { canUseAI } from '../models/User';

/**
 * Blocks AI generation for users on Part two (see AccessMode in models/User.ts).
 *
 * Everything else in the app is identical for both parts; this only guards endpoints that spend
 * our AI routing (LLM calls, image generation, prompt/chain configuration, provider keys).
 *
 * Unauthenticated requests pass through untouched so each route's own `isAuthenticated`
 * still answers with the usual 401.
 */
export const requireAI = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) return next();
  if (canUseAI(req.user)) return next();

  res.status(403).json({
    success: false,
    code: 'AI_GENERATION_DISABLED',
    message: 'AI generation is not enabled for your account'
  });
};
