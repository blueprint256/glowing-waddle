import mongoose, { Document, Schema } from 'mongoose';

export interface ICommandMappingStep {
  promptId: mongoose.Types.ObjectId; // Reference to Prompt
  provider?: string; // Optional LLM provider override (openai, anthropic, grok, gemini)
  model?: string; // Optional model override
}

export interface ICommandMapping extends Document {
  command: string; // Unique command identifier (e.g., "generate-campaign")
  // Support both legacy single-prompt and new multi-step chains
  promptId?: mongoose.Types.ObjectId; // Legacy: Reference to Prompt (deprecated, use steps instead)
  steps?: ICommandMappingStep[]; // Multi-step chain: array of steps with prompt and optional provider/model
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
    // Legacy field for backward compatibility
    promptId: {
      type: Schema.Types.ObjectId,
      ref: 'Prompt',
      required: false
    },
    // New multi-step chain field
    steps: {
      type: [commandMappingStepSchema],
      required: false
    }
  },
  {
    timestamps: true
  }
);

// Pre-save hook to ensure either promptId or steps is provided
commandMappingSchema.pre('save', function(next) {
  if (!this.promptId && (!this.steps || this.steps.length === 0)) {
    next(new Error('Either promptId or steps array must be provided'));
  } else {
    next();
  }
});

export const CommandMapping = mongoose.model<ICommandMapping>('CommandMapping', commandMappingSchema);
