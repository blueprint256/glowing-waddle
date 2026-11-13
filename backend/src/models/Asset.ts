import mongoose, { Document, Schema } from 'mongoose';

export interface IAsset extends Document {
  userId: mongoose.Types.ObjectId;
  originalFileName: string;
  storageKey: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: Date;
}

const assetSchema = new Schema<IAsset>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    originalFileName: {
      type: String,
      required: true
    },
    storageKey: {
      type: String,
      required: true
    },
    contentType: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    width: Number,
    height: Number
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

export const Asset = mongoose.model<IAsset>('Asset', assetSchema);