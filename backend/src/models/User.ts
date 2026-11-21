import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export enum UserRole {
  SYSTEM_ADMIN = 'system_admin',
  HYBRID = 'hybrid'
}

/**
 * Which part of the platform a user is on. Set by a System Admin (later: driven by plan/subscription).
 *
 * Both parts are the SAME app with the same data and screens (campaigns, projects, tasks, calendar,
 * sheets, archives, Canva import, manual uploads, social previews). The only difference is how content is made:
 *  - part_one: the user may generate content with our backend AI routing (default)
 *  - part_two: AI generation is switched off. Content arrives manually or through connectors
 *              (e.g. an MCP server letting ChatGPT/Claude work with the app's API on the user's behalf).
 * System Admins always keep AI access (they configure it).
 *
 * Legacy value 'both' (from an earlier iteration) is read as part_one.
 */
export enum AccessMode {
  PART_ONE = 'part_one',
  PART_TWO = 'part_two'
}

/** True when the user may use backend AI generation. */
export function canUseAI(user: { role: UserRole; accessMode?: string }): boolean {
  if (user.role === UserRole.SYSTEM_ADMIN) return true;
  return user.accessMode !== AccessMode.PART_TWO;
}

/**
 * True when the user may connect an AI assistant (e.g. Claude via our MCP connector) to their account.
 * Enabled for everyone by default; a System Admin can switch it off per account.
 * Deactivated accounts can never use the connector.
 */
export function canUseConnector(user: { isActive?: boolean; mcpEnabled?: boolean }): boolean {
  return user.isActive !== false && user.mcpEnabled !== false;
}

/**
 * True when the user may use Blue, the in-app AI assistant (runs on the app's own AI keys).
 * Available to every user by default, whatever their Part; a System Admin can switch it off per account.
 */
export function canUseBlue(user: { isActive?: boolean; assistantEnabled?: boolean }): boolean {
  return user.isActive !== false && user.assistantEnabled !== false;
}

/**
 * True when the user may use the Library (Aggregator): upload past work, versions, AI search.
 * On for everyone by default; a System Admin can switch it off per account.
 */
export function canUseLibrary(user: { isActive?: boolean; libraryEnabled?: boolean }): boolean {
  return user.isActive !== false && user.libraryEnabled !== false;
}

/** Publishing (scheduling and posting to social accounts) is on unless an admin turned it off for this user. */
export function canUsePublishing(user: { isActive?: boolean; publishingEnabled?: boolean }): boolean {
  return user.isActive !== false && user.publishingEnabled !== false;
}

export interface IUser extends Document {
  email: string;
  password?: string;
  googleId?: string;
  authProvider: 'local' | 'google';
  firstName: string;
  lastName: string;
  role: UserRole;
  accessMode: AccessMode;
  /** Claude connector (MCP) access, toggled by a System Admin. Default true. */
  mcpEnabled: boolean;
  /** Blue (in-app assistant) access, toggled by a System Admin. Default true. */
  assistantEnabled: boolean;
  /** Library (Aggregator) access, toggled by a System Admin. Default true. */
  libraryEnabled: boolean;
  publishingEnabled: boolean;
  /** Labels a System Admin gives users to target Inbox messages (e.g. "pharmacy", "vip"). */
  tags: string[];
  /**
   * Monthly AI allowance set by a System Admin for this account. null (or missing) uses the
   * workspace default; 0 means no limit. See services/aiAllowance.ts.
   */
  aiAllowance?: { images?: number | null; designs?: number | null; blueMessages?: number | null };
  /** Inbox reminder types this user turned off (only optional ones, e.g. "post_upcoming"). */
  inboxMuted: string[];
  isActive: boolean;
  companyInfo?: {
    companyName?: string;
    sector?: string;
    about?: string;
    productsServices?: string;
    usp?: string;
    brandTone?: string;
    audienceProfile?: string;
    globalRules?: string;
    brandGuidelines?: string;
    primaryLogoUrl?: string;
    secondaryLogoUrl?: string;
    tertiaryLogoUrl?: string;
  };
  integrations?: {
    canva?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: Date;
      connected: boolean;
      connectedAt?: Date;
    };
  };
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  getFullName(): string;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    password: {
      type: String,
      required: false,
      minlength: 6
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true
    },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local'
    },
    firstName: {
      type: String,
      required: true,
      trim: true
    },
    lastName: {
      type: String,
      required: true,
      trim: true
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      required: true,
      default: UserRole.HYBRID
    },
    accessMode: {
      type: String,
      enum: Object.values(AccessMode),
      default: AccessMode.PART_ONE
    },
    mcpEnabled: {
      type: Boolean,
      default: true
    },
    assistantEnabled: {
      type: Boolean,
      default: true
    },
    libraryEnabled: {
      type: Boolean,
      default: true
    },
    publishingEnabled: {
      type: Boolean,
      default: true
    },
    tags: {
      type: [String],
      default: []
    },
    aiAllowance: {
      images: { type: Number, default: null, min: 0 },
      designs: { type: Number, default: null, min: 0 },
      blueMessages: { type: Number, default: null, min: 0 }
    },
    inboxMuted: {
      type: [String],
      default: []
    },
    isActive: {
      type: Boolean,
      default: true
    },
    companyInfo: {
      companyName: { type: String, trim: true },
      sector: { type: String, trim: true },
      about: { type: String, trim: true },
      productsServices: { type: String, trim: true },
      usp: { type: String, trim: true },
      brandTone: { type: String, trim: true },
      audienceProfile: { type: String, trim: true },
      globalRules: { type: String, trim: true },
      brandGuidelines: { type: String, trim: true },
      primaryLogoUrl: { type: String, trim: true },
      secondaryLogoUrl: { type: String, trim: true },
      tertiaryLogoUrl: { type: String, trim: true }
    },
    integrations: {
      canva: {
        accessToken: String,
        refreshToken: String,
        expiresAt: Date,
        connected: { type: Boolean, default: false },
        connectedAt: Date
      }
    }
  },
  {
    timestamps: true
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Get full name
userSchema.methods.getFullName = function (): string {
  return `${this.firstName} ${this.lastName}`;
};

// Remove password from JSON output
userSchema.set('toJSON', {
  transform: function (doc, ret) {
    const { password, ...rest } = ret;
    return rest;
  }
});

export const User = mongoose.model<IUser>('User', userSchema);
