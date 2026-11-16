import mongoose from 'mongoose';
import { LibraryJob, ILibraryJob } from '../models/LibraryJob';
import { LibraryAsset } from '../models/LibraryAsset';
import { LibraryVersion } from '../models/LibraryVersion';
import { User, canUseLibrary } from '../models/User';
import { Campaign } from '../models/Campaign';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { Asset } from '../models/Asset';
import { LLMUsage } from '../models/LLMUsage';
import { getProviderKey, calculateEstimatedCost } from '../services/llmService';
import { getObjectBuffer, objectKeyFromUrl, downloadImageFromUrl } from '../utils/s3Service';
import { loadLibrarySetup } from './setup';
import { buildAnalysisPrompt, parseAnalysis } from './analysis';
import { runVision, embedTexts } from './vision';
import { buildSearchText, embeddingText } from './search';
import { ingest, aiUsedThisMonth, invalidateOwner, purgeExpiredTrash } from './service';

/**
 * Background worker for the Library (runs inside the API process; MongoDB is the queue).
 * Safe to run on several servers: jobs are claimed atomically.
 */
const CONCURRENCY = Number(process.env.LIBRARY_WORKER_CONCURRENCY) || 2;
const MAX_ATTEMPTS = 3;
const POLL_MS = 2000;
let active = 0;
let started = false;

type Id = mongoose.Types.ObjectId;

class SkipAi extends Error {}

async function claimJob(): Promise<ILibraryJob | null> {
  return LibraryJob.findOneAndUpdate(
    { status: 'queued', runAfter: { $lte: new Date() } },
    { $set: { status: 'running', lockedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { runAfter: 1, createdAt: 1 }, new: true }
  );
}

async function linkNames(links: any): Promise<string[]> {
  const names: string[] = [];
  if (links?.campaignId) {
    const c = await Campaign.findById(links.campaignId).select('name');
    if (c) names.push(c.name);
  }
  if (links?.projectId) {
    const p = await Project.findById(links.projectId).select('name');
    if (p) names.push(p.name);
  }
  if (links?.taskId) {
    const t = await Task.findById(links.taskId).select('name');
    if (t) names.push(t.name);
  }
  return names;
}

/** AI reads one item and (re)builds its index entry. */
async function analyze(job: ILibraryJob): Promise<boolean> {
  const asset = await LibraryAsset.findById(job.assetId);
  if (!asset || asset.deletedAt) return false;
  const version = await LibraryVersion.findById(asset.currentVersionId);
  if (!version) return false;
  const owner = await User.findById(asset.ownerId).select('companyInfo isActive libraryEnabled');
  const setup = await loadLibrarySetup();

  let aiUsed = false;
  let skippedReason: string | undefined;
  try {
    if (!setup.enabled) throw new SkipAi('The Library is switched off');
    if (!owner || !canUseLibrary(owner)) throw new SkipAi('Library access is off for this account');
    if (!setup.provider || !setup.model) throw new SkipAi(setup.aiProblem || 'No AI model configured');
    if (setup.monthlyAiLimit > 0 && (await aiUsedThisMonth(asset.ownerId)) >= setup.monthlyAiLimit) {
      throw new SkipAi(`Monthly AI limit reached (${setup.monthlyAiLimit} items). It will be read when you re-run it next month.`);
    }

    const knownDate = ['exif', 'filename', 'user'].includes(asset.dateSource) ? asset.capturedAt.toISOString().slice(0, 10) : null;
    const image = version.aiKey ? { mediaType: 'image/jpeg', base64: (await getObjectBuffer(version.aiKey, 8 * 1024 * 1024)).toString('base64') } : undefined;
    const pdfBase64 =
      setup.provider === 'anthropic' && version.mime === 'application/pdf' && version.size <= 10 * 1024 * 1024
        ? (await getObjectBuffer(version.s3Key, 10 * 1024 * 1024)).toString('base64')
        : undefined;
    const prompt = buildAnalysisPrompt({
      fileName: version.originalName,
      folder: asset.folder,
      kind: asset.kind,
      mime: version.mime,
      knownDate,
      extractedText: asset.kind === 'image' ? '' : asset.textContent,
      companyName: owner.companyInfo?.companyName,
      hasImage: Boolean(image)
    });

    const started = Date.now();
    const apiKey = await getProviderKey(setup.provider);
    const result = await runVision({ provider: setup.provider, apiKey, model: setup.model, prompt, image, pdfBase64 });
    aiUsed = true;
    await LLMUsage.create({
      userId: asset.ownerId,
      promptName: 'Library analysis',
      llmModel: `${setup.provider}/${setup.model}`,
      promptTokens: result.usage.input,
      completionTokens: result.usage.output,
      totalTokens: result.usage.input + result.usage.output,
      estimatedCost: calculateEstimatedCost(setup.provider as any, setup.model, result.usage.input, result.usage.output),
      success: true,
      requestDuration: Date.now() - started
    }).catch(() => undefined);

    const analysis = parseAnalysis(result.text);
    if (!analysis) throw new Error('The AI reply could not be read');

    if (asset.titleSource !== 'user' && analysis.title) {
      asset.title = analysis.title;
      asset.titleSource = 'ai';
    }
    asset.category = analysis.category;
    asset.description = analysis.description;
    asset.colors = analysis.colors;
    asset.language = analysis.language;
    asset.tags = [...new Set([...(asset.tags || []), ...analysis.tags])].slice(0, 24);
    if (!asset.event && analysis.event) asset.event = analysis.event;
    if (asset.kind === 'image') asset.textContent = analysis.textInImage;
    if (['file_modified', 'upload'].includes(asset.dateSource) && analysis.contentDate) {
      asset.capturedAt = analysis.contentDate;
      asset.dateSource = 'content';
    }
    asset.aiStatus = 'done';
    asset.aiError = undefined;
  } catch (error) {
    if (error instanceof SkipAi) {
      skippedReason = error.message;
      asset.aiStatus = 'skipped';
      asset.aiError = skippedReason;
    } else if (job.attempts < MAX_ATTEMPTS) {
      throw error; // retried later
    } else {
      asset.aiStatus = 'failed';
      asset.aiError = error instanceof Error ? error.message.slice(0, 300) : 'AI analysis failed';
    }
  }

  // Index entry: always rebuilt (also without AI), including names of linked campaign/project/task.
  asset.searchText = buildSearchText({ ...asset.toObject(), originalName: version.originalName, links: await linkNames(asset.links) });
  if (aiUsed && setup.semantic) {
    try {
      const [vector] = await embedTexts(await getProviderKey('openai'), [embeddingText(asset)]);
      if (vector?.length) asset.embedding = vector;
    } catch (error) {
      console.error('[library] Embedding failed (search by meaning will skip this item):', error);
    }
  }
  await asset.save();
  invalidateOwner(asset.ownerId);
  return aiUsed;
}

function basename(url: string, fallback: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return last && /\.[a-z0-9]{2,5}$/i.test(last) ? last : fallback;
  } catch {
    return fallback;
  }
}

