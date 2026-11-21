import sharp from 'sharp';
import mongoose from 'mongoose';
import { Task, type ITask, type PostAIDraft } from '../models/Task';
import { Campaign } from '../models/Campaign';
import { LLMUsage } from '../models/LLMUsage';
import { LibraryVersion } from '../models/LibraryVersion';
import { LibraryAsset } from '../models/LibraryAsset';
import type { IDesignJob, DesignJobStage } from '../models/DesignJob';
import { DesignJob } from '../models/DesignJob';
import { getProviderKey } from './llmService';
import { loadPicture } from './postPicture';
import { addDraft, deleteUnusedPictures, newId } from './posts';
import { DESIGN_USAGE_LABEL } from './aiAllowance';
import { brandVoice, engineKit, loadBrandKit, sponsorFromPartner, upgradeKitLogos } from './designBrand';
import { objectKeyFromUrl, uploadBufferToS3 } from '../utils/s3Service';
import { renderDesign, type RenderResult } from '../design/renderer';
import { isFormatId } from '../design/formats';
import { findFocal, photoStats } from '../design/assets';
import { callClaudeTool, DESIGN_MODELS, type ClaudeImage } from '../design/claude';
import { copyWithoutAI } from '../design/brief';
import { POSTER_ASPECT, fallbackScene, keepGutters, repairScene, sceneDoc, sceneTemplate, separateText, type SceneDoc } from '../design/scene';
import { sceneOptions, type SceneOption } from './designScene';
import { CRITIC_SYSTEM, CRITIC_TOOL, applyRanking, type CriticRanking } from '../design/critic';
import { checkScore, editableAreas, hasErrors } from '../design/checks';
import type { BrandKit, FormatId, PhotoSlot, SponsorSlot } from '../design/types';

/**
 * Making a poster (docs/DESIGN_ENGINE.md): read the material, make the options as scenes (concept
 * with the real photos → Claude's reading → layers the engine draws), render and check each, fix
 * what can be fixed, let the critic rank what's left, and save the options as the post's drafts.
 * Without AI keys (or if every concept fails), clean posters are made from the brief in code.
 */

type Id = mongoose.Types.ObjectId;

export class DesignError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const loader = async (url: string) => (await loadPicture(url)).buffer;

export async function logUsage(userId: Id, promptName: string, model: string, usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }, cost: number, ms: number, success = true, errorMessage?: string) {
  try {
    await LLMUsage.create({
      userId,
      promptName,
      llmModel: model,
      promptTokens: usage.input + (usage.cacheRead || 0) + (usage.cacheWrite || 0),
      completionTokens: usage.output,
      totalTokens: usage.input + usage.output + (usage.cacheRead || 0) + (usage.cacheWrite || 0),
      estimatedCost: cost,
      success,
      errorMessage,
      requestDuration: ms
    });
  } catch (error) {
    console.error('[design] Couldn’t log usage:', error);
  }
}

async function anthropicKey(): Promise<string | null> {
  try {
    return await getProviderKey('anthropic');
  } catch {
    return null;
  }
}

/** A small JPEG for the AI to look at. */
async function thumb(buffer: Buffer, size = 640): Promise<ClaudeImage> {
  const jpeg = await sharp(buffer, { failOn: 'none' }).rotate().resize({ width: size, height: size, fit: 'inside' }).jpeg({ quality: 78 }).toBuffer();
  return { mediaType: 'image/jpeg', base64: jpeg.toString('base64') };
}

/** What the Library knows about a photo (who or what is in it). */
async function libraryDescription(url: string): Promise<string | undefined> {
  try {
    const key = objectKeyFromUrl(url);
    if (!key) return undefined;
    const version = await LibraryVersion.findOne({ s3Key: key }).select('assetId');
    if (!version) return undefined;
    const asset = await LibraryAsset.findById(version.assetId).select('description title');
    return asset?.description || asset?.title || undefined;
  } catch {
    return undefined;
  }
}

export interface PreparedPhoto {
  slot: PhotoSlot;
  description?: string;
  brightness?: number;
  buffer: Buffer;
}

export async function preparePhotos(urls: string[]): Promise<PreparedPhoto[]> {
  const out: PreparedPhoto[] = [];
  for (const url of urls.slice(0, 6)) {
    const { buffer } = await loadPicture(url);
    const [focal, stats, description] = await Promise.all([findFocal(buffer), photoStats(buffer), libraryDescription(url)]);
    out.push({ slot: { url, width: focal.width, height: focal.height, focal: { x: focal.x, y: focal.y }, description, consent: true }, description, brightness: stats.brightness, buffer });
  }
  return out;
}

