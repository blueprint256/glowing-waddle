import mongoose, { Document, Schema } from 'mongoose';
import { PLATFORMS, PlatformId } from '../publishing/types';

/**
 * A connected social account a user can publish to (a person, company page, Facebook Page, Instagram
 * account, TikTok creator or YouTube channel). Tokens are stored encrypted. Test channels (test mode)
 * have simulated=true and no tokens.
 */
export interface ISocialChannel extends Document {
  ownerId: mongoose.Types.ObjectId;
  platform: PlatformId;
  accountId: string;
  accountType: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  simulated: boolean;
  accessTokenEnc?: string;
  refreshTokenEnc?: string;
  expiresAt?: Date | null;
  scopes: string[];
  meta: Record<string, any>;
  status: 'active' | 'reconnect' | 'disabled';
  lastError?: string;
  lastUsedAt?: Date;
  connectedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ISocialChannel>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    accountId: { type: String, required: true },
    accountType: { type: String, default: 'person' },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    username: String,
    avatarUrl: String,
    simulated: { type: Boolean, default: false },
    accessTokenEnc: { type: String, select: false },
    refreshTokenEnc: { type: String, select: false },
    expiresAt: Date,
    scopes: { type: [String], default: [] },
    meta: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['active', 'reconnect', 'disabled'], default: 'active' },
    lastError: String,
    lastUsedAt: Date,
    connectedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true, minimize: false }
);

schema.index({ ownerId: 1, platform: 1, accountId: 1, simulated: 1 }, { unique: true });

export const SocialChannel = mongoose.model<ISocialChannel>('SocialChannel', schema);
