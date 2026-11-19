import mongoose, { Document, Schema } from 'mongoose';
import { TaskStatus } from '../lib/postStatus';

// Statuses and their rules: lib/postStatus.ts (re-exported here for existing imports).
export { TaskStatus };

/**
 * A post ("task" in the code and API). It belongs to an account (ownerId) and, optionally, to a
 * campaign. Themes (projects) were retired in Post v2: projectId stays in old records only, and the
 * old theme's name is kept in legacyTheme. See docs/POST_V2_PLAN.md.
 */

/** An earlier picture of the post (the current one is designedImage). */
export interface PostImageHistory {
  url: string;
  source: string; // upload | library | ai | canva | restore
  note?: string;
  /** When the picture was a designed poster: its document, so it can be edited again. */
  design?: PostDesign;
  at: Date;
}

/** A poster made by the design engine: everything needed to render it again or edit it. */
export interface PostDesign {
  doc: any; // design/types DesignDoc
  /** Problems the code checks found (warnings only: options with errors aren't kept). */
  issues?: { level: string; code: string; message: string }[];
  /** The critic's 0–10 and its one-line note. */
  score?: number;
  note?: string;
  why?: string;
  jobId?: string;
  /** Print version, made on request. */
  pdfUrl?: string;
}

/** An AI picture that hasn't been chosen yet (deleted after 7 days if it isn't used). */
export interface PostAIDraft {
  id: string;
  url: string;
  kind: 'create' | 'change' | 'design';
  /** kind "design": the poster document behind the picture. */
  design?: PostDesign;
  prompt: string;
  /** For "change": the picture that was changed. */
  from?: string;
  size?: string;
  at: Date;
}

/** A picture the AI should use when making this post's picture. */
export interface PostReference {
  id: string;
  url: string;
  role: 'include' | 'style';
  name?: string;
  at: Date;
}

export interface ITask extends Document {
  name: string;
  /** True while the title is automatic (it follows the caption, or the brief while there's none). */
  autoName?: boolean;
  description?: string;
  /** The account the post belongs to. */
  ownerId: mongoose.Types.ObjectId;
  campaignId?: mongoose.Types.ObjectId | null;
  /** Retired (themes). Kept in old records. */
  projectId?: mongoose.Types.ObjectId | null;
  /** The name of the theme the post was in before themes were retired. */
  legacyTheme?: string;
  status: TaskStatus;
  taskDate?: Date | null;
  content?: string;
  designedImage?: string; // the post's picture
  /** When the picture is a designed poster: its document (edit it, download it for print). */
  pictureDesign?: PostDesign | null;
  imageHistory: PostImageHistory[];
  aiDrafts: PostAIDraft[];
  references: PostReference[];
  /** The choices last used for Create image on this post (shape and logo corner). */
  pictureOptions?: { format?: string; logo?: string | null };
  /** The newest AI draft's address (kept for older clients and the connector). */
  pendingGeneratedImage?: string;
  /** Retired: reference images before Post v2 (moved into references). */
  attachedImages?: string[];
  createdBy: mongoose.Types.ObjectId;
  lastModifiedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const historySchema = new Schema<PostImageHistory>(
  {
    url: { type: String, required: true },
    source: { type: String, default: 'upload' },
    note: { type: String, maxlength: 300 },
    design: { type: Schema.Types.Mixed },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const draftSchema = new Schema<PostAIDraft>(
  {
    id: { type: String, required: true },
    url: { type: String, required: true },
    kind: { type: String, enum: ['create', 'change', 'design'], required: true },
    design: { type: Schema.Types.Mixed },
    prompt: { type: String, default: '', maxlength: 4000 },
    from: { type: String },
    size: { type: String },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const referenceSchema = new Schema<PostReference>(
  {
    id: { type: String, required: true },
    url: { type: String, required: true },
    role: { type: String, enum: ['include', 'style'], default: 'include' },
    name: { type: String, maxlength: 200 },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const taskSchema = new Schema<ITask>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    autoName: {
      type: Boolean,
      default: false
    },
    description: {
      type: String,
      trim: true
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      default: null
    },
    legacyTheme: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: Object.values(TaskStatus),
      default: TaskStatus.DRAFT
    },
    taskDate: {
      type: Date
    },
    content: {
      type: String
    },
    designedImage: {
      type: String
    },
    pictureDesign: {
      type: Schema.Types.Mixed,
      default: null
    },
    imageHistory: { type: [historySchema], default: [] },
    aiDrafts: { type: [draftSchema], default: [] },
    references: { type: [referenceSchema], default: [] },
    pictureOptions: {
      format: { type: String, enum: ['square', 'portrait', 'landscape'] },
      logo: { type: String, enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right', null], default: null }
    },
    pendingGeneratedImage: {
      type: String
    },
    attachedImages: {
      type: [String],
      default: undefined
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
taskSchema.index({ ownerId: 1, taskDate: 1 });
taskSchema.index({ campaignId: 1 });
taskSchema.index({ taskDate: 1 });
taskSchema.index({ 'aiDrafts.at': 1 });

export const Task = mongoose.model<ITask>('Task', taskSchema);
