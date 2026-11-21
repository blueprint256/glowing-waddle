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

  // Default LLM configuration (for text generation)
  defaultLLMProvider?: string; // 'openai' | 'anthropic' | 'grok' | 'gemini'
  defaultLLMModel?: string;

  // Image model (lib/imageModels.ts): one of SELECTABLE_IMAGE_MODELS; retired models fall back to the default
  defaultImageLLMProvider?: string; // 'openai' (only option)
  defaultImageLLMModel?: string; // e.g. 'gpt-image-2.5-flare' (the default)

  // Blue (in-app assistant) configuration
  blueEnabled: boolean;
  blueProvider?: 'anthropic' | 'openai' | 'grok';
  blueModel?: string;
  blueDailyMessageLimit: number; // per user per day; 0 = unlimited

  // Library (Aggregator) configuration
  libraryEnabled: boolean;
  libraryProvider?: 'anthropic' | 'openai' | 'grok';
  libraryModel?: string;
  libraryMonthlyAiLimit: number; // AI-read items per user per month; 0 = unlimited
  // Monthly AI allowance per account (admins have none); 0 = unlimited. Accounts can have their own.
  /** AI pictures (designed posters and AI photos together) per account per month. */
  aiImagesPerMonth: number;
  /** Older separate poster allowance: no longer used (posters count as AI pictures). */
  aiDesignsPerMonth: number;
  blueMessagesPerMonth: number;
  librarySemanticSearch: boolean; // embeddings (needs an OpenAI key)

  // Publishing (social posting). Per-provider app credentials; secrets encrypted (publishing/secrets.ts).
  publishingEnabled: boolean;
  publishingTestMode: boolean; // lets users add test channels that simulate posting
  publishingProviders: Record<string, { enabled?: boolean; clientId?: string; clientSecretEnc?: string; options?: Record<string, unknown>; updatedAt?: Date }>;

  // Canva Connect (Edit in Canva). Falls back to CANVA_CLIENT_ID / CANVA_CLIENT_SECRET env vars.
  canvaClientId?: string;
  canvaClientSecretEnc?: string;

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

    // Default LLM configuration (for text generation)
    defaultLLMProvider: {
      type: String,
      enum: ['openai', 'anthropic', 'grok', 'gemini'],
      default: 'openai'
    },
    defaultLLMModel: {
      type: String,
      default: 'gpt-4o-mini'
    },

    // Image model (lib/imageModels.ts)
    defaultImageLLMProvider: {
      type: String,
      enum: ['openai'],
      default: 'openai'
    },
    defaultImageLLMModel: {
      type: String,
      default: 'gpt-image-2.5-flare'
    },

    // Blue (in-app assistant) configuration
    blueEnabled: {
      type: Boolean,
      default: true
    },
    blueProvider: {
      type: String,
      enum: ['anthropic', 'openai', 'grok']
    },
    blueModel: {
      type: String,
      trim: true
    },
    blueDailyMessageLimit: {
      type: Number,
      default: 100,
      min: 0
    },

    // Library (Aggregator) configuration
    libraryEnabled: {
      type: Boolean,
      default: true
    },
    libraryProvider: {
      type: String,
      enum: ['anthropic', 'openai', 'grok']
    },
    libraryModel: {
      type: String,
      trim: true
    },
    libraryMonthlyAiLimit: {
      type: Number,
      default: 500,
      min: 0
    },
    aiImagesPerMonth: {
      type: Number,
      default: 30,
      min: 0
    },
    blueMessagesPerMonth: {
      type: Number,
      default: 300,
      min: 0
    },
    aiDesignsPerMonth: {
      type: Number,
      default: 12,
      min: 0
    },
    publishingEnabled: {
      type: Boolean,
      default: true
    },
    publishingTestMode: {
      type: Boolean,
      default: true
    },
    publishingProviders: {
      type: Schema.Types.Mixed,
      default: {}
    },
    canvaClientId: {
      type: String
    },
    canvaClientSecretEnc: {
      type: String
    },
    librarySemanticSearch: {
      type: Boolean,
      default: true
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