async function fetchFile(url: string): Promise<Buffer> {
  const key = objectKeyFromUrl(url);
  if (key) return getObjectBuffer(key, 60 * 1024 * 1024);
  const { buffer } = await downloadImageFromUrl(url);
  return buffer;
}

/** Copy a user's existing app images (task designs, attachments, logos, older assets) into their Library. */
async function importAppFiles(job: ILibraryJob) {
  const ownerId = job.ownerId as Id;
  const batchId = String(job.payload?.batchId || `app-${Date.now()}`);
  const owner = await User.findById(ownerId).select('companyInfo');
  const campaigns = await Campaign.find({ createdBy: ownerId }).select('_id');
  const tasks = await Task.find({ campaignId: { $in: campaigns.map((c) => c._id) } }).select('name designedImage attachedImages projectId campaignId');

  const items: { url: string; name: string; links?: any; event?: string }[] = [];
  for (const t of tasks) {
    const links = { campaignId: t.campaignId, projectId: t.projectId, taskId: t._id };
    if (t.designedImage) items.push({ url: t.designedImage, name: basename(t.designedImage, `${t.name}.png`), links });
    for (const u of t.attachedImages || []) items.push({ url: u, name: basename(u, `${t.name} attachment.png`), links });
  }
  const ci: any = owner?.companyInfo || {};
  for (const [field, label] of [['primaryLogoUrl', 'Primary logo'], ['secondaryLogoUrl', 'Secondary logo'], ['tertiaryLogoUrl', 'Tertiary logo']]) {
    if (ci[field]) items.push({ url: ci[field], name: basename(ci[field], `${label}.png`) });
  }
  const assets = await Asset.find({ uploadedBy: ownerId }).select('location originalName taskId projectId campaignId');
  for (const a of assets) {
    items.push({ url: a.location, name: a.originalName || basename(a.location, 'file'), links: { campaignId: a.campaignId || null, projectId: a.projectId || null, taskId: a.taskId || null } });
  }

  let imported = 0;
  for (const item of items.slice(0, 2000)) {
    try {
      const buffer = await fetchFile(item.url);
      const [res] = await ingest({
        ownerId,
        userId: ownerId,
        originalName: item.name,
        data: { buffer },
        batchId,
        source: 'app',
        links: item.links ? { campaignId: item.links.campaignId || null, projectId: item.links.projectId || null, taskId: item.links.taskId || null } : undefined,
        tags: item.links ? [] : ['logo']
      });
      if (res?.status === 'created') imported++;
    } catch (error) {
      console.error(`[library] Could not import ${item.url}:`, error instanceof Error ? error.message : error);
    }
  }
  console.log(`[library] Imported ${imported} existing app files for ${ownerId}`);
}

