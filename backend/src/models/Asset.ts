import mongoose, { Document, Schema } from 'mongoose';

export enum AssetType {
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
  OTHER = 'other'
}

export interface IAsset extends Document {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  type: AssetType;
  path: string;
  location: string; // S3 URL
  taskId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  campaignId?: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  version: number;
  previousVersionId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const assetSchema = new Schema<IAsset>(
  {
    filename: {
      type: String,
      required: true
    },
    originalName: {
      type: String,
      required: true
    },
    mimeType: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    type: {
      type: String,
      enum: Object.values(AssetType),
      required: true
    },
    path: {
      type: String,
      required: true
    },
    location: {
      type: String,
      required: true
    },
    taskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task'
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      index: true
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      index: true
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    version: {
      type: Number,
      default: 1
    },
    previousVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'Asset'
    }
  },
  {
    timestamps: true
  }
);

// Indexes
assetSchema.index({ taskId: 1, version: -1 });
assetSchema.index({ uploadedBy: 1 });

export const Asset = mongoose.model<IAsset>('Asset', assetSchema);
