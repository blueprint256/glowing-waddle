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
    ref: 'Project',
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
    ref: 'Asset',
    required: true,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export const Version = mongoose.model<IVersion>('Version', versionSchema);