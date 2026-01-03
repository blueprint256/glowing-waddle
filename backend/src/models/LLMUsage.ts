import mongoose, { Document, Schema } from 'mongoose';

export interface ILLMUsage extends Document {
  userId: mongoose.Types.ObjectId;
  promptName: string;
  llmModel: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  success: boolean;
  errorMessage?: string;
  requestDuration: number; // in milliseconds
  createdAt: Date;
}

const llmUsageSchema = new Schema<ILLMUsage>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    promptName: {
      type: String,
      required: true,
      index: true
    },
    llmModel: {
      type: String,
      required: true
    },
    promptTokens: {
      type: Number,
      default: 0
    },
    completionTokens: {
      type: Number,
      default: 0
    },
    totalTokens: {
      type: Number,
      default: 0
    },
    estimatedCost: {
      type: Number,
      default: 0
    },
    success: {
      type: Boolean,
      default: true
    },
    errorMessage: {
      type: String
    },
    requestDuration: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Indexes for analytics
llmUsageSchema.index({ createdAt: -1 });
llmUsageSchema.index({ userId: 1, createdAt: -1 });
llmUsageSchema.index({ success: 1 });

export const LLMUsage = mongoose.model<ILLMUsage>('LLMUsage', llmUsageSchema);
