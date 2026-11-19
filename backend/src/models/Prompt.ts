import mongoose, { Document, Schema } from 'mongoose';

export interface IPrompt extends Document {
  name: string;
  details: string;

  // Per-prompt LLM configuration overrides (for text generation)
  llmProvider?: string; // 'openai' | 'anthropic' | 'grok' | 'gemini'
  llmModel?: string;

  // Marks a prompt as an image prompt. The model actually called comes from Settings › AI
  // (lib/imageModels.ts); the stored name is kept for older records.
  imageLLMProvider?: string; // 'openai' (only option)
  imageLLMModel?: string; // e.g. 'gpt-image-2.5-flare'

  createdAt: Date;
  updatedAt: Date;
}

const promptSchema = new Schema<IPrompt>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    details: {
      type: String,
      required: true
    },
    // Per-prompt LLM configuration overrides (for text generation)
    llmProvider: {
      type: String,
      enum: ['openai', 'anthropic', 'grok', 'gemini'],
      required: false
    },
    llmModel: {
      type: String,
      required: false
    },
    // Image prompt marker (the model called comes from Settings › AI)
    imageLLMProvider: {
      type: String,
      enum: ['openai'],
      required: false
    },
    imageLLMModel: {
      type: String,
      required: false
    }
  },
  {
    timestamps: true
  }
);

export const Prompt = mongoose.model<IPrompt>('Prompt', promptSchema);
