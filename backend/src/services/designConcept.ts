import sharp from 'sharp';
import mongoose from 'mongoose';
import { renderImage } from './llmService';
import { uploadBufferToS3 } from '../utils/s3Service';
import { callClaudeTool, DESIGN_MODELS, type ClaudeImage } from '../design/claude';
import { brandText, type PlannedOption } from '../design/director';
import {
  ART_LAYER_PROMPT,
  CONCEPT_DIRECTIONS,
  CONCEPT_READER_SYSTEM,
  CONCEPT_SIZE,
  CONCEPT_TOOL,
  brandColors,
  cleanBlueprint,
  conceptDoc,
  conceptPrompt,
  conceptReaderPrompt,
  conceptTemplate,
  keyedArtPrompt,
  photosNote
} from '../design/concept';
import { keyMasks, placePhoto } from '../design/photoFit';
import type { BrandKit, FormatId, PhotoSlot, SponsorSlot } from '../design/types';

type Id = mongoose.Types.ObjectId;

/**
 * Concept-first options for a poster job (see design/concept.ts): for each option, the image model
 * draws a concept from words alone, then a copy without words or logos (the art layer); Claude
 * reads the concept into a blueprint with the real words; the blueprint becomes a design the
 * engine renders and checks like any other. Options are made side by side.
 */

export interface ConceptInput {
  brief: string;
  caption: string;
  kit: BrandKit;
  format: FormatId;
  photos: { slot: PhotoSlot; buffer: Buffer; description?: string }[];
  sponsors: SponsorSlot[];
  campaignLogoIds: string[];
  voice: { sector?: string; tone?: string } | null;
  count: number;
  apiKey: string;
  userId: Id;
  log: (name: string, model: string, usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }, cost: number, ms: number, ok?: boolean, error?: string) => Promise<void>;
}

export interface ConceptOption extends PlannedOption {
  conceptUrl: string;
}

