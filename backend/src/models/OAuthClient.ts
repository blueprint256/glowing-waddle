import mongoose, { Document, Schema } from 'mongoose';

/**
 * An OAuth client registered through Dynamic Client Registration (RFC 7591),
 * e.g. Claude registering itself when a user adds the connector.
 */
export interface IOAuthClient extends Document {
  clientId: string;
  /** sha256 of the client secret, only for confidential clients. */
  clientSecretHash?: string;
  clientName: string;
  clientUri?: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
  scope: string;
  createdAt: Date;
  updatedAt: Date;
}

const oauthClientSchema = new Schema<IOAuthClient>(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    clientSecretHash: { type: String },
    clientName: { type: String, required: true, trim: true },
    clientUri: { type: String, trim: true },
    redirectUris: { type: [String], required: true },
    grantTypes: { type: [String], default: ['authorization_code', 'refresh_token'] },
    responseTypes: { type: [String], default: ['code'] },
    tokenEndpointAuthMethod: {
      type: String,
      enum: ['none', 'client_secret_post', 'client_secret_basic'],
      default: 'none'
    },
    scope: { type: String, default: 'mcp' }
  },
  { timestamps: true }
);

export const OAuthClient = mongoose.model<IOAuthClient>('OAuthClient', oauthClientSchema);
