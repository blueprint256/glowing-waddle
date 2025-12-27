import mongoose, { Document, Schema } from 'mongoose';

export enum AuditAction {
  USER_CREATED = 'user_created',
  USER_UPDATED = 'user_updated',
  USER_DELETED = 'user_deleted',
  CAMPAIGN_CREATED = 'campaign_created',
  CAMPAIGN_UPDATED = 'campaign_updated',
  CAMPAIGN_DELETED = 'campaign_deleted',
  PROJECT_CREATED = 'project_created',
  PROJECT_UPDATED = 'project_updated',
  PROJECT_ASSIGNMENT_ADDED = 'project_assignment_added',
  PROJECT_ASSIGNMENT_REMOVED = 'project_assignment_removed',
  EVENT_CREATED = 'event_created',
  EVENT_UPDATED = 'event_updated',
  EVENT_PUBLISHED = 'event_published',
  APPROVAL_REQUESTED = 'approval_requested',
  APPROVAL_GRANTED = 'approval_granted',
  APPROVAL_REJECTED = 'approval_rejected',
  ASSET_UPLOADED = 'asset_uploaded',
  ASSET_DELETED = 'asset_deleted'
}

export interface IAuditLog extends Document {
  action: AuditAction;
  userId: mongoose.Types.ObjectId;
  targetType?: string;
  targetId?: mongoose.Types.ObjectId;
  changes?: any;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    action: {
      type: String,
      enum: Object.values(AuditAction),
      required: true,
      index: true
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    targetType: {
      type: String
    },
    targetId: {
      type: Schema.Types.ObjectId
    },
    changes: {
      type: Schema.Types.Mixed
    },
    metadata: {
      type: Schema.Types.Mixed
    },
    ipAddress: {
      type: String
    },
    userAgent: {
      type: String
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

// Indexes for performance
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });
auditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
