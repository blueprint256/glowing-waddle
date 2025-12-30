import mongoose, { Document, Schema } from 'mongoose';

export interface IPrompt extends Document {
  name: string;
  details: string;

  // Per-prompt LLM configuration overrides (for text generation)
  llmProvider?: string; // 'openai' | 'anthropic' | 'grok' | 'gemini'
  llmModel?: string;

  // Per-prompt Image LLM configuration overrides (for image generation)
  imageLLMProvider?: string; // 'openai' | 'stability'
  imageLLMModel?: string;

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
    // Per-prompt Image LLM configuration overrides (for image generation)
    imageLLMProvider: {
      type: String,
      enum: ['openai', 'stability'],
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

// Index for quick lookups by name
promptSchema.index({ name: 1 });

export const Prompt = mongoose.model<IPrompt>('Prompt', promptSchema);
