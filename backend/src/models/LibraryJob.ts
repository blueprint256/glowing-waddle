import mongoose, { Document, Schema } from 'mongoose';

/**
 * Background work for the Library (MongoDB-backed queue, no extra infrastructure):
 *  - analyze:    AI reads one item (description, text, tags, event, date) and indexes it
 *  - import_app: copy the user's existing task images, logos and assets into their Library
 *  - task_image: add a task's newly uploaded/adopted image to its Library family
 */
export type LibraryJobType = 'analyze' | 'import_app' | 'task_image';

export interface ILibraryJob extends Document {
  type: LibraryJobType;
  ownerId: mongoose.Types.ObjectId;
  assetId?: mongoose.Types.ObjectId;
  payload?: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  runAfter: Date;
  lockedAt?: Date;
  error?: string;
  aiUsed: boolean;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const libraryJobSchema = new Schema<ILibraryJob>(
  {
    type: { type: String, enum: ['analyze', 'import_app', 'task_image'], required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'LibraryAsset' },
    payload: { type: Schema.Types.Mixed },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    runAfter: { type: Date, default: Date.now },
    lockedAt: { type: Date },
    error: { type: String },
    aiUsed: { type: Boolean, default: false },
    finishedAt: { type: Date }
  },
  { timestamps: true }
);

libraryJobSchema.index({ status: 1, runAfter: 1, createdAt: 1 });
libraryJobSchema.index({ ownerId: 1, aiUsed: 1, finishedAt: -1 });
libraryJobSchema.index({ assetId: 1, type: 1, status: 1 });
// Finished jobs are kept 30 days (monthly AI usage counts come from them), then removed.
libraryJobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 40 });

export const LibraryJob = mongoose.model<ILibraryJob>('LibraryJob', libraryJobSchema);
