import mongoose, { Document, Schema } from 'mongoose';

export enum TaskStatus {
  PENDING = 'Pending',
  IN_PROGRESS = 'In Progress',
  COMPLETED = 'Completed'
}

export interface ITask extends Document {
  name: string;
  description?: string;
  projectId: mongoose.Types.ObjectId;
  campaignId: mongoose.Types.ObjectId; // Inherited from project
  status: TaskStatus;
  taskDate?: Date; // Single date for when task should be carried out
  content?: string;
  designedImage?: string; // S3 URL for product marketing image
  attachedImages?: string[]; // Array of S3 URLs for additional reference images
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
    status: {
      type: String,
      enum: Object.values(TaskStatus),
      default: TaskStatus.PENDING
    },
    taskDate: {
      type: Date
    },
    content: {
      type: String
    },
    designedImage: {
      type: String // S3 URL
    },
    attachedImages: {
      type: [String], // Array of S3 URLs
      default: []
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
taskSchema.index({ taskDate: 1 });

export const Task = mongoose.model<ITask>('Task', taskSchema);
