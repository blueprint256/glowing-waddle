import mongoose, { Document, Schema } from 'mongoose';

export interface IPendingRequest extends Document {
  slotId: mongoose.Types.ObjectId;
  expiresAt: Date;
  token: string;
}

const pendingRequestSchema = new Schema<IPendingRequest>({
  slotId: {
    type: Schema.Types.ObjectId,
    ref: 'Slot',
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    // MongoDB removes the document once expiresAt has passed (expired links clean themselves up).
    index: { expireAfterSeconds: 0 },
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
});

export const PendingRequest = mongoose.model<IPendingRequest>(
  'PendingRequest',
  pendingRequestSchema,
);