import mongoose, { Document, Schema } from 'mongoose';

/**
 * One pass through the OAuth authorization-code flow.
 *
 * Created when Claude sends the user to /oauth/authorize (status "pending"), approved or denied
 * by the signed-in user on the consent screen, then exchanged once for tokens (status "used").
 * Documents expire automatically 10 minutes after creation.
 */
export type OAuthAuthorizationStatus = 'pending' | 'approved' | 'denied' | 'used';

export interface IOAuthAuthorization extends Document {
  requestId: string;
  /** Issuer (public base URL) the request arrived on; echoed as `iss` in the redirect (RFC 9207). */
  issuer: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  scope: string;
  resource?: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  status: OAuthAuthorizationStatus;
  userId?: mongoose.Types.ObjectId;
  /** sha256 of the authorization code, set on approval. */
  codeHash?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const oauthAuthorizationSchema = new Schema<IOAuthAuthorization>(
  {
    requestId: { type: String, required: true, unique: true, index: true },
    issuer: { type: String, required: true },
    clientId: { type: String, required: true },
    redirectUri: { type: String, required: true },
    state: { type: String },
    scope: { type: String, default: 'mcp' },
    resource: { type: String },
    codeChallenge: { type: String, required: true },
    codeChallengeMethod: { type: String, enum: ['S256'], default: 'S256' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'used'],
      default: 'pending'
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    codeHash: { type: String, index: { unique: true, sparse: true } },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

// MongoDB removes expired authorization requests automatically.
oauthAuthorizationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OAuthAuthorization = mongoose.model<IOAuthAuthorization>(
  'OAuthAuthorization',
  oauthAuthorizationSchema
);
