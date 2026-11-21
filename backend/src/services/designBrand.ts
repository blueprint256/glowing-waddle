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

/** Logo addresses that couldn't be prepared, so a broken one isn't fetched on every page load. */
const unusableLogos = new Set<string>();

/** Turns the account's main logo address into the kit's main logo (prepared versions included). */
async function importCompanyLogo(kit: IBrandKit, url: string, companyName?: string): Promise<boolean> {
  if (unusableLogos.has(url)) return false;
  try {
    const { buffer } = await loadPicture(url);
    const variants = await storeLogoFiles(buffer, url);
    kit.logos = [
      { id: newId(), name: `${companyName || 'Our'} logo`.trim(), role: 'primary', variants, clearSpace: packById(kit.pack)?.logoDefaults.primary.clearSpace ?? 0.25, minHeight: packById(kit.pack)?.logoDefaults.primary.minHeight ?? 0.05 } as any,
      ...kit.logos.filter((l) => l.role !== 'primary')
    ];
    kit.markModified('logos');
    return true;
  } catch (error) {
    unusableLogos.add(url);
    console.error('[design] Couldn’t prepare the account logo:', error);
    return false;
  }
}

/**
 * The account's brand kit. One brand per account: the company information (name, voice, main logo
 * address) and the kit (prepared logos, colours, fonts, partners, rules) are edited together in
 * Settings › Brand. The kit is created from the company information the first time it's needed, and
 * picks up a main logo set elsewhere (an older upload, the connector) when it has none of its own.
 */
export async function loadBrandKit(ownerId: Id | string): Promise<IBrandKit> {
  const existing = await BrandKitModel.findOne({ ownerId });
  const owner = await User.findById(ownerId).select('companyInfo');
  const info: any = owner?.companyInfo || {};
  if (existing) {
    let changed = false;
    if (!existing.logos.some((l) => l.role === 'primary' && l.variants?.length) && info.primaryLogoUrl) changed = await importCompanyLogo(existing, info.primaryLogoUrl, info.companyName);
    if (info.companyName && existing.name !== info.companyName) {
      existing.name = String(info.companyName).slice(0, 120);
      changed = true;
    }
    if (changed) await existing.save().catch(() => undefined);
    return existing;
  }
  const colors = JSON.parse(JSON.stringify(NEUTRAL));
  const draft = new BrandKitModel({ ownerId, name: info.companyName || '', pack: null, colors, fonts: { display: 'opensans', text: 'gelasio' }, customFonts: [], logos: [], partners: [], rules: [] });
  if (info.primaryLogoUrl && (await importCompanyLogo(draft, info.primaryLogoUrl, info.companyName))) {
    try {
      const { buffer } = await loadPicture(info.primaryLogoUrl);
      const palette = await paletteFromLogo(buffer);
      if (palette[0]) draft.colors.primary = { name: 'Brand colour', hex: palette[0] };
      if (palette[1]) draft.colors.accent = { name: 'Brand accent', hex: palette[1] };
      draft.colors.secondary = { name: 'Brand colour (deep)', hex: mix(draft.colors.primary.hex, draft.colors.ink.hex, 0.35) };
    } catch {
      /* the neutral colours stay */
    }
  }
  // Colours written in the brand guidelines ("#4B2E1F") are better than ones guessed from the logo.
  const written = hexesIn(String(info.brandGuidelines || ''));
  if (written[0]) draft.colors.primary = { name: 'Brand colour', hex: written[0] };
  if (written[1]) draft.colors.secondary = { name: 'Second colour', hex: written[1] };
  if (written[2]) draft.colors.accent = { name: 'Accent', hex: written[2] };
  try {
    return await draft.save();
  } catch (error: any) {
    // Two requests at once: the other one created it.
    if (error?.code === 11000) {
      const kit = await BrandKitModel.findOne({ ownerId });
      if (kit) return kit;
    }
    throw error;
  }
}

