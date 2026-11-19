import crypto from 'crypto';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { BrandKitModel, type IBrandKit, type BrandKitLogoVariant } from '../models/BrandKit';
import { User } from '../models/User';
import { uploadBufferToS3 } from '../utils/s3Service';
import { loadPicture } from './postPicture';
import { prepareLogo, guessVariant, monoVersions, type PreparedLogo } from '../design/assets';
import { packById } from '../design/packs';
import { isHex, mix } from '../design/color';
import { FONT_IDS } from '../design/fonts';
import type { BrandKit, BrandLogo, LogoAsset, SponsorSlot } from '../design/types';

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
  return (await storeLogoFiles(input, originalUrl))[0];
}

/** An uploaded logo, prepared and stored: the file itself first, then (for a one-colour logo) its
 *  white and dark versions, which posters use only where the original wouldn't read. */
export async function storeLogoFiles(input: Buffer, originalUrl?: string): Promise<BrandKitLogoVariant[]> {
  const p = await prepareLogo(input);
  const url = await uploadBufferToS3(p.png, 'image/png', 'brand-logos');
  const main: BrandKitLogoVariant = {
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
    lowRes: p.lowRes,
    edge: p.edge
  };
  return [main, ...(await derivedFiles(p, main))];
}

async function derivedFiles(p: PreparedLogo, main: BrandKitLogoVariant): Promise<BrandKitLogoVariant[]> {
  const out: BrandKitLogoVariant[] = [];
  for (const m of await monoVersions(p)) {
    out.push({
      ...main,
      id: newId(),
      url: await uploadBufferToS3(m.png, 'image/png', 'brand-logos'),
      variant: m.variant,
      lightness: m.variant === 'mono-light' ? 1 : 0.1,
      onLight: m.variant === 'mono-dark',
      onDark: m.variant === 'mono-light',
      originalUrl: undefined,
      edge: m.edge,
      derived: true
    });
  }
  return out;
}

/** A logo's versions after a new upload: the supplied files (the new one replacing one of its kind),
 *  then made versions only of kinds nobody supplied. */
export function mergeVersions(current: BrandKitLogoVariant[], uploaded: BrandKitLogoVariant[]): BrandKitLogoVariant[] {
  const [main, ...made] = uploaded;
  const supplied = [...current.filter((v) => !v.derived && v.variant !== main.variant), main];
  const kinds = new Set(supplied.map((v) => v.variant));
  const keptMade = [...made, ...current.filter((v) => v.derived)].filter((v, i, all) => !kinds.has(v.variant) && all.findIndex((x) => x.variant === v.variant) === i);
  return [...supplied.slice(-4), ...keptMade];
}

/**
 * Logos stored before outlines were measured: measured now (from the stored, prepared file) and
 * given their one-colour versions, once. Saves the kit when anything changed.
 */
export async function upgradeKitLogos(kit: IBrandKit): Promise<void> {
  let changed = false;
  const upgrade = async (v: BrandKitLogoVariant): Promise<BrandKitLogoVariant[] | null> => {
    if (v.edge?.length || v.derived) return null;
    try {
      const { buffer } = await loadPicture(v.url);
      const p = await prepareLogo(buffer);
      const measured = { ...v, edge: p.edge };
      return [measured, ...(await derivedFiles(p, measured))];
    } catch (error) {
      console.error('[design] Couldn’t measure a stored logo:', error);
      return null;
    }
  };
  for (const logo of kit.logos) {
    for (const v of [...logo.variants]) {
      const up = await upgrade(v);
      if (!up) continue;
      logo.variants = mergeVersions(logo.variants.filter((x) => x.id !== v.id), up);
      changed = true;
    }
  }
  for (const partner of kit.partners) {
    const up = await upgrade(partner.logo);
    if (!up) continue;
    partner.logo = up[0];
    partner.alts = up.slice(1);
    changed = true;
  }
  if (changed) {
    kit.markModified('logos');
    kit.markModified('partners');
    await kit.save();
  }
}

/** A saved partner as a poster's sponsor (with its other versions). */
export function sponsorFromPartner(p: { name: string; logo: BrandKitLogoVariant; alts?: BrandKitLogoVariant[] }): SponsorSlot {
  return { name: p.name, logo: toAsset(p.logo), alts: (p.alts || []).map(toAsset) };
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
      const variants = await storeLogoFiles(buffer, info.primaryLogoUrl);
      logos.push({ id: newId(), name: `${info.companyName || 'Our'} logo`.trim(), role: 'primary', variants, clearSpace: 0.25, minHeight: 0.05 });
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
  onDark: v.onDark,
  ...(v.edge?.length ? { edge: v.edge } : {}),
  ...(v.derived ? { derived: true } : {})
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
