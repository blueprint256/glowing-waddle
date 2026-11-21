import mongoose, { Document, Schema } from 'mongoose';

/** An "Edit in Canva" session: which picture went to Canva, and where the result comes back to. */
export interface ICanvaEdit extends Document {
  userId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  target: 'library' | 'task';
  assetId?: mongoose.Types.ObjectId;
  taskId?: mongoose.Types.ObjectId;
  designId: string;
  editUrl: string;
  correlationState: string;
  status: 'editing' | 'importing' | 'imported' | 'failed';
  error?: string;
  importedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ICanvaEdit>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    target: { type: String, enum: ['library', 'task'], required: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'LibraryAsset', index: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', index: true },
    designId: { type: String, required: true },
    editUrl: { type: String, required: true },
    correlationState: { type: String, required: true, unique: true },
    status: { type: String, enum: ['editing', 'importing', 'imported', 'failed'], default: 'editing' },
    error: String,
    importedAt: Date
  },
  { timestamps: true }
);

export const CanvaEdit = mongoose.model<ICanvaEdit>('CanvaEdit', schema);
