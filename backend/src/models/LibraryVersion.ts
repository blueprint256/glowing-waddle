import mongoose, { Document, Schema } from 'mongoose';

/**
 * An immutable version of a Library item. New uploads and restores always add a version; nothing
 * is overwritten. Identical files are detected by sha256 and stored once.
 */
export interface ILibraryVersion extends Document {
  assetId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  number: number;
  s3Key: string;
  thumbKey?: string;
  aiKey?: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  sha256: string;
  dhash?: string;
  originalName: string;
  note: string;
  source: string;
  restoredFrom?: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const libraryVersionSchema = new Schema<ILibraryVersion>(
  {
    assetId: { type: Schema.Types.ObjectId, ref: 'LibraryAsset', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    number: { type: Number, required: true },
    s3Key: { type: String, required: true },
    thumbKey: { type: String },
    aiKey: { type: String },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
    sha256: { type: String, required: true },
    dhash: { type: String },
    originalName: { type: String, required: true, maxlength: 300 },
    note: { type: String, default: '', maxlength: 1000 },
    source: { type: String, default: 'upload' },
    restoredFrom: { type: Number },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

libraryVersionSchema.index({ assetId: 1, number: -1 }, { unique: true });
libraryVersionSchema.index({ ownerId: 1, sha256: 1 });
libraryVersionSchema.index({ ownerId: 1, dhash: 1 });
libraryVersionSchema.index({ s3Key: 1 });

export const LibraryVersion = mongoose.model<ILibraryVersion>('LibraryVersion', libraryVersionSchema);
