import mongoose, { Document, Schema } from 'mongoose';

/**
 * A design added to the library by an admin (imported from a reference and approved after its
 * stress test). Built-in designs live in code (design/library); both have the same shape
 * (design/types DesignTemplate). Only "live" designs are offered to the art director.
 */

export interface IDesignTemplate extends Document {
  designId: string;
  version: number;
  status: 'draft' | 'live' | 'retired';
  template: any; // design/types DesignTemplate
  /** Where the idea came from (a note, never the reference file itself). */
  sourceNote?: string;
  /** The stress test's last result. */
  test?: { at: Date; passed: number; failed: number; problems: string[] };
  createdBy: mongoose.Types.ObjectId;
  approvedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const designTemplateSchema = new Schema<IDesignTemplate>(
  {
    designId: { type: String, required: true, unique: true },
    version: { type: Number, default: 1 },
    status: { type: String, enum: ['draft', 'live', 'retired'], default: 'draft' },
    template: { type: Schema.Types.Mixed, required: true },
    sourceNote: { type: String, maxlength: 500 },
    test: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export const DesignTemplateModel = mongoose.model<IDesignTemplate>('DesignTemplate', designTemplateSchema);
