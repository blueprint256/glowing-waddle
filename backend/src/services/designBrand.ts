import crypto from 'crypto';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { BrandKitModel, type IBrandKit, type BrandKitLogoVariant } from '../models/BrandKit';
import { User } from '../models/User';
import { uploadBufferToS3 } from '../utils/s3Service';
import { loadPicture } from './postPicture';
import { prepareLogo, guessVariant } from '../design/assets';
import { packById } from '../design/packs';
import { isHex, mix } from '../design/color';
import { FONT_IDS } from '../design/fonts';
import type { BrandKit, BrandLogo, LogoAsset } from '../design/types';

/**
 * An account's brand kit for posters: read, created on first use from what the account already
 * has (Settings › Brand logo), and turned into the engine's BrandKit (with the pack's rules).
 */

type Id = mongoose.Types.ObjectId;

const newId = () => crypto.randomBytes(6).toString('hex');

/** A clean, neutral start for brands without colours yet. */
const NEUTRAL = {
  primary: { name: 'Primary', hex: '#1f4e79' },
  secondary: { name: 'Secondary', hex: '#2f7a78' },
  accent: { name: 'Accent', hex: '#f2a541' },
  ink: { name: 'Text', hex: '#1d2430' },
  paper: { name: 'Paper', hex: '#ffffff' }
};

/** Prepares an uploaded logo file (box removed, trimmed) and stores it. */
export async function storeLogoFile(input: Buffer, originalUrl?: string): Promise<BrandKitLogoVariant> {
  const p = await prepareLogo(input);
  const url = await uploadBufferToS3(p.png, 'image/png', 'brand-logos');
  return {
    id: newId(),
    url,
    variant: guessVariant(p),
    width: p.width,
    height: p.height,
    ink: p.ink,
    lightness: p.lightness,
    onLight: p.onLight,
    onDark: p.onDark,
    originalUrl,
    lowRes: p.lowRes
  };
}

