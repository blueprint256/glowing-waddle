import sharp from 'sharp';
import mongoose from 'mongoose';
import { CommandMapping } from '../models/CommandMapping';
import { Campaign } from '../models/Campaign';
import { User } from '../models/User';
import type { ITask, PostAIDraft } from '../models/Task';
import { downloadImageFromUrl, getObjectBuffer, objectKeyFromUrl, uploadBufferToS3, deleteFromS3 } from '../utils/s3Service';
import { compileSuperPrompt, executeCommandChain, renderImage } from './llmService';
import { AIError } from '../lib/aiError';
import {
  BUILTIN_CHANGE_IMAGE,
  BUILTIN_CREATE_IMAGE,
  FORMAT_SIZES,
  apiSizeFor,
  brandText,
  campaignText,
  changeLogoNote,
  cleanInstruction,
  fillTemplate,
  formatNote,
  logoNote,
  referenceNotes,
  type LogoCorner,
  type PictureFormat
} from '../lib/postPicture';
import { addDraft, deleteUnusedPictures, newId } from './posts';
import { composePicture } from '../lib/pictureCompose';

/**
 * A post's picture with AI (Post v2, docs/POST_V2_PLAN.md):
 * - Create image: from "What's this post about?", the brand, the campaign and the reference pictures
 * - Change image: edits one picture following a sentence, keeping the rest
 * Both add a draft (shown next to the current picture) and never replace the picture by themselves.
 * The real logo file is stamped on afterwards (never drawn by the AI). Saved as JPEG.
 */

type Id = mongoose.Types.ObjectId;

const MAX_PICTURE_BYTES = 25 * 1024 * 1024;

/** Reads a picture: from our own storage directly (works for private files), else over the web. */
export async function loadPicture(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const key = objectKeyFromUrl(url);
  if (key) {
    const buffer = await getObjectBuffer(key, MAX_PICTURE_BYTES);
    return { buffer, contentType: contentTypeOf(buffer) };
  }
  const { buffer, contentType } = await downloadImageFromUrl(url);
  return { buffer, contentType };
}

function contentTypeOf(buffer: Buffer): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.slice(0, 3).toString() === 'GIF') return 'image/gif';
  return 'image/png';
}

