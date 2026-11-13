import mongoose, { Document, Schema } from 'mongoose';

export interface IVersion extends Document {
  projectId: mongoose.Types.ObjectId;
  number: number;
  structuredData: any;
  renderedAssetId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const versionSchema = new Schema<IVersion>({
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'HubProject',
    required: true,
  },
  number: {
    type: Number,
    required: true,
  },
  structuredData: {
    type: Schema.Types.Mixed,
    required: true,
  },
  renderedAssetId: {
    type: Schema.Types.ObjectId,
    ref: 'HubAsset',
    required: true,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

// A project can only have one version per number; the route retries on a collision.
versionSchema.index({ projectId: 1, number: 1 }, { unique: true });

export const Version = mongoose.model<IVersion>('Version', versionSchema);