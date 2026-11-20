import mongoose, { Document, Schema } from 'mongoose';

/**
 * A poster being made (docs/DESIGN_ENGINE.md). MongoDB is the queue; the design worker claims jobs
 * one at a time and records each stage so the app can show progress. When it's done, the options
 * are the post's newest drafts (Task.aiDrafts with kind "design").
 */

export type DesignJobStatus = 'queued' | 'running' | 'done' | 'failed';
export type DesignJobStage = 'queued' | 'reading' | 'photo' | 'directing' | 'background' | 'rendering' | 'checking' | 'reviewing' | 'saving' | 'done';

export interface IDesignJob extends Document {
  taskId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  status: DesignJobStatus;
  stage: DesignJobStage;
  /** 0..1 */
  progress: number;
  request: {
    brief: string;
    format: string;
    photoUrls: string[];
    partnerIds: string[];
    campaignLogoIds: string[];
    count: number;
    /** Designs to choose from (empty: all that fit). */
    designIds: string[];
    /** No photo given: make one with the image AI first and design around it. */
    aiPhoto?: boolean;
  };
  /** The drafts made (ids on the post). */
  draftIds: string[];
  /** A note from the art director for the person (e.g. a brand rule kept). */
  message?: string;
  error?: string;
  attempts: number;
  lockedAt?: Date;
  cost?: number;
  createdAt: Date;
  updatedAt: Date;
}

const designJobSchema = new Schema<IDesignJob>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued' },
    stage: { type: String, default: 'queued' },
    progress: { type: Number, default: 0 },
    request: {
      brief: { type: String, default: '', maxlength: 6000 },
      format: { type: String, default: 'portrait' },
      photoUrls: { type: [String], default: [] },
      partnerIds: { type: [String], default: [] },
      campaignLogoIds: { type: [String], default: [] },
      aiPhoto: { type: Boolean, default: false },
      count: { type: Number, default: 4, min: 1, max: 4 },
      designIds: { type: [String], default: [] }
    },
    draftIds: { type: [String], default: [] },
    message: { type: String, maxlength: 600 },
    error: { type: String, maxlength: 600 },
    attempts: { type: Number, default: 0 },
    lockedAt: { type: Date },
    cost: { type: Number }
  },
  { timestamps: true }
);

designJobSchema.index({ status: 1, createdAt: 1 });

export const DesignJob = mongoose.model<IDesignJob>('DesignJob', designJobSchema);
