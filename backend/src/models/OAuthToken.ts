import mongoose, { Document, Schema } from 'mongoose';

/**
 * Access + refresh token pair issued to an OAuth client (e.g. Claude) for one user.
 * Only sha256 hashes are stored; the raw tokens are shown to the client once.
 * Refresh tokens rotate: each refresh revokes this record and issues a new one.
 */
export interface IOAuthToken extends Document {
  accessTokenHash: string;
  refreshTokenHash?: string;
  clientId: string;
  userId: mongoose.Types.ObjectId;
  scope: string;
  resource?: string;
  /** When the user approved this connection (kept across refresh-token rotation). */
  grantedAt: Date;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const oauthTokenSchema = new Schema<IOAuthToken>(
  {
    accessTokenHash: { type: String, required: true, unique: true, index: true },
    refreshTokenHash: { type: String, index: { unique: true, sparse: true } },
    clientId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scope: { type: String, default: 'mcp' },
    resource: { type: String },
    grantedAt: { type: Date, default: Date.now },
    accessTokenExpiresAt: { type: Date, required: true },
    refreshTokenExpiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date }
  },
  { timestamps: true }
);

// Records disappear once the refresh token can no longer be used.
oauthTokenSchema.index({ refreshTokenExpiresAt: 1 }, { expireAfterSeconds: 0 });

export const OAuthToken = mongoose.model<IOAuthToken>('OAuthToken', oauthTokenSchema);
