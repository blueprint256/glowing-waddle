import mongoose, { Document, Schema } from 'mongoose';

export interface IPrompt extends Document {
  name: string;
  details: string;

  // Per-prompt LLM configuration overrides
  llmProvider?: string; // 'openai' | 'anthropic' | 'grok' | 'gemini'
  llmModel?: string;

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
    },
    // Per-prompt LLM configuration overrides
    llmProvider: {
      type: String,
      enum: ['openai', 'anthropic', 'grok', 'gemini'],
      required: false
    },
    llmModel: {
      type: String,
      required: false
    }
  },
  {
    timestamps: true
  }
);

// Index for quick lookups by name
promptSchema.index({ name: 1 });

export const Prompt = mongoose.model<IPrompt>('Prompt', promptSchema);
