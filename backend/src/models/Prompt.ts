import mongoose, { Document, Schema } from 'mongoose';

export interface IPrompt extends Document {
  name: string;
  details: string;
  createdAt: Date;
  updatedAt: Date;
}

const promptSchema = new Schema<IPrompt>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    details: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Index for quick lookups by name
promptSchema.index({ name: 1 });

export const Prompt = mongoose.model<IPrompt>('Prompt', promptSchema);