/** The image AI only takes PNG, JPEG and WebP (and at most ~50 MB): anything else is converted. */
async function forAI(url: string, name: string): Promise<{ buffer: Buffer; name: string; contentType: string }> {
  const { buffer, contentType } = await loadPicture(url);
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  const tooBig = (meta.width || 0) > 2048 || (meta.height || 0) > 2048;
  if (/^image\/(png|jpeg|webp)$/.test(contentType) && !tooBig && buffer.length < 20 * 1024 * 1024) return { buffer, name, contentType };
  const png = await sharp(buffer, { failOn: 'none' }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  return { buffer: png, name: `${name}.png`, contentType: 'image/png' };
}

/** Trims to the exact shape, stamps the logo, and saves as JPEG. Returns the new address. */
async function finishAndStore(raw: Buffer, target: { width: number; height: number }, logo: { corner: LogoCorner; url: string } | null): Promise<string> {
  const stamp = logo ? { buffer: (await loadPicture(logo.url)).buffer, corner: logo.corner } : null;
  const jpeg = await composePicture(raw, target, stamp);
  return uploadBufferToS3(jpeg, 'image/jpeg', 'post-pictures');
}

/** The brand of the account the post belongs to, and its campaign (if any). */
async function pictureContext(task: ITask) {
  const [owner, campaign] = await Promise.all([
    User.findById(task.ownerId).select('companyInfo'),
    task.campaignId ? Campaign.findById(task.campaignId) : Promise.resolve(null)
  ]);
  return { companyInfo: owner?.companyInfo || null, campaign };
}

async function logoFor(task: ITask, corner: LogoCorner | null): Promise<{ corner: LogoCorner; url: string } | null> {
  if (!corner) return null;
  const owner = await User.findById(task.ownerId).select('companyInfo.primaryLogoUrl');
  const url = owner?.companyInfo?.primaryLogoUrl;
  if (!url) throw new AIError(400, 'Add your logo in Settings › Brand first, or untick “Add my logo”.');
  return { corner, url };
}

/** The admin's own command (Settings › Prompts), if one is set up. */
async function commandMapping(command: string): Promise<any | null> {
  const mapping = await CommandMapping.findOne({ command }).populate('promptId').populate('chainId').populate('steps.promptId');
  return mapping && (mapping.promptId || mapping.chainId || (mapping.steps && mapping.steps.length > 0)) ? mapping : null;
}

export interface CreateOptions {
  description?: string;
  format: PictureFormat;
  logo: LogoCorner | null;
  userId: Id;
}

/** Create image: adds a new draft to the post (not saved here) and returns it. */
export async function createPicture(task: ITask, options: CreateOptions): Promise<{ draft: PostAIDraft; dropped: string[] }> {
  const brief = (options.description ?? task.description ?? '').trim();
  if (!brief && !(task.content || '').trim()) {
    throw new AIError(400, 'Say what the post is about first (“What’s this post about?”), so the AI knows what to make.');
  }
  const refs = (task.references || []).slice(0, 6);
  const size = FORMAT_SIZES[options.format];
  const [{ companyInfo, campaign }, logo] = await Promise.all([pictureContext(task), logoFor(task, options.logo)]);

  const notes = referenceNotes(refs.map((r) => ({ role: r.role, name: r.name }))) || 'None.';
  const mapping = await commandMapping('generate-poster');
  let raw: Buffer;
  if (mapping) {
    // The admin's own "generate-poster" prompt or chain. It can use {brief}, {references},
    // {format} and {logoNote}; the reference pictures are always sent, in order.
    const data: Record<string, unknown> = {
      taskDescription: brief || (task.content || ''),
      taskName: task.name,
      taskContent: task.content || '',
      ...(companyInfo ? { companyInfo } : {}),
      ...(campaign ? { campaignDetails: campaign } : {}),
      references: notes,
      format: formatNote(options.format),
      logoNote: logoNote(options.logo),
      __extraImages: refs.map((r) => r.url),
      __size: size.api
    };
    refs.forEach((r, i) => (data[`attachedImage${i + 1}`] = r.url));
    const result = await executeCommandChain(mapping, data as any, { userId: options.userId });
    if (!result.imageUrl) throw new AIError(502, 'The image AI didn’t return a picture. Try again.');
    raw = (await loadPicture(result.imageUrl)).buffer;
    const key = objectKeyFromUrl(result.imageUrl);
    if (key) void deleteFromS3(key).catch(() => undefined); // the in-between PNG: the JPEG below is kept
  } else {
    const prompt = fillTemplate(BUILTIN_CREATE_IMAGE, {
      brief: brief || 'See the caption.',
      caption: (task.content || '').trim() || 'None yet.',
      brand: brandText(companyInfo as any),
      campaign: campaignText(campaign as any),
      references: notes,
      format: formatNote(options.format),
      logoNote: logoNote(options.logo)
    });
    const images = await Promise.all(refs.map((r, i) => forAI(r.url, r.name || `reference-${i + 1}`)));
    raw = await renderImage({
      prompt,
      images,
      size: size.api,
      fidelity: refs.some((r) => r.role === 'include') ? 'high' : undefined,
      userId: options.userId,
      promptName: 'Create image'
    });
  }

  const url = await finishAndStore(raw, size, logo);
  const draft: PostAIDraft = { id: newId(), url, kind: 'create', prompt: brief.slice(0, 4000), size: options.format, at: new Date() };
  const dropped = addDraft(task, draft);
  return { draft, dropped };
}

export interface ChangeOptions {
  instruction: string;
  /** The picture to change (the current picture, a draft or an earlier picture). */
  from: string;
  logo: LogoCorner | null;
  userId: Id;
}

/** Change image: edits `from` following the instruction; adds a draft (not saved here). */
export async function changePicture(task: ITask, options: ChangeOptions): Promise<{ draft: PostAIDraft; dropped: string[] }> {
  const instruction = cleanInstruction(options.instruction);
  if (!instruction) throw new AIError(400, 'Say what to change, for example “make the background a sunset”.');
  const known = [task.designedImage, ...(task.aiDrafts || []).map((d) => d.url), ...(task.imageHistory || []).map((h) => h.url)].filter(Boolean);
  if (!known.includes(options.from)) throw new AIError(400, 'Pick one of this post’s pictures to change.');

  const source = await forAI(options.from, 'picture');
  const meta = await sharp(source.buffer, { failOn: 'none' }).metadata();
  const width = meta.width || 1024;
  const height = meta.height || 1024;
  const logo = await logoFor(task, options.logo);

  // An admin's own "change-image" prompt (a single prompt) replaces the built-in words.
  const mapping = await commandMapping('change-image');
  const adminWords: unknown = mapping?.promptId?.details;
  const prompt = (
    typeof adminWords === 'string' && adminWords.trim()
      ? compileSuperPrompt(adminWords, { instruction, logoNote: changeLogoNote(options.logo), taskName: task.name, taskDescription: task.description || '' } as any)
      : fillTemplate(BUILTIN_CHANGE_IMAGE, { instruction, logoNote: changeLogoNote(options.logo) })
  ).trim();
  const raw = await renderImage({ prompt, images: [source], size: apiSizeFor(width, height), fidelity: 'high', purpose: 'edit', userId: options.userId, promptName: 'Change image' });

  // Same shape as the picture that was changed (at most 1536 on the long side).
  const scale = Math.min(1, 1536 / Math.max(width, height));
  const target = { width: Math.round(width * scale), height: Math.round(height * scale) };
  const url = await finishAndStore(raw, target, logo);
  const draft: PostAIDraft = { id: newId(), url, kind: 'change', prompt: instruction, from: options.from, size: `${target.width}x${target.height}`, at: new Date() };
  const dropped = addDraft(task, draft);
  return { draft, dropped };
}

/** Deletes pictures that fell off a post's lists (after the post was saved). */
export function tidyPictures(urls: string[]): void {
  if (urls.length) void deleteUnusedPictures(urls);
}
