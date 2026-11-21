import mongoose, { Document, Schema } from 'mongoose';
import type { NeutralMessage, PendingAction } from '../blue/types';

/**
 * A Blue chat thread. `messages` is the provider-neutral history the model sees (user text,
 * assistant text + tool calls, tool results). `pending` holds actions waiting for the user's
 * Confirm / Cancel (deletes, archives…).
 */
export interface IBlueConversation extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  messages: NeutralMessage[];
  pending?: PendingAction | null;
  createdAt: Date;
  updatedAt: Date;
}

const blueConversationSchema = new Schema<IBlueConversation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'New chat', trim: true, maxlength: 120 },
    messages: { type: [Schema.Types.Mixed], default: [] },
    pending: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: true, minimize: false }
);

blueConversationSchema.index({ userId: 1, updatedAt: -1 });

export const BlueConversation = mongoose.model<IBlueConversation>('BlueConversation', blueConversationSchema);
