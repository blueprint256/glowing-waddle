import mongoose, { Document, Schema } from 'mongoose';
import crypto from 'crypto';

export interface IAppConfig extends Document {
  // OpenAI configuration
  openAIApiKey?: string;
  openAIKeyUpdatedAt?: Date;
  openAIKeyUpdatedBy?: mongoose.Types.ObjectId;

  // Anthropic configuration
  anthropicApiKey?: string;
  anthropicKeyUpdatedAt?: Date;
  anthropicKeyUpdatedBy?: mongoose.Types.ObjectId;

  // Grok (xAI) configuration
  grokApiKey?: string;
  grokKeyUpdatedAt?: Date;
  grokKeyUpdatedBy?: mongoose.Types.ObjectId;

  // Google Gemini configuration
  geminiApiKey?: string;
  geminiKeyUpdatedAt?: Date;
  geminiKeyUpdatedBy?: mongoose.Types.ObjectId;

  // Default LLM configuration
  defaultLLMProvider?: string; // 'openai' | 'anthropic' | 'grok' | 'gemini'
  defaultLLMModel?: string;

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
    // OpenAI configuration
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
    },

    // Anthropic configuration
    anthropicApiKey: {
      type: String,
      select: false
    },
    anthropicKeyUpdatedAt: {
      type: Date
    },
    anthropicKeyUpdatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },

    // Grok (xAI) configuration
    grokApiKey: {
      type: String,
      select: false
    },
    grokKeyUpdatedAt: {
      type: Date
    },
    grokKeyUpdatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },

    // Google Gemini configuration
    geminiApiKey: {
      type: String,
      select: false
    },
    geminiKeyUpdatedAt: {
      type: Date
    },
    geminiKeyUpdatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },

    // Default LLM configuration
    defaultLLMProvider: {
      type: String,
      enum: ['openai', 'anthropic', 'grok', 'gemini'],
      default: 'openai'
    },
    defaultLLMModel: {
      type: String,
      default: 'gpt-4o-mini'
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

// Define the model interface with static methods
interface IAppConfigModel extends mongoose.Model<IAppConfig> {
  getConfig(): Promise<IAppConfig>;
}

// Static method to get or create the singleton config
appConfigSchema.statics.getConfig = async function (): Promise<IAppConfig> {
  let config = await this.findOne().select('+openAIApiKey +anthropicApiKey +grokApiKey +geminiApiKey');
  if (!config) {
    config = await this.create({});
  }
  return config;
};

export const AppConfig = mongoose.model<IAppConfig, IAppConfigModel>('AppConfig', appConfigSchema);
