import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export enum UserRole {
  SYSTEM_ADMIN = 'system_admin',
  HYBRID = 'hybrid'
}

/**
 * Which part(s) of the platform a user may use. Set by a System Admin.
 *  - part_one: the full campaign suite (campaigns, projects, tasks, calendar, sheets, AI tools)
 *  - part_two: the Content Hub (hub projects, slots, uploads, poster versions)
 *  - both:     no restriction (default, so existing users keep working unchanged)
 * System Admins always have access to both parts regardless of this value.
 */
export enum AccessMode {
  BOTH = 'both',
  PART_ONE = 'part_one',
  PART_TWO = 'part_two'
}

export type AppPart = AccessMode.PART_ONE | AccessMode.PART_TWO;

/** True when the user may use the given part of the platform. */
export function hasPartAccess(
  user: { role: UserRole; accessMode?: AccessMode },
  part: AppPart
): boolean {
  if (user.role === UserRole.SYSTEM_ADMIN) return true;
  const mode = user.accessMode ?? AccessMode.BOTH;
  return mode === AccessMode.BOTH || mode === part;
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
      default: AccessMode.BOTH
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