async function small(buffer: Buffer, size = 1024): Promise<ClaudeImage> {
  const jpeg = await sharp(buffer, { failOn: 'none' }).rotate().resize({ width: size, height: size, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
  return { mediaType: 'image/jpeg', base64: jpeg.toString('base64') };
}

const shapeOf = (s: PhotoSlot): 'wide' | 'tall' | 'square' => (s.width > s.height * 1.15 ? 'wide' : s.height > s.width * 1.15 ? 'tall' : 'square');

/** One option, from concept to a rendered-ready design. Null when any step fails. */
async function oneConcept(input: ConceptInput, index: number): Promise<ConceptOption | null> {
  const { kit, format } = input;
  const size = CONCEPT_SIZE[format] || '1024x1536';
  const details = (input.brief.match(/^\s*-?\s*(date|time|place|where|when)\s*:/gim) || []).length;
  const ask = {
    brief: input.brief,
    brandName: kit.name,
    sector: input.voice?.sector,
    colors: brandColors(kit),
    mood: input.voice?.tone,
    format,
    words: { headline: true, subhead: true, details: Math.max(1, Math.min(3, details || 2)), cta: true },
    partners: input.sponsors.length,
    otherLogos: input.campaignLogoIds.length,
    photos: input.photos.slice(0, 1).map((p) => ({ shape: shapeOf(p.slot), description: p.description })),
    direction: CONCEPT_DIRECTIONS[index % CONCEPT_DIRECTIONS.length]
  };

  // With photos, the image model designs with them (at most 3); the engine later shows the real
  // ones exactly where and how it used them.
  const refs = input.photos.slice(0, 3);
  const withPhotos = refs.length > 0;

  // 1) The concept.
  let t0 = Date.now();
  let concept: Buffer;
  try {
    const prompt = withPhotos ? `${conceptPrompt({ ...ask, photos: [] })}\n${photosNote(refs.length)}` : conceptPrompt(ask);
    const images = await Promise.all(refs.map(async (p, i) => ({ buffer: await sharp(p.buffer).rotate().resize({ width: 1024, height: 1024, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer(), name: `photo-${i + 1}.jpg`, contentType: 'image/jpeg' })));
    concept = await renderImage({ prompt, images, size, fidelity: withPhotos ? 'high' : undefined, userId: input.userId, promptName: 'Design · concept' });
  } catch (error: any) {
    console.error('[design] Concept failed:', error?.message);
    return null;
  }
  const conceptUrl = await uploadBufferToS3(await sharp(concept).jpeg({ quality: 85 }).toBuffer(), 'image/jpeg', 'design-backgrounds');

  // 2) The art layer (words and logos removed; with photos, their areas in key colours) and
  // 3) the blueprint, side by side.
  t0 = Date.now();
  const art = renderImage({
    prompt: withPhotos ? keyedArtPrompt(refs.length) : ART_LAYER_PROMPT,
    images: [{ buffer: concept, name: 'concept.png', contentType: 'image/png' }],
    size,
    purpose: 'edit',
    fidelity: 'high',
    userId: input.userId,
    promptName: 'Design · art layer'
  }).catch((error: any) => {
    console.error('[design] Art layer failed:', error?.message);
    return null;
  });
  const images: ClaudeImage[] = [{ ...(await small(concept)), label: 'The concept:' }];
  for (const [i, p] of refs.entries()) images.push({ ...(await small(p.buffer, 640)), label: `Real photo ${i + 1}:` });
  const read = callClaudeTool<any>({
    apiKey: input.apiKey,
    model: DESIGN_MODELS.director,
    system: CONCEPT_READER_SYSTEM,
    context: brandText(kit),
    prompt: conceptReaderPrompt({
      brief: input.brief,
      brand: '',
      partners: input.sponsors.map((s) => s.name || 'partner'),
      otherLogos: input.campaignLogoIds.length,
      photos: withPhotos ? refs.length : 0,
      photosPlaced: withPhotos,
      format
    }),
    images,
    tool: CONCEPT_TOOL,
    maxTokens: 3500
  })
    .then(async (res) => {
      await input.log('Design · concept reading', `anthropic/${res.model}`, res.usage, res.cost, Date.now() - t0);
      return res.input;
    })
    .catch(async (error: any) => {
      await input.log('Design · concept reading', `anthropic/${DESIGN_MODELS.director}`, { input: 0, output: 0 }, 0, Date.now() - t0, false, error?.message);
      console.error('[design] Concept reading failed:', error?.message);
      return null;
    });
  const [artBuf, raw] = await Promise.all([art, read]);
  if (!artBuf || !raw) return null;

  const bp = cleanBlueprint(raw, { partners: input.sponsors.length, photos: withPhotos ? 0 : input.photos.length });
  const [cw, ch] = size.split('x').map(Number);
  bp.aspect = cw / ch;
  let artFile: { buffer: Buffer; type: string } = { buffer: await sharp(artBuf).jpeg({ quality: 90 }).toBuffer(), type: 'image/jpeg' };
  if (withPhotos) {
    // Where each real photo shows (the key colours), and where it sits (matched on the concept).
    const keyed = await keyMasks(artBuf, refs.length);
    const layers: NonNullable<typeof bp.photoLayers> = [];
    for (let i = 0; i < refs.length; i++) {
      if (!keyed.areas[i]) continue;
      const place = await placePhoto({
        concept,
        mask: keyed.masks[i],
        maskWidth: keyed.width,
        maskHeight: keyed.height,
        photo: refs[i].buffer,
        photoWidth: refs[i].slot.width,
        photoHeight: refs[i].slot.height,
        focal: refs[i].slot.focal
      });
      if (place) layers.push({ index: i, x: place.x, y: place.y, w: place.w, h: place.h, matched: place.matched });
    }
    if (!layers.length) {
      console.error('[design] The keyed art showed no photo areas; this option is dropped.');
      return null;
    }
    bp.photoLayers = layers;
    artFile = { buffer: keyed.artPng, type: 'image/png' };
  }
  if (bp.regions.some((r) => r.role === 'contact')) {
    if (kit.contact?.social) bp.copy.social = kit.contact.social;
    if (kit.contact?.web) bp.copy.web = kit.contact.web.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  const meta = await sharp(artFile.buffer).metadata();
  const artUrl = await uploadBufferToS3(artFile.buffer, artFile.type, 'design-backgrounds');
  const id = `concept-${Date.now().toString(36)}${index}`;
  const design = conceptTemplate(bp, id, format);
  const primary = kit.logos.find((l) => l.role === 'primary');
  const doc = conceptDoc({
    id,
    format,
    bp,
    art: { url: artUrl, width: meta.width || 1024, height: meta.height || 1536 },
    photos: input.photos.map((p) => p.slot),
    sponsors: input.sponsors,
    primaryLogo: primary?.id || '',
    campaignLogos: input.campaignLogoIds,
    conceptUrl
  });
  return { doc, design, why: bp.improvements || 'Read from a concept', wantsBackground: true, conceptUrl };
}

/** The concept options for a poster, made side by side; those that fail are left out. */
export async function conceptOptions(input: ConceptInput): Promise<ConceptOption[]> {
  const n = Math.max(1, Math.min(4, input.count));
  const made = await Promise.all(Array.from({ length: n }, (_, i) => oneConcept(input, i)));
  return made.filter((o): o is ConceptOption => !!o);
}
