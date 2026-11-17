import mongoose, { Document, Schema } from 'mongoose';

/** Short-lived record of a "Connect account" sign-in in progress (holds the PKCE verifier server-side). */
export interface IPublishingConnect extends Document {
  state: string;
  userId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  provider: string;
  codeVerifier: string;
  returnTo?: string;
  createdAt: Date;
}

const schema = new Schema<IPublishingConnect>(
  {
    state: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, required: true },
    codeVerifier: { type: String, required: true },
    returnTo: String,
    createdAt: { type: Date, default: Date.now, expires: 900 }
  },
  { versionKey: false }
);

export const PublishingConnect = mongoose.model<IPublishingConnect>('PublishingConnect', schema);
