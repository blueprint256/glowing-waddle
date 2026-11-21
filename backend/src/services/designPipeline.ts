import sharp from 'sharp';
import mongoose from 'mongoose';
import { Task, type ITask, type PostAIDraft } from '../models/Task';
import { Campaign } from '../models/Campaign';
import { LLMUsage } from '../models/LLMUsage';
import { LibraryVersion } from '../models/LibraryVersion';
import { LibraryAsset } from '../models/LibraryAsset';
import type { IDesignJob, DesignJobStage } from '../models/DesignJob';
import { DesignJob } from '../models/DesignJob';
import { getProviderKey, renderImage } from './llmService';
import { loadPicture } from './postPicture';
import { addDraft, deleteUnusedPictures, newId } from './posts';
import { DESIGN_USAGE_LABEL } from './aiAllowance';
import { brandVoice, engineKit, loadBrandKit, sponsorFromPartner, upgradeKitLogos } from './designBrand';
import { allDesigns } from './designLibrary';
import { objectKeyFromUrl, uploadBufferToS3 } from '../utils/s3Service';
import { renderDesign, type RenderResult } from '../design/renderer';
import { FORMATS, imageSizeForArea, isFormatId } from '../design/formats';
import { findFocal, photoStats } from '../design/assets';
import { cutout } from './cutout';
import { callClaudeTool, DESIGN_MODELS, type ClaudeImage } from '../design/claude';
import { DIRECTOR_SYSTEM, DIRECTOR_TOOL, brandText, catalogText, directorPrompt, plannedDocs, planWithoutAI, type DirectorInput, type DirectorPlan, type PlannedOption } from '../design/director';
import { conceptTemplate, repairBlueprint } from '../design/concept';
import { CRITIC_SYSTEM, CRITIC_TOOL, applyRanking, type CriticRanking } from '../design/critic';
import { checkScore, editableAreas, hasErrors } from '../design/checks';
import { normalizeParams, roomierSettings } from '../design/template';
import type { BackgroundSlot, BrandKit, DesignDoc, DesignTemplate, FormatId, PhotoSlot, SponsorSlot } from '../design/types';

/**
 * Making a poster (docs/DESIGN_ENGINE.md): read the material, let the art director plan, paint a
 * background only if an option needs one, render every option, check it in code, fix what can be
 * fixed (shorter words, other settings), let the critic rank what's left, and save the options as
 * the post's drafts. About one to three minutes.
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

/** The illustration for the options that use one (only the background, never words or logos). */
export async function makeBackground(prompt: string, kit: BrandKit, design: DesignTemplate, format: FormatId, userId: Id): Promise<BackgroundSlot> {
  const f = FORMATS[format];
  const area = design.backgroundArea || { w: 1, h: 0.55 };
  const size = imageSizeForArea(f.width * area.w, f.height * area.h);
  const full = [
    prompt.trim(),
    `Palette guided by these brand colours: ${kit.colors.primary.hex}, ${kit.colors.secondary.hex}, ${kit.colors.accent.hex}, with warm natural light.`,
    design.backgroundBrief || '',
    'Absolutely no text, letters, numbers, signs, logos, flags, watermarks, borders or frames anywhere in the picture.'
  ]
    .filter(Boolean)
    .join('\n');
  const raw = await renderImage({ prompt: full, size, purpose: 'create', userId, promptName: 'Design · background' });
  const jpeg = await sharp(raw).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const meta = await sharp(jpeg).metadata();
  const url = await uploadBufferToS3(jpeg, 'image/jpeg', 'design-backgrounds');
  return { url, width: meta.width || 1024, height: meta.height || 1024, prompt: prompt.trim().slice(0, 1500) };
}

interface Rendered {
  option: PlannedOption;
  result: RenderResult;
}