async function stage(job: IDesignJob, s: DesignJobStage, progress: number): Promise<void> {
  job.stage = s;
  job.progress = progress;
  await DesignJob.updateOne({ _id: job._id }, { $set: { stage: s, progress } });
}

interface Rendered {
  option: SceneOption;
  result: RenderResult;
}

async function renderOption(option: SceneOption, kit: BrandKit): Promise<Rendered> {
  const result = await renderDesign(option.design, option.doc, kit, loader, { type: 'jpeg', quality: 90 });
  return { option, result };
}

const SHORTEN_TOOL = {
  name: 'submit_shorter_words',
  description: 'Shorter words for the poster options that overflow.',
  schema: {
    type: 'object',
    required: ['options'],
    properties: {
      options: {
        type: 'array',
        items: {
          type: 'object',
          required: ['option'],
          properties: { option: { type: 'integer' }, changes: { type: 'object', additionalProperties: { type: 'string' } } }
        }
      }
    }
  }
};

/** Overflowing words: asks for shorter versions that keep every fact (one call for all options). */
async function shorten(failing: Rendered[], apiKey: string, userId: Id): Promise<Map<number, Record<string, string>>> {
  const started = Date.now();
  const prompt = failing
    .map((r, i) => {
      const fields = r.option.design.fields.map((f) => `${f.name}${f.max ? ` ≤${f.max}` : ''}`).join(', ');
      const problems = r.result.report.issues.filter((x) => x.code === 'text-overflow' || x.code === 'text-small').map((x) => x.message);
      return `Option ${i + 1} (${r.option.design.name}, fields: ${fields})\nWords now: ${JSON.stringify(r.option.doc.text)}\nProblems: ${problems.join(' ')}`;
    })
    .join('\n\n');
  try {
    const res = await callClaudeTool<{ options: { option: number; changes?: Record<string, string> }[] }>({
      apiKey,
      model: DESIGN_MODELS.quick,
      system:
        'You are a copy editor fitting words onto posters. For each option, rewrite only the fields that are too long so they fit: keep the meaning and every fact (dates, times, places, numbers, names) exactly; cut adjectives and repetition first; a headline should drop to 2–6 words. Return only changed fields.',
      prompt,
      tool: SHORTEN_TOOL,
      maxTokens: 1500
    });
    await logUsage(userId, 'Design · shorten', `anthropic/${res.model}`, res.usage, res.cost, Date.now() - started);
    const map = new Map<number, Record<string, string>>();
    for (const o of res.input.options || []) if (o?.changes && typeof o.changes === 'object') map.set(Number(o.option) - 1, o.changes);
    return map;
  } catch (error: any) {
    await logUsage(userId, 'Design · shorten', `anthropic/${DESIGN_MODELS.quick}`, { input: 0, output: 0 }, 0, Date.now() - started, false, error?.message);
    return new Map();
  }
}

const TEXT_KEYS = ['eyebrow', 'headline', 'subhead', 'body', 'cta', 'footnote', 'hashtag', 'sponsorsTitle'];

async function critic(rendered: Rendered[], apiKey: string, userId: Id): Promise<CriticRanking | null> {
  if (rendered.length < 2) return null;
  const started = Date.now();
  try {
    const images: ClaudeImage[] = [];
    for (let i = 0; i < rendered.length; i++) images.push({ ...(await thumb(rendered[i].result.file, 720)), label: `Option ${i + 1}:` });
    const res = await callClaudeTool<CriticRanking>({
      apiKey,
      model: DESIGN_MODELS.critic,
      system: CRITIC_SYSTEM,
      prompt: `Rank these ${rendered.length} options.`,
      images,
      tool: CRITIC_TOOL,
      maxTokens: 1200
    });
    await logUsage(userId, 'Design · review', `anthropic/${res.model}`, res.usage, res.cost, Date.now() - started);
    return res.input;
  } catch (error: any) {
    await logUsage(userId, 'Design · review', `anthropic/${DESIGN_MODELS.critic}`, { input: 0, output: 0 }, 0, Date.now() - started, false, error?.message);
    return null;
  }
}

