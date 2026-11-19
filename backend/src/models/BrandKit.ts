import mongoose, { Document, Schema } from 'mongoose';

/**
 * An account's brand kit for posters (docs/DESIGN_ENGINE.md): colours, fonts, prepared logo files
 * with their rules, saved partner logos and an optional brand pack (e.g. Rotary). One per account.
 */

export interface BrandKitLogoVariant {
  id: string;
  url: string;
  variant: 'color' | 'reverse' | 'mono-dark' | 'mono-light';
  width: number;
  height: number;
  ink: number;
  lightness: number;
  onLight: boolean;
  onDark: boolean;
  /** The file as uploaded (kept so a better preparation can be redone). */
  originalUrl?: string;
  lowRes?: boolean;
  /** Luminance of the outline (16 quantiles): decides where this version reads. */
  edge?: number[];
  /** Made by the app from an uploaded one-colour logo (its white or dark version). */
  derived?: boolean;
}

export interface BrandKitLogo {
  id: string;
  name: string;
  role: 'primary' | 'campaign';
  variants: BrandKitLogoVariant[];
  clearSpace: number;
  minHeight: number;
  requiresPrimary?: boolean;
  /** Campaign logos: put on every poster unless switched off for one. */
  always?: boolean;
}

export interface BrandKitPartner {
  id: string;
  name: string;
  logo: BrandKitLogoVariant;
  /** The partner logo's one-colour white or dark version, made from the upload. */
  alts?: BrandKitLogoVariant[];
}

export interface IBrandKit extends Document {
  ownerId: mongoose.Types.ObjectId;
  name: string;
  pack?: string | null;
  colors: {
    primary: { name: string; hex: string };
    secondary: { name: string; hex: string };
    accent: { name: string; hex: string };
    ink: { name: string; hex: string };
    paper: { name: string; hex: string };
  };
  fonts: { display: string; text: string; accent?: string };
  logos: BrandKitLogo[];
  partners: BrandKitPartner[];
  /** The account's own rules on top of the pack's (soft unless marked hard by an admin). */
  rules: { id: string; text: string; hard: boolean }[];
  notes?: string;
  /** The handle line ("Rotaract D9213") and website posters show where the design has room. */
  contact?: { social?: string; web?: string };
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const variantSchema = new Schema<BrandKitLogoVariant>(
  {
    id: { type: String, required: true },
    url: { type: String, required: true },
    variant: { type: String, enum: ['color', 'reverse', 'mono-dark', 'mono-light'], default: 'color' },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    ink: { type: Number, default: 0.5 },
    lightness: { type: Number, default: 0.5 },
    onLight: { type: Boolean, default: true },
    onDark: { type: Boolean, default: false },
    originalUrl: { type: String },
    lowRes: { type: Boolean },
    edge: { type: [Number], default: undefined },
    derived: { type: Boolean }
  },
  { _id: false }
);

const colorSchema = new Schema({ name: { type: String, default: '' }, hex: { type: String, required: true } }, { _id: false });

const brandKitSchema = new Schema<IBrandKit>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, default: '', trim: true, maxlength: 120 },
    pack: { type: String, default: null },
    colors: {
      primary: { type: colorSchema, required: true },
      secondary: { type: colorSchema, required: true },
      accent: { type: colorSchema, required: true },
      ink: { type: colorSchema, required: true },
      paper: { type: colorSchema, required: true }
    },
    fonts: {
      display: { type: String, default: 'opensans' },
      text: { type: String, default: 'gelasio' },
      accent: { type: String }
    },
    logos: [
      new Schema<BrandKitLogo>(
        {
          id: { type: String, required: true },
          name: { type: String, default: 'Logo', maxlength: 80 },
          role: { type: String, enum: ['primary', 'campaign'], default: 'primary' },
          variants: { type: [variantSchema], default: [] },
          clearSpace: { type: Number, default: 0.25, min: 0, max: 1 },
          minHeight: { type: Number, default: 0.05, min: 0.02, max: 0.3 },
          requiresPrimary: { type: Boolean },
          always: { type: Boolean, default: false }
        },
        { _id: false }
      )
    ],
    partners: [new Schema<BrandKitPartner>({ id: { type: String, required: true }, name: { type: String, required: true, maxlength: 80 }, logo: { type: variantSchema, required: true }, alts: { type: [variantSchema], default: [] } }, { _id: false })],
    rules: [new Schema({ id: { type: String, required: true }, text: { type: String, required: true, maxlength: 400 }, hard: { type: Boolean, default: false } }, { _id: false })],
    notes: { type: String, maxlength: 3000 },
    contact: { social: { type: String, maxlength: 60 }, web: { type: String, maxlength: 60 } },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export const BrandKitModel = mongoose.model<IBrandKit>('BrandKit', brandKitSchema);
