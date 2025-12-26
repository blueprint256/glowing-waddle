import mongoose, { Document, Schema } from 'mongoose';

export enum TaskStatus {
  PENDING = 'Pending',
  IN_PROGRESS = 'In Progress',
  COMPLETED = 'Completed'
}

export enum TaskType {
  POST = 'post',
  LAUNCH = 'launch',
  ACTIVATION = 'activation',
  DELIVERABLE = 'deliverable',
  OTHER = 'other'
}

export interface ITask extends Document {
  name: string;
  description?: string;
  type: TaskType;
  projectId: mongoose.Types.ObjectId;
  campaignId: mongoose.Types.ObjectId; // Inherited from project
  teamId: mongoose.Types.ObjectId; // Inherited from project
  status: TaskStatus;
  scheduledDate?: Date;
  publishDate?: Date;
  content?: string;
  designedImage?: string; // S3 URL for product marketing image
  createdBy: mongoose.Types.ObjectId;
  lastModifiedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
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
      enum: Object.values(TaskType),
      default: TaskType.OTHER
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true
    },
    status: {
      type: String,
      enum: Object.values(TaskStatus),
      default: TaskStatus.PENDING
    },
    scheduledDate: {
      type: Date
    },
    publishDate: {
      type: Date
    },
    content: {
      type: String
    },
    designedImage: {
      type: String // S3 URL
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
taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ campaignId: 1 });
taskSchema.index({ scheduledDate: 1 });
taskSchema.index({ publishDate: 1 });

export const Task = mongoose.model<ITask>('Task', taskSchema);