async function renderOption(option: PlannedOption, kit: BrandKit): Promise<Rendered> {
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

/** Settings that make room for words, or light behind them, when the checks fail. */
function roomierParams(option: PlannedOption): Record<string, number | string | boolean> | null {
  return roomierSettings(option.design, option.doc.params);
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
      // The poster is still made, with the designs that need no photo.
      console.error('[design] AI photo failed:', error?.message);
      photoNote = 'The AI photo couldn’t be made, so these designs use no photo.';
    }
  }
  const photos = await preparePhotos(job.request.photoUrls || []);
  const sponsors: SponsorSlot[] = (job.request.partnerIds || [])
    .map((id) => kitDoc.partners.find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => sponsorFromPartner(p!));
  const campaignLogoIds = (job.request.campaignLogoIds || []).filter((id) => kit.logos.some((l) => l.id === id && l.role === 'campaign'));
  let designs = await allDesigns();
  if (job.request.designIds?.length) designs = designs.filter((d) => job.request.designIds.includes(d.id));
  // The subject of each photo cut out, for designs that stand a person beside the words.
  if (designs.some((d) => d.cutout)) {
    for (const p of photos.slice(0, 3)) {
      const c = await cutout(p.buffer, (png) => uploadBufferToS3(png, 'image/png', 'design-cutouts'));
      if (c) p.slot.cutout = { url: c.url, width: c.width, height: c.height, edges: c.edges };
    }
  }
  const campaign = task.campaignId ? await Campaign.findById(task.campaignId).select('name description coreMessages') : null;

  const input: DirectorInput = {
    brief: job.request.brief || task.description || '',
    caption: task.content || '',
    campaign: campaign ? { name: campaign.name, description: (campaign as any).description, coreMessages: (campaign as any).coreMessages } : null,
    kit,
    format,
    photos: photos.map((p) => ({ slot: p.slot, description: p.description, brightness: p.brightness })),
    sponsors,
    campaignLogoIds,
    designs,
    voice: await brandVoice(job.ownerId),
    count: Math.max(1, Math.min(4, job.request.count || 4)),
    today: new Date()
  };

  // 2) Art direction: concept-first (the image model draws a concept, Claude reads it), or the
  // art director choosing from the design library.
  await stage(job, 'directing', 0.15);
  const apiKey = await anthropicKey();
  let plan: DirectorPlan;
  let conceptMade: PlannedOption[] = [];
  if (apiKey && job.request.approach === 'concept') {
    const { conceptOptions } = await import('./designConcept');
    conceptMade = await conceptOptions({
      brief: input.brief,
      caption: input.caption || '',
      kit,
      format,
      photos: photos.map((p) => ({ slot: p.slot, buffer: p.buffer, description: p.description })),
      sponsors,
      campaignLogoIds,
      voice: input.voice || null,
      count: Math.min(3, input.count),
      apiKey,
      userId,
      log: (name, model, usage, c, ms, ok = true, err) => {
        cost += c;
        return logUsage(userId, name, model, usage, c, ms, ok, err);
      }
    });
    if (!conceptMade.length) console.error('[design] No concept worked; using the design library.');
  }
  if (conceptMade.length) {
    // The library plan stays as the fallback if a concept fails its checks; the readers' notes
    // (a weekday that doesn't match its date…) reach the person once.
    plan = planWithoutAI(input);
    const notes = Array.from(new Set(conceptMade.map((o) => (o.doc as any).concept?.blueprint?.message).filter(Boolean)));
    if (notes.length) plan.message = notes[0];
  } else if (apiKey) {
    const t0 = Date.now();
    try {
      const images: ClaudeImage[] = [];
      for (let i = 0; i < photos.length; i++) images.push({ ...(await thumb(photos[i].buffer, 768)), label: `Photo ${i + 1}:` });
      const res = await callClaudeTool<DirectorPlan>({
        apiKey,
        model: DESIGN_MODELS.director,
        system: DIRECTOR_SYSTEM,
        context: `${brandText(kit)}\n\nThe design catalogue:\n${catalogText(designs, format)}`,
        prompt: directorPrompt(input),
        images,
        tool: DIRECTOR_TOOL,
        maxTokens: 3000
      });
      cost += res.cost;
      await logUsage(userId, 'Design · art director', `anthropic/${res.model}`, res.usage, res.cost, Date.now() - t0);
      plan = res.input;
    } catch (error: any) {
      await logUsage(userId, 'Design · art director', `anthropic/${DESIGN_MODELS.director}`, { input: 0, output: 0 }, 0, Date.now() - t0, false, error?.message);
      console.error('[design] Art director failed, using the plain plan:', error?.message);
      plan = planWithoutAI(input);
    }
  } else {
    plan = planWithoutAI(input);
  }

  // 3) Background, only if an option uses one.
  let background: BackgroundSlot | null = null;
  const bgDesign = (plan.options || [])
    .filter((o) => o.background || !photos.length)
    .map((o) => designs.find((d) => d.id === o.design))
    .find((d) => d && d.background !== 'none');
  if (!conceptMade.length && bgDesign && (plan.background_prompt || '').trim()) {
    await stage(job, 'background', 0.3);
    try {
      background = await makeBackground(plan.background_prompt!, kit, bgDesign, format, userId);
    } catch (error: any) {
      console.error('[design] Background failed:', error?.message);
    }
  }

  let options = conceptMade.length ? conceptMade : plannedDocs(plan, input, background);
  if (!options.length) {
    // The plan named nothing usable: fall back to the designs that fit.
    options = plannedDocs(planWithoutAI(input), input, background);
  }
  if (!options.length) throw new DesignError(400, 'None of the designs fit what this poster needs (photos, sponsors or shape).');

  // 4) Render and check.
  await stage(job, 'rendering', 0.45);
  let rendered: Rendered[] = [];
  for (const o of options) rendered.push(await renderOption(o, kit));

  // 5) Fix what can be fixed. Concepts first: their layout is adjusted the way a designer would
  // (colour, a panel behind words, a smaller partner strip, a taller box), twice at most.
  await stage(job, 'checking', 0.65);
  for (let round = 0; round < 2; round++) {
    for (const r of rendered.filter((x) => (x.option.doc as any).concept && hasErrors(x.result.report.issues))) {
      const c = (r.option.doc as any).concept;
      const next = repairBlueprint(c.blueprint, r.result.report.issues);
      if (!next) continue;
      const doc = { ...JSON.parse(JSON.stringify(r.option.doc)), text: next.copy, concept: { ...c, blueprint: next } };
      const design = conceptTemplate(next, doc.designId, format);
      const again = await renderOption({ ...r.option, doc, design }, kit);
      if (checkScore(again.result.report.issues) >= checkScore(r.result.report.issues)) rendered = rendered.map((x) => (x === r ? again : x));
    }
  }
  const failing = rendered.filter((r) => hasErrors(r.result.report.issues));
  if (failing.length && apiKey && failing.some((r) => r.result.report.issues.some((i) => i.code === 'text-overflow' || i.code === 'text-small'))) {
    const changes = await shorten(failing, apiKey, userId);
    for (let i = 0; i < failing.length; i++) {
      const c = changes.get(i);
      if (!c) continue;
      const doc: DesignDoc = JSON.parse(JSON.stringify(failing[i].option.doc));
      for (const [k, v] of Object.entries(c)) if (TEXT_KEYS.includes(k) && typeof v === 'string' && v.trim()) (doc.text as any)[k] = v.trim();
      const again = await renderOption({ ...failing[i].option, doc }, kit);
      rendered = rendered.map((r) => (r === failing[i] ? again : r));
    }
  }
  for (const r of rendered.filter((x) => hasErrors(x.result.report.issues))) {
    const params = roomierParams(r.option);
    if (!params) continue;
    const again = await renderOption({ ...r.option, doc: { ...r.option.doc, params } }, kit);
    if (checkScore(again.result.report.issues) > checkScore(r.result.report.issues)) rendered = rendered.map((x) => (x === r ? again : x));
  }
  let good = rendered.filter((r) => !hasErrors(r.result.report.issues));
  // Too few clean options: try the other designs that fit, with the same words.
  const wanted = Math.min(input.count, 2);
  if (good.length < wanted) {
    const tried = new Set(rendered.map((r) => r.option.design.id));
    const spare = designs.filter((d) => !tried.has(d.id));
    const extra = plannedDocs({ ...plan, options: spare.map((d) => ({ design: d.id })) }, { ...input, designs: spare }, background);
    for (const o of extra) {
      if (good.length >= input.count) break;
      const r = await renderOption(o, kit);
      if (!hasErrors(r.result.report.issues)) good.push(r);
    }
  }
  if (!good.length) {
    const errors = rendered.flatMap((r) => r.result.report.issues.filter((i) => i.level === 'error'));
    const has = (c: string) => errors.some((e) => e.code === c);
    const hint = has('text-over-subject') || has('text-over-person')
      ? 'The photo’s people would be covered by the words in every design. Try a photo with more space beside the people, or fewer words.'
      : has('text-overflow') || has('text-small')
        ? 'The words don’t fit any design. Try saying less, or fewer sponsors.'
        : `No design passed its checks${errors[0] ? ` (${errors[0].message.replace(/\.$/, '')})` : ''}. Try fewer words, sponsors or another photo.`;
    throw new DesignError(422, hint);
  }

  // 6) Review: the critic ranks the clean options by looking at them.
  await stage(job, 'reviewing', 0.82);
  const ranking = apiKey ? await critic(good, apiKey, userId) : null;
  let ranked = applyRanking(good, ranking);
  if (ranked.some((r) => !r.reject)) ranked = ranked.filter((r) => !r.reject);
  if (!ranking) ranked.sort((a, b) => checkScore(b.item.result.report.issues) - checkScore(a.item.result.report.issues));

  // 7) Save as the post's drafts, best first.
  await stage(job, 'saving', 0.92);
  const drafts: PostAIDraft[] = [];
  for (const r of ranked) {
    const url = await uploadBufferToS3(r.item.result.file, 'image/jpeg', 'post-pictures');
    drafts.push({
      id: newId(),
      url,
      kind: 'design',
      prompt: (job.request.brief || '').slice(0, 4000),
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
  job.message = [photoNote, typeof plan.message === 'string' ? plan.message : ''].filter(Boolean).join(' ').slice(0, 600) || undefined;
  job.cost = cost;
}

export type { ITask };