export async function runDesignJob(job: IDesignJob): Promise<void> {
  const userId = job.userId as Id;
  const started = Date.now();
  let cost = 0;

  // 1) Material.
  await stage(job, 'reading', 0.05);
  const task = await Task.findById(job.taskId);
  if (!task) throw new DesignError(404, 'The post was deleted.');
  const kitDoc = await loadBrandKit(job.ownerId);
  await upgradeKitLogos(kitDoc);
  const kit = engineKit(kitDoc);
  if (!kit.logos.some((l) => l.role === 'primary')) throw new DesignError(400, 'Add your logo in Settings › Brand first: every poster carries it.');
  const format: FormatId = isFormatId(job.request.format) ? job.request.format : 'portrait';
  let photoNote = '';
  // No photo given and the person asked for one: the image AI makes a real photo first.
  if (job.request.aiPhoto && !(job.request.photoUrls || []).length) {
    await stage(job, 'photo', 0.08);
    try {
      const { photoForPoster } = await import('./postPicture');
      const url = await photoForPoster(task, { format, userId, brief: job.request.brief });
      await task.save();
      job.request.photoUrls = [url];
      job.markModified('request');
      await job.save();
    } catch (error: any) {
      console.error('[design] AI photo failed:', error?.message);
      photoNote = 'The AI photo couldn’t be made, so these posters use no photo.';
    }
  }
  const photos = await preparePhotos(job.request.photoUrls || []);
  const sponsors: SponsorSlot[] = (job.request.partnerIds || [])
    .map((id) => kitDoc.partners.find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => sponsorFromPartner(p!));
  const campaignLogoIds = (job.request.campaignLogoIds || []).filter((id) => kit.logos.some((l) => l.id === id && l.role === 'campaign'));
  const campaign = task.campaignId ? await Campaign.findById(task.campaignId).select('name') : null;
  const brief = job.request.brief || task.description || '';
  const count = Math.max(1, Math.min(4, job.request.count || 4));
  const voice = await brandVoice(job.ownerId);
  const primary = kit.logos.find((l) => l.role === 'primary');

  // 2) Concepts read into scenes (design/scene.ts), side by side.
  await stage(job, 'directing', 0.15);
  const apiKey = await anthropicKey();
  let options: SceneOption[] = [];
  if (apiKey) {
    options = await sceneOptions({
      brief,
      caption: task.content || '',
      kit,
      format,
      photos: photos.map((p) => ({ slot: p.slot, buffer: p.buffer, description: p.description })),
      sponsors,
      campaignLogoIds,
      voice,
      count: Math.min(3, count),
      apiKey,
      userId,
      today: new Date(),
      log: (name, model, usage, c, ms, ok = true, err) => {
        cost += c;
        return logUsage(userId, name, model, usage, c, ms, ok, err);
      }
    });
    if (!options.length) console.error('[design] No concept worked; using the plain posters.');
  }
  const notes = Array.from(new Set(options.map((o) => o.doc.scene.message).filter(Boolean)));
  // Posters from code (no AI, or every concept failed): the brief's words on a clean layout.
  const fallbacks = (n: number, start = 0): SceneOption[] => {
    const copy = copyWithoutAI(brief, campaign?.name);
    return Array.from({ length: n }, (_, i) => {
      const scene = fallbackScene({ copy, photos: photos.map((p) => p.slot), partners: sponsors.length, aspect: POSTER_ASPECT[format] || 0.8, variant: start + i });
      const id = `scene-plain${start + i}-${Date.now().toString(36)}`;
      const doc = sceneDoc({ id, format, scene, photos: photos.map((p) => p.slot), sponsors, primaryLogo: primary?.id || '', campaignLogos: campaignLogoIds });
      return { doc, design: sceneTemplate(scene, id, format, doc.photos), why: 'A clean layout from your brief' };
    });
  };
  if (!options.length) options = fallbacks(Math.min(2, count));

  // 3) Render and check.
  await stage(job, 'rendering', 0.6);
  let rendered: Rendered[] = [];
  for (const o of options) rendered.push(await renderOption(o, kit));

  // 4) Fix what can be fixed, the way a designer would (colour, a panel behind words, a smaller
  // partner strip, a taller box, a photo shown less zoomed), twice at most; then shorter words.
  await stage(job, 'checking', 0.72);
  const photoInfo = (o: SceneOption) => o.doc.photos;
  for (let round = 0; round < 2; round++) {
    for (const r of rendered.filter((x) => hasErrors(x.result.report.issues))) {
      const next = repairScene(r.option.doc.scene, r.result.report.issues, photoInfo(r.option));
      if (!next) continue;
      separateText(next);
      keepGutters(next);
      const doc: SceneDoc = { ...JSON.parse(JSON.stringify(r.option.doc)), text: next.copy, scene: next };
      const again = await renderOption({ ...r.option, doc, design: sceneTemplate(next, doc.designId, format, doc.photos) }, kit);
      if (checkScore(again.result.report.issues) >= checkScore(r.result.report.issues)) rendered = rendered.map((x) => (x === r ? again : x));
    }
  }
  const failing = rendered.filter((r) => hasErrors(r.result.report.issues));
  if (failing.length && apiKey && failing.some((r) => r.result.report.issues.some((i) => i.code === 'text-overflow' || i.code === 'text-small'))) {
    const changes = await shorten(failing, apiKey, userId);
    for (let i = 0; i < failing.length; i++) {
      const c = changes.get(i);
      if (!c) continue;
      const doc: SceneDoc = JSON.parse(JSON.stringify(failing[i].option.doc));
      for (const [k, v] of Object.entries(c)) {
        if (!TEXT_KEYS.includes(k) || typeof v !== 'string' || !v.trim()) continue;
        (doc.text as any)[k] = v.trim();
        (doc.scene.copy as any)[k] = v.trim();
      }
      const again = await renderOption({ ...failing[i].option, doc }, kit);
      rendered = rendered.map((r) => (r === failing[i] ? again : r));
    }
  }
  // What still fails is kept in the AI usage log (render, concept, what failed), so it can be fixed.
  for (const r of rendered.filter((x) => hasErrors(x.result.report.issues) && x.option.conceptUrl)) {
    const renderUrl = await uploadBufferToS3(r.result.file, r.result.contentType || 'image/jpeg', 'design-backgrounds').catch(() => '');
    const errs = r.result.report.issues.filter((i) => i.level === 'error').map((i) => `${i.code}${i.key ? `(${i.key})` : ''}: ${i.message}`);
    await logUsage(userId, 'Design · scene checks', 'design/checks', { input: 0, output: 0 }, 0, 0, false, `${errs.join(' | ')} · render: ${renderUrl} · concept: ${r.option.conceptUrl}`.slice(0, 1900));
  }
  let good = rendered.filter((r) => !hasErrors(r.result.report.issues));
  // Too few clean posters: plain ones from code make up the number.
  const wanted = Math.min(count, 2);
  if (good.length < wanted) {
    for (const o of fallbacks(wanted - good.length, good.length)) {
      const r = await renderOption(o, kit);
      if (!hasErrors(r.result.report.issues)) good.push(r);
    }
  }
  if (!good.length) {
    const errors = rendered.flatMap((r) => r.result.report.issues.filter((i) => i.level === 'error'));
    const has = (c: string) => errors.some((e) => e.code === c);
    const hint = has('text-over-subject') || has('text-over-person')
      ? 'The words would cover the people in the photo. Try a photo with more space beside the people, or fewer words.'
      : has('text-overflow') || has('text-small')
        ? 'The words don’t fit. Try saying less, or fewer partners.'
        : `No poster passed its checks${errors[0] ? ` (${errors[0].message.replace(/\.$/, '')})` : ''}. Try fewer words, partners or another photo.`;
    throw new DesignError(422, hint);
  }

  // 5) Review: the critic ranks the clean options by looking at them.
  await stage(job, 'reviewing', 0.85);
  const ranking = apiKey ? await critic(good, apiKey, userId) : null;
  let ranked = applyRanking(good, ranking);
  if (ranked.some((r) => !r.reject)) ranked = ranked.filter((r) => !r.reject);
  if (!ranking) ranked.sort((a, b) => checkScore(b.item.result.report.issues) - checkScore(a.item.result.report.issues));

  // 6) Save as the post's drafts, best first.
  await stage(job, 'saving', 0.93);
  const drafts: PostAIDraft[] = [];
  for (const r of ranked) {
    const url = await uploadBufferToS3(r.item.result.file, 'image/jpeg', 'post-pictures');
    drafts.push({
      id: newId(),
      url,
      kind: 'design',
      prompt: brief.slice(0, 4000),
      size: format,
      at: new Date(),
      design: {
        doc: r.item.option.doc,
        issues: r.item.result.report.issues.map((i) => ({ level: i.level, code: i.code, message: i.message })),
        score: r.score,
        note: r.note,
        why: r.item.option.why,
        jobId: String(job._id),
        areas: editableAreas(r.item.result.report)
      }
    });
  }
  const fresh = await Task.findById(job.taskId);
  if (!fresh) {
    void deleteUnusedPictures(drafts.map((d) => d.url));
    throw new DesignError(404, 'The post was deleted.');
  }
  const dropped: string[] = [];
  for (const d of [...drafts].reverse()) dropped.push(...addDraft(fresh, d));
  await fresh.save();
  if (dropped.length) void deleteUnusedPictures(dropped);

  await logUsage(userId, DESIGN_USAGE_LABEL, 'design/poster', { input: 0, output: 0 }, cost, Date.now() - started);
  job.draftIds = drafts.map((d) => d.id);
  job.message = [photoNote, notes[0] || ''].filter(Boolean).join(' ').slice(0, 600) || undefined;
  job.cost = cost;
}

export type { ITask };
