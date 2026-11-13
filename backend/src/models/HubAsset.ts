import mongoose, { Document, Schema } from 'mongoose';

/**
 * Content Hub file (uploaded image or server-rendered poster).
 * Kept separate from the Part one `Asset` model so the two parts never affect each other.
 * `storageKey` is the bare S3 key (no bucket URL); URLs are always derived from it.
 */
export interface IHubAsset extends Document {
  userId: mongoose.Types.ObjectId;
  originalFileName: string;
  storageKey: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: Date;
}

const hubAssetSchema = new Schema<IHubAsset>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    originalFileName: { type: String, required: true },
    storageKey: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    width: Number,
    height: Number
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const HubAsset = mongoose.model<IHubAsset>('HubAsset', hubAssetSchema);