/** A task's new image becomes the next version of that task's Library item. */
async function addTaskImage(job: ILibraryJob) {
  const taskId = String(job.payload?.taskId || '');
  const url = String(job.payload?.url || '');
  if (!mongoose.isValidObjectId(taskId) || !url) return;
  const task = await Task.findById(taskId).select('name projectId campaignId');
  if (!task) return;
  const ownerId = job.ownerId as Id;
  const buffer = await fetchFile(url);
  const existing = await LibraryAsset.findOne({ ownerId, 'links.taskId': task._id, deletedAt: null, kind: 'image' }).sort({ updatedAt: -1 });
  const userId = mongoose.isValidObjectId(String(job.payload?.userId)) ? new mongoose.Types.ObjectId(String(job.payload!.userId)) : ownerId;
  const [res] = await ingest({
    ownerId,
    userId,
    originalName: basename(url, `${task.name}.png`),
    data: { buffer },
    source: 'task',
    note: String(job.payload?.note || ''),
    links: { campaignId: task.campaignId, projectId: task.projectId, taskId: task._id as Id },
    ...(existing ? { targetAssetId: existing._id as Id } : {})
  });
  if (res?.status === 'failed' && !/already version/.test(res.error || '')) throw new Error(res.error);
}

async function runJob(job: ILibraryJob) {
  try {
    let aiUsed = false;
    if (job.type === 'analyze') aiUsed = await analyze(job);
    else if (job.type === 'import_app') await importAppFiles(job);
    else if (job.type === 'task_image') await addTaskImage(job);
    await LibraryJob.updateOne({ _id: job._id }, { $set: { status: 'done', aiUsed, finishedAt: new Date() }, $unset: { error: 1 } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error);
    if (job.attempts < MAX_ATTEMPTS) {
      const backoff = job.attempts === 1 ? 60_000 : 5 * 60_000;
      await LibraryJob.updateOne({ _id: job._id }, { $set: { status: 'queued', runAfter: new Date(Date.now() + backoff), error: message } });
    } else {
      await LibraryJob.updateOne({ _id: job._id }, { $set: { status: 'failed', error: message, finishedAt: new Date() } });
      console.error(`[library] Job ${job.type} ${job._id} failed:`, message);
    }
  }
}

async function tick() {
  if (mongoose.connection.readyState !== 1) return;
  while (active < CONCURRENCY) {
    const job = await claimJob();
    if (!job) return;
    active++;
    runJob(job).finally(() => {
      active--;
    });
  }
}

export function startLibraryWorker() {
  if (started || process.env.LIBRARY_WORKER === 'off') return;
  started = true;
  // Jobs left "running" by a crash or restart go back in the queue.
  const recover = () =>
    LibraryJob.updateMany(
      { status: 'running', lockedAt: { $lt: new Date(Date.now() - 10 * 60_000) } },
      { $set: { status: 'queued', runAfter: new Date() } }
    ).catch(() => undefined);
  setTimeout(recover, 5000);
  setInterval(() => {
    tick().catch((e) => console.error('[library] Worker error:', e));
  }, POLL_MS);
  setInterval(() => {
    recover();
    purgeExpiredTrash().catch((e) => console.error('[library] Trash cleanup failed:', e));
  }, 60 * 60_000);
}