/** "#4B2E1F" and "#fff" written in free text, in order, without repeats. */
export function hexesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const hex = `#${h.toLowerCase()}`;
    if (!out.includes(hex)) out.push(hex);
  }
  return out;
}

/**
 * Keeps the company information's main logo address in step with the kit's main logo, so every
 * other feature (AI photos, previews, the connector) shows the same logo.
 */
export async function syncCompanyLogo(kit: IBrandKit): Promise<void> {
  const primary = kit.logos.find((l) => l.role === 'primary' && l.variants?.length);
  const best = primary ? primary.variants.find((v) => v.variant === 'color' && !v.derived) || primary.variants[0] : null;
  await User.updateOne({ _id: kit.ownerId }, { $set: { 'companyInfo.primaryLogoUrl': best?.url || '' } });
}

/** How the brand talks (from the company information), for the art director. */
export interface BrandVoice {
  sector?: string;
  about?: string;
  tone?: string;
  audience?: string;
  rules?: string;
  guidelines?: string;
}

export async function brandVoice(ownerId: Id | string): Promise<BrandVoice> {
  const owner = await User.findById(ownerId).select('companyInfo');
  const i: any = owner?.companyInfo || {};
  const t = (v: unknown, max = 1200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  return { sector: t(i.sector, 120), about: t(i.about), tone: t(i.brandTone, 400), audience: t(i.audienceProfile, 600), rules: t(i.globalRules), guidelines: t(i.brandGuidelines) };
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
  const customFonts = (doc.customFonts || []).filter((f) => f.files?.length).map((f) => ({ id: f.id, name: f.name, category: f.category, files: f.files.map((x) => ({ url: x.url, style: x.style, weight: x.weight, format: x.format })) }));
  const font = (id: string | undefined, fallback: string) => (id && (FONT_IDS.includes(id) || customFonts.some((c) => c.id === id)) ? id : fallback);
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
    customFonts,
    logos,
    rules: [...(pack?.rules || []), ...(doc.rules || []).map((r) => ({ id: r.id, text: r.text, hard: !!r.hard }))],
    notes: [pack?.notes, doc.notes].filter(Boolean).join('\n'),
    contact: doc.contact?.social || doc.contact?.web ? { social: doc.contact.social || undefined, web: doc.contact.web || undefined } : undefined
  };
}

/** Applies a brand pack: its colours and fonts become the kit's, and logo rules take its defaults. */
/**
 * Turns a club pack on or off. On: the account's own colours and fonts are kept aside and the
 * pack's are used. Off: they come back, or, when none were kept (a kit from before this was kept),
 * colours written in the brand guidelines, else neutral ones, with the default fonts.
 */
export function applyPack(doc: IBrandKit, packId: string | null, guidelines = ''): void {
  const pack = packById(packId);
  const had = packById(doc.pack);
  doc.pack = pack ? pack.id : null;
  if (!pack) {
    if (!had) return;
    const own = doc.ownLook;
    if (own?.colors && own?.fonts) {
      doc.colors = JSON.parse(JSON.stringify(own.colors));
      doc.fonts = { ...own.fonts };
    } else {
      const colors = JSON.parse(JSON.stringify(NEUTRAL));
      const written = hexesIn(guidelines);
      if (written[0]) colors.primary = { name: 'Brand colour', hex: written[0] };
      colors.secondary = written[1] ? { name: 'Second colour', hex: written[1] } : { name: 'Brand colour (deep)', hex: mix(colors.primary.hex, colors.ink.hex, 0.35) };
      if (written[2]) colors.accent = { name: 'Accent', hex: written[2] };
      doc.colors = colors;
      doc.fonts = { display: 'opensans', text: 'gelasio' };
    }
    doc.ownLook = null;
    doc.markModified('colors');
    doc.markModified('fonts');
    doc.markModified('ownLook');
    return;
  }
  if (!had) {
    doc.ownLook = { colors: JSON.parse(JSON.stringify(doc.colors)), fonts: { ...doc.fonts } };
    doc.markModified('ownLook');
  }
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
