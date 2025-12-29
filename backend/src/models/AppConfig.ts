import mongoose, { Document, Schema } from 'mongoose';
import crypto from 'crypto';

export interface IAppConfig extends Document {
  openAIApiKey?: string;
  openAIKeyUpdatedAt?: Date;
  openAIKeyUpdatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  encryptApiKey(key: string): string;
  decryptApiKey(encryptedKey: string): string;
}

// Encryption key from environment (fallback to a default for development)
// In production, this MUST be set as an environment variable
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-32-char-encryption-key!!';
const ALGORITHM = 'aes-256-cbc';

const appConfigSchema = new Schema<IAppConfig>(
  {
    openAIApiKey: {
      type: String,
      select: false // Never include in queries by default
    },
    openAIKeyUpdatedAt: {
      type: Date
    },
    openAIKeyUpdatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

// Encrypt API key before saving
appConfigSchema.methods.encryptApiKey = function (key: string): string {
  const iv = crypto.randomBytes(16);
  const keyBuffer = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32));
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(key, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
};

// Decrypt API key when needed
appConfigSchema.methods.decryptApiKey = function (encryptedKey: string): string {
  const parts = encryptedKey.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const keyBuffer = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32));
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

// Static method to get or create the singleton config
appConfigSchema.statics.getConfig = async function (): Promise<IAppConfig> {
  let config = await this.findOne().select('+openAIApiKey');
  if (!config) {
    config = await this.create({});
  }
  return config;
};

export const AppConfig = mongoose.model<IAppConfig>('AppConfig', appConfigSchema);
