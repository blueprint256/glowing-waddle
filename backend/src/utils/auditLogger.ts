import { AuditLog, AuditAction } from '../models/AuditLog';
import mongoose from 'mongoose';
import { Request } from 'express';

export interface AuditLogData {
  action: AuditAction;
  userId: mongoose.Types.ObjectId;
  targetType?: string;
  targetId?: mongoose.Types.ObjectId;
  changes?: any;
  metadata?: any;
  req?: Request;
}

/**
 * Create an audit log entry
 */
export const logAudit = async (data: AuditLogData): Promise<void> => {
  try {
    await AuditLog.create({
      action: data.action,
      userId: data.userId,
      targetType: data.targetType,
      targetId: data.targetId,
      changes: data.changes,
      metadata: data.metadata,
      ipAddress: data.req?.ip,
      userAgent: data.req?.get('user-agent')
    });
  } catch (error) {
    console.error('Error creating audit log:', error);
  }
};

/**
 * Log user creation
 */
export const logUserCreated = async (
  creatorId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  userData: any,
  req?: Request
): Promise<void> => {
  await logAudit({
    action: AuditAction.USER_CREATED,
    userId: creatorId,
    targetType: 'User',
    targetId: userId,
    metadata: { email: userData.email, role: userData.role },
    req
  });
};

/**
 * Log project assignment
 */
export const logProjectAssignment = async (
  assignerId: mongoose.Types.ObjectId,
  projectId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  role: string,
  req?: Request
): Promise<void> => {
  await logAudit({
    action: AuditAction.PROJECT_ASSIGNMENT_ADDED,
    userId: assignerId,
    targetType: 'Project',
    targetId: projectId,
    metadata: { assignedUserId: userId, projectRole: role },
    req
  });
};

/**
 * Log event publish
 */
export const logEventPublished = async (
  publisherId: mongoose.Types.ObjectId,
  eventId: mongoose.Types.ObjectId,
  req?: Request
): Promise<void> => {
  await logAudit({
    action: AuditAction.EVENT_PUBLISHED,
    userId: publisherId,
    targetType: 'Event',
    targetId: eventId,
    req
  });
};

/**
 * Log approval action
 */
export const logApprovalAction = async (
  reviewerId: mongoose.Types.ObjectId,
  eventId: mongoose.Types.ObjectId,
  action: AuditAction,
  feedback?: string,
  req?: Request
): Promise<void> => {
  await logAudit({
    action,
    userId: reviewerId,
    targetType: 'Event',
    targetId: eventId,
    metadata: { feedback },
    req
  });
};
