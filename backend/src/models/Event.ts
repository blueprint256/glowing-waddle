import mongoose, { Document, Schema } from 'mongoose';

export enum EventStatus {
  DRAFT = 'draft',
  IN_PROGRESS = 'in_progress',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PUBLISHED = 'published',
  COMPLETED = 'completed'
}

export enum EventType {
  POST = 'post',
  LAUNCH = 'launch',
  ACTIVATION = 'activation',
  DELIVERABLE = 'deliverable',
  OTHER = 'other'
}

export interface IEvent extends Document {
  name: string;
  description?: string;
  type: EventType;
  projectId: mongoose.Types.ObjectId;
  campaignId: mongoose.Types.ObjectId; // Inherited from project
  status: EventStatus;
  assignedTo?: mongoose.Types.ObjectId;
  scheduledDate?: Date;
  content?: string;
  createdBy: mongoose.Types.ObjectId;
  lastModifiedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const eventSchema = new Schema<IEvent>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    type: {
      type: String,
      enum: Object.values(EventType),
      default: EventType.OTHER
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: Object.values(EventStatus),
      default: EventStatus.DRAFT
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    scheduledDate: {
      type: Date
    },
    content: {
      type: String
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

// Indexes
eventSchema.index({ projectId: 1, status: 1 });
eventSchema.index({ campaignId: 1 });
eventSchema.index({ assignedTo: 1 });
eventSchema.index({ scheduledDate: 1 });

export const Event = mongoose.model<IEvent>('Event', eventSchema);
