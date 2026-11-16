import mongoose, { Document, Schema } from 'mongoose';

/**
 * One creative in a user's Library (a "family"): the poster, photo, caption or file, with all its
 * versions (LibraryVersion). Everything the AI and search need lives here, indexed for direct lookups
 * by owner + date / kind / event / tags, plus a weighted full-text index.
 */
export type LibraryStatus = 'processing' | 'ready' | 'failed';
export type LibraryAiStatus = 'pending' | 'done' | 'skipped' | 'failed';

export interface ILibraryAsset extends Document {
  ownerId: mongoose.Types.ObjectId;
  title: string;
  titleSource: 'filename' | 'ai' | 'user';
  kind: string;
  category: string;
  description: string;
  textContent: string;
  notes: string;
  tags: string[];
  event: string;
  colors: string[];
  language: string;
  folder: string;
  capturedAt: Date;
  dateSource: string;
  links: {
    campaignId?: mongoose.Types.ObjectId | null;
    projectId?: mongoose.Types.ObjectId | null;
    taskId?: mongoose.Types.ObjectId | null;
  };
  currentVersionId?: mongoose.Types.ObjectId;
  versionCount: number;
  latestVersionNumber: number;
  status: LibraryStatus;
  aiStatus: LibraryAiStatus;
  aiError?: string;
  needsReview: boolean;
  review?: { versionOf?: { assetId: mongoose.Types.ObjectId; distance: number } } | null;
  searchText: string;
  embedding?: number[];
  importBatchId?: string;
  source: string;
  deletedAt?: Date | null;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const libraryAssetSchema = new Schema<ILibraryAsset>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    titleSource: { type: String, enum: ['filename', 'ai', 'user'], default: 'filename' },
    kind: { type: String, required: true },
    category: { type: String, default: 'other' },
    description: { type: String, default: '', maxlength: 2000 },
    textContent: { type: String, default: '' },
    notes: { type: String, default: '', maxlength: 5000 },
    tags: { type: [String], default: [] },
    event: { type: String, default: '', trim: true, maxlength: 120 },
    colors: { type: [String], default: [] },
    language: { type: String, default: '' },
    folder: { type: String, default: '' },
    capturedAt: { type: Date, required: true },
    dateSource: { type: String, default: 'upload' },
    links: {
      campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
      projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
      taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null }
    },
    currentVersionId: { type: Schema.Types.ObjectId, ref: 'LibraryVersion' },
    versionCount: { type: Number, default: 0 },
    latestVersionNumber: { type: Number, default: 0 },
    status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'processing' },
    aiStatus: { type: String, enum: ['pending', 'done', 'skipped', 'failed'], default: 'pending' },
    aiError: { type: String },
    needsReview: { type: Boolean, default: false },
    review: { type: Schema.Types.Mixed, default: null },
    searchText: { type: String, default: '' },
    embedding: { type: [Number], select: false, default: undefined },
    importBatchId: { type: String },
    source: { type: String, default: 'upload' },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// Direct lookups ("photos from March 2024", "everything for Black Friday", "this task's images").
libraryAssetSchema.index({ ownerId: 1, deletedAt: 1, capturedAt: -1 });
libraryAssetSchema.index({ ownerId: 1, kind: 1, capturedAt: -1 });
libraryAssetSchema.index({ ownerId: 1, event: 1, capturedAt: -1 });
libraryAssetSchema.index({ ownerId: 1, tags: 1 });
libraryAssetSchema.index({ ownerId: 1, needsReview: 1 });
libraryAssetSchema.index({ ownerId: 1, importBatchId: 1 });
libraryAssetSchema.index({ 'links.taskId': 1 });
libraryAssetSchema.index({ 'links.campaignId': 1 });
libraryAssetSchema.index({ deletedAt: 1 });
// Full-text "search engine" index. language_override points at a field we never set, so the AI's
// `language` value (e.g. "Swahili") can't break indexing.
libraryAssetSchema.index(
  { title: 'text', event: 'text', tags: 'text', searchText: 'text' },
  {
    name: 'library_text',
    weights: { title: 10, event: 8, tags: 6, searchText: 1 },
    default_language: 'english',
    language_override: 'textIndexLanguage'
  }
);

export const LibraryAsset = mongoose.model<ILibraryAsset>('LibraryAsset', libraryAssetSchema);
