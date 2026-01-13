import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export enum UserRole {
  SYSTEM_ADMIN = 'system_admin',
  HYBRID = 'hybrid'
}

export interface IUser extends Document {
  email: string;
  password?: string;
  googleId?: string;
  authProvider: 'local' | 'google';
  firstName: string;
  lastName: string;
  role: UserRole;
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
    twitter?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: Date;
      connected: boolean;
      connectedAt?: Date;
      username?: string;
      userId?: string;
    };
    linkedin?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: Date;
      connected: boolean;
      connectedAt?: Date;
      profileId?: string;
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
      },
      twitter: {
        accessToken: String,
        refreshToken: String,
        expiresAt: Date,
        connected: { type: Boolean, default: false },
        connectedAt: Date,
        username: String,
        userId: String
      },
      linkedin: {
        accessToken: String,
        refreshToken: String,
        expiresAt: Date,
        connected: { type: Boolean, default: false },
        connectedAt: Date,
        profileId: String
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
