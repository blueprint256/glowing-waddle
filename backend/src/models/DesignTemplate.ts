import mongoose, { Document, Schema } from 'mongoose';

/**
 * A design added to the library by an admin (imported from a reference and approved after its
 * stress test). Built-in designs live in code (design/library); both have the same shape
 * (design/types DesignTemplate). Only "live" designs are offered to the art director.
 */

export interface IDesignTemplate extends Document {
  designId: string;
  version: number;
  /** importing: the AI is working on it; failed: it couldn't make one (see error); draft: made,
   *  waiting for approval; live: offered to the art director; retired: no longer offered. */
  status: 'importing' | 'failed' | 'draft' | 'live' | 'retired';
  template: any; // design/types DesignTemplate
  /** Where the idea came from (a note, never the reference file itself). */
  sourceNote?: string;
  /** The stress test's last result. */
  test?: { at: Date; passed: number; failed: number; problems: string[] };
  /** Renders from the last stress test (one per shape and case). */
  previews?: { format: string; case: string; url: string; passed: boolean; counted: boolean; issues: string[] }[];
  /** What the importer said it took from the reference and changed. */
  notes?: string;
  /** Progress while importing, or why it failed. */
  message?: string;
  error?: string;
  /** AI cost so far (US$). */
  cost?: number;
  createdBy: mongoose.Types.ObjectId;
  approvedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const designTemplateSchema = new Schema<IDesignTemplate>(
  {
    designId: { type: String, required: true, unique: true },
    version: { type: Number, default: 1 },
    status: { type: String, enum: ['importing', 'failed', 'draft', 'live', 'retired'], default: 'draft' },
    template: { type: Schema.Types.Mixed, default: () => ({}) },
    sourceNote: { type: String, maxlength: 2000 },
    test: { type: Schema.Types.Mixed },
    previews: { type: Schema.Types.Mixed, default: [] },
    notes: { type: String, maxlength: 4000 },
    message: { type: String, maxlength: 300 },
    error: { type: String, maxlength: 2000 },
    cost: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export const DesignTemplateModel = mongoose.model<IDesignTemplate>('DesignTemplate', designTemplateSchema);
