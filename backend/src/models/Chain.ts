import mongoose, { Document, Schema } from 'mongoose';

export interface IChainStep {
  description: string; // Step description/name (e.g., "Refine description", "Generate image")
  prompt: string; // The actual prompt text with placeholders
  provider: string; // LLM provider (openai, anthropic, grok, gemini) - REQUIRED
  model: string; // LLM model (enforced, not optional) - REQUIRED
}

export interface IChain extends Document {
  name: string; // Unique chain identifier (e.g., "Poster Generation Chain")
  steps: IChainStep[]; // Array of chain steps with embedded prompts
  createdAt: Date;
  updatedAt: Date;
}

const chainStepSchema = new Schema<IChainStep>(
  {
    description: {
      type: String,
      required: true,
      trim: true
    },
    prompt: {
      type: String,
      required: true
    },
    provider: {
      type: String,
      required: true,
      enum: ['openai', 'anthropic', 'grok', 'gemini']
    },
    model: {
      type: String,
      required: true
    }
  },
  { _id: false }
);

const chainSchema = new Schema<IChain>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    steps: {
      type: [chainStepSchema],
      required: true,
      validate: {
        validator: function(steps: IChainStep[]) {
          return steps && steps.length > 0;
        },
        message: 'Chain must have at least one step'
      }
    }
  },
  {
    timestamps: true
  }
);

export const Chain = mongoose.model<IChain>('Chain', chainSchema);
