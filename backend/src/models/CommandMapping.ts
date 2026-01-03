import mongoose, { Document, Schema } from 'mongoose';

export interface ICommandMappingStep {
  promptId: mongoose.Types.ObjectId; // Reference to Prompt
  provider?: string; // Optional LLM provider override (openai, anthropic, grok, gemini)
  model?: string; // Optional model override
}

export interface ICommandMapping extends Document {
  command: string; // Unique command identifier (e.g., "generate-campaign")
  // Support three modes: single prompt, chain, or legacy steps array
  promptId?: mongoose.Types.ObjectId; // Reference to single Prompt
  chainId?: mongoose.Types.ObjectId; // Reference to Chain (multi-step with embedded prompts)
  steps?: ICommandMappingStep[]; // Legacy: Direct steps array (deprecated, kept for backward compatibility)
  createdAt: Date;
  updatedAt: Date;
}

const commandMappingStepSchema = new Schema<ICommandMappingStep>(
  {
    promptId: {
      type: Schema.Types.ObjectId,
      ref: 'Prompt',
      required: true
    },
    provider: {
      type: String,
      enum: ['openai', 'anthropic', 'grok', 'gemini'],
      required: false
    },
    model: {
      type: String,
      required: false
    }
  },
  { _id: false }
);

const commandMappingSchema = new Schema<ICommandMapping>(
  {
    command: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    // Single prompt reference
    promptId: {
      type: Schema.Types.ObjectId,
      ref: 'Prompt',
      required: false
    },
    // Chain reference (new approach)
    chainId: {
      type: Schema.Types.ObjectId,
      ref: 'Chain',
      required: false
    },
    // Legacy steps array (backward compatibility)
    steps: {
      type: [commandMappingStepSchema],
      required: false
    }
  },
  {
    timestamps: true
  }
);

// Pre-save hook to ensure exactly one of promptId, chainId, or steps is provided
commandMappingSchema.pre('save', function(next) {
  const hasPromptId = !!this.promptId;
  const hasChainId = !!this.chainId;
  const hasSteps = !!(this.steps && this.steps.length > 0);

  const count = [hasPromptId, hasChainId, hasSteps].filter(Boolean).length;

  if (count === 0) {
    next(new Error('Must provide either promptId, chainId, or steps array'));
  } else if (count > 1) {
    next(new Error('Cannot provide multiple of: promptId, chainId, steps. Choose only one.'));
  } else {
    next();
  }
});

export const CommandMapping = mongoose.model<ICommandMapping>('CommandMapping', commandMappingSchema);
