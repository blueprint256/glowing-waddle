import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { isAuthenticated } from '../middleware/auth';
import { OAuthError } from '../oauth/crypto';
import {
  describeAuthorizationRequest,
  decideAuthorizationRequest,
  listConnections,
  revokeUserTokens
} from '../oauth/oauthService';
import { canUseConnector } from '../models/User';
import { getMcpResourceUrl, hasConfiguredPublicUrl } from '../config/publicUrl';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';

/**
 * Session-authenticated endpoints used by the web app:
 *   GET  /api/oauth/requests/:requestId            consent screen details
 *   POST /api/oauth/requests/:requestId/decision   { approve: boolean } → { redirectUrl }
 *   GET  /api/connected-apps                       the user's Claude connections + connector URL
 *   DELETE /api/connected-apps/:clientId           disconnect one app
 * OAuth bearer tokens can never call these (see middleware/bearerAuth.ts).
 */
const router = express.Router();

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof OAuthError) {
    res.status(error.status).json({ success: false, code: error.error, message: error.description });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ success: false, message: fallback });
}

router.get('/oauth/requests/:requestId', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const details = await describeAuthorizationRequest(req.params.requestId, req.user!);
    res.json({ success: true, request: details });
  } catch (error) {
    sendError(res, error, 'Error loading authorization request');
  }
});

router.post('/oauth/requests/:requestId/decision', isAuthenticated, async (req: Request, res: Response) => {
  try {
    if (!req.is('application/json') || typeof req.body?.approve !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Body must be JSON with a boolean "approve"' });
    }
    const result = await decideAuthorizationRequest(req.params.requestId, req.user!, req.body.approve);

    await logAudit({
      action: req.body.approve && canUseConnector(req.user!) ? AuditAction.CONNECTOR_AUTHORIZED : AuditAction.CONNECTOR_DENIED,
      userId: req.user!._id as mongoose.Types.ObjectId,
      targetType: 'User',
      targetId: req.user!._id as mongoose.Types.ObjectId,
      req
    });

    res.json({ success: true, redirectUrl: result.redirectUrl });
  } catch (error) {
    sendError(res, error, 'Error recording your decision');
  }
});

router.get('/connected-apps', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const connections = await listConnections(req.user!._id as mongoose.Types.ObjectId);
    res.json({
      success: true,
      connectorEnabled: canUseConnector(req.user!),
      mcpUrl: hasConfiguredPublicUrl() ? getMcpResourceUrl() : null,
      connections
    });
  } catch (error) {
    sendError(res, error, 'Error loading connected apps');
  }
});

router.delete('/connected-apps/:clientId', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const revoked = await revokeUserTokens(req.user!._id as mongoose.Types.ObjectId, req.params.clientId);
    await logAudit({
      action: AuditAction.CONNECTOR_REVOKED,
      userId: req.user!._id as mongoose.Types.ObjectId,
      targetType: 'User',
      targetId: req.user!._id as mongoose.Types.ObjectId,
      metadata: { clientId: req.params.clientId, revoked },
      req
    });
    res.json({ success: true, message: revoked ? 'Disconnected' : 'Nothing to disconnect' });
  } catch (error) {
    sendError(res, error, 'Error disconnecting the app');
  }
});

export default router;