/** The two most characteristic colours of a logo (skipping near-whites, near-blacks and greys). */
export async function paletteFromLogo(input: Buffer): Promise<string[]> {
  const { data, info } = await sharp(input, { failOn: 'none' }).ensureAlpha().resize({ width: 160, height: 160, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const counts = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 235 && min > 225) continue;
    if (max < 30) continue;
    if (max - min < 28) continue;
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const c = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += r;
    c.g += g;
    c.b += b;
    counts.set(key, c);
  }
  const hex = (c: { n: number; r: number; g: number; b: number }) =>
    '#' + [c.r / c.n, c.g / c.n, c.b / c.n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return Array.from(counts.values())
    .sort((a, b) => b.n - a.n)
    .slice(0, 2)
    .map(hex);
}

/** The account's kit, created from its existing logo the first time a poster is made. */
export async function loadBrandKit(ownerId: Id | string): Promise<IBrandKit> {
  const existing = await BrandKitModel.findOne({ ownerId });
  if (existing) return existing;
  const owner = await User.findById(ownerId).select('companyInfo');
  const info: any = owner?.companyInfo || {};
  const colors = JSON.parse(JSON.stringify(NEUTRAL));
  const logos: any[] = [];
  if (info.primaryLogoUrl) {
    try {
      const { buffer } = await loadPicture(info.primaryLogoUrl);
      const variant = await storeLogoFile(buffer, info.primaryLogoUrl);
      logos.push({ id: newId(), name: `${info.companyName || 'Our'} logo`.trim(), role: 'primary', variants: [variant], clearSpace: 0.25, minHeight: 0.05 });
      const palette = await paletteFromLogo(buffer);
      if (palette[0]) colors.primary = { name: 'Brand colour', hex: palette[0] };
      if (palette[1]) colors.accent = { name: 'Brand accent', hex: palette[1] };
      colors.secondary = { name: 'Brand colour (deep)', hex: mix(colors.primary.hex, colors.ink.hex, 0.35) };
    } catch (error) {
      console.error('[design] Couldn’t prepare the account logo:', error);
    }
  }
  try {
    return await BrandKitModel.create({ ownerId, name: info.companyName || '', pack: null, colors, fonts: { display: 'opensans', text: 'gelasio' }, logos, partners: [], rules: [] });
  } catch (error: any) {
    // Two requests at once: the other one created it.
    if (error?.code === 11000) {
      const kit = await BrandKitModel.findOne({ ownerId });
      if (kit) return kit;
    }
    throw error;
  }
}

const toAsset = (v: BrandKitLogoVariant): LogoAsset => ({
  id: v.id,
  url: v.url,
  variant: v.variant,
  width: v.width,
  height: v.height,
  ink: v.ink,
  lightness: v.lightness,
  onLight: v.onLight,
  onDark: v.onDark
});

/** The engine's view of a kit: the pack's colours, fonts and rules fill whatever the kit leaves out. */
export function engineKit(doc: IBrandKit): BrandKit {
  const pack = packById(doc.pack);
  const colorOr = (c: any, fallback: { name: string; hex: string }) => (c && isHex(c.hex) ? { name: c.name || fallback.name, hex: c.hex } : fallback);
  const base = pack?.colors || NEUTRAL;
  const font = (id: string | undefined, fallback: string) => (id && FONT_IDS.includes(id) ? id : fallback);
  const logos: BrandLogo[] = (doc.logos || [])
    .filter((l) => l.variants?.length)
    .map((l) => ({
      id: l.id,
      name: l.name,
      role: l.role,
      variants: l.variants.map(toAsset),
      clearSpace: l.clearSpace ?? (l.role === 'primary' ? pack?.logoDefaults.primary.clearSpace : pack?.logoDefaults.campaign.clearSpace) ?? 0.25,
      minHeight: l.minHeight ?? 0.05,
      requiresPrimary: l.role === 'campaign' ? l.requiresPrimary ?? pack?.logoDefaults.campaign.requiresPrimary : undefined
    }));
  return {
    name: doc.name || pack?.name || 'Brand',
    pack: doc.pack || null,
    colors: {
      primary: colorOr(doc.colors?.primary, base.primary),
      secondary: colorOr(doc.colors?.secondary, base.secondary),
      accent: colorOr(doc.colors?.accent, base.accent),
      ink: colorOr(doc.colors?.ink, base.ink),
      paper: colorOr(doc.colors?.paper, base.paper)
    },
    fonts: {
      display: font(doc.fonts?.display, pack?.fonts.display || 'opensans'),
      text: font(doc.fonts?.text, pack?.fonts.text || 'gelasio'),
      accent: font(doc.fonts?.accent, pack?.fonts.accent || '') || undefined
    },
    logos,
    rules: [...(pack?.rules || []), ...(doc.rules || []).map((r) => ({ id: r.id, text: r.text, hard: !!r.hard }))],
    notes: [pack?.notes, doc.notes].filter(Boolean).join('\n'),
    contact: doc.contact?.social || doc.contact?.web ? { social: doc.contact.social || undefined, web: doc.contact.web || undefined } : undefined
  };
}

/** Applies a brand pack: its colours and fonts become the kit's, and logo rules take its defaults. */
export function applyPack(doc: IBrandKit, packId: string | null): void {
  const pack = packById(packId);
  doc.pack = pack ? pack.id : null;
  if (!pack) return;
  doc.colors = JSON.parse(JSON.stringify(pack.colors));
  doc.fonts = { ...pack.fonts };
  for (const l of doc.logos || []) {
    const d = l.role === 'primary' ? pack.logoDefaults.primary : pack.logoDefaults.campaign;
    l.clearSpace = d.clearSpace;
    l.minHeight = d.minHeight;
    if (l.role === 'campaign') l.requiresPrimary = d.requiresPrimary;
  }
  doc.markModified('logos');
}

export { newId as brandId };
