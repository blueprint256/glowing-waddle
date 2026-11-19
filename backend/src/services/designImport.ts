import crypto from 'crypto';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { DesignTemplateModel, type IDesignTemplate } from '../models/DesignTemplate';
import { getProviderKey } from './llmService';
import { invalidateDesignLibrary } from './designLibrary';
import { logUsage, DesignError } from './designPipeline';
import { deleteFromS3, objectKeyFromUrl, uploadBufferToS3 } from '../utils/s3Service';
import { BUILTIN_DESIGNS } from '../design/library';
import { callClaudeTool, DESIGN_MODELS, type ClaudeImage } from '../design/claude';
import { designFromImport, importPrompt, IMPORT_SYSTEM, IMPORT_TOOL, repairPrompt } from '../design/importer';
import { stressTest, type StressResult } from '../design/stressTest';
import { validateTemplate } from '../design/template';
import type { DesignTemplate } from '../design/types';

/**
 * The admin design library (docs/DESIGN_ENGINE.md): import a design from a reference poster, ask
 * for changes, edit its code, run the stress test, approve or retire it. Imports run in the
 * background (a few minutes); the reference image is used for the import only and never stored.
 */

type Id = mongoose.Types.ObjectId;
const REPAIR_ROUNDS = 2;
const IMPORT_TIMEOUT_MS = 6 * 60_000;
const STALE_MS = 20 * 60_000;

const tool = { name: IMPORT_TOOL.name, description: IMPORT_TOOL.description, schema: IMPORT_TOOL.schema as Record<string, unknown> };

async function anthropicKey(): Promise<string> {
  const key = await getProviderKey('anthropic').catch(() => '');
  if (!key) throw new DesignError(400, 'Importing designs needs an Anthropic key (Settings → AI).');
  return key;
}

/** A design id nobody else uses (built-in or imported). */
async function freeId(wanted: string, exceptRecord?: Id): Promise<string> {
  const base = (wanted || 'imported-design').slice(0, 52);
  for (let n = 0; n < 50; n++) {
    const id = n ? `${base}-${n + 1}` : base;
    if (BUILTIN_DESIGNS.some((d) => d.id === id)) continue;
    const taken = await DesignTemplateModel.exists({ designId: id, ...(exceptRecord ? { _id: { $ne: exceptRecord } } : {}) });
    if (!taken) return id;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

async function asImage(buf: Buffer, label: string, width = 1024): Promise<ClaudeImage> {
  const jpg = await sharp(buf, { failOn: 'none' }).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
  return { mediaType: 'image/jpeg', base64: jpg.toString('base64'), label };
}

/** One render per shape (ordinary words, six partners) for the importer to look at. */
async function renderSheet(result: StressResult): Promise<ClaudeImage[]> {
  const picks = result.cases.filter((c) => c.name === 'typical-6');
  return Promise.all(picks.map((c) => asImage(c.preview, `${c.format}${c.passed ? '' : ' (fails)'}:`, 540)));
}

async function storePreviews(record: IDesignTemplate, result: StressResult): Promise<void> {
  const old = (record.previews || []).map((p) => p.url);
  record.previews = [];
  for (const c of result.cases) {
    const url = await uploadBufferToS3(c.preview, 'image/jpeg', 'design-previews');
    record.previews.push({ format: c.format, case: c.name, url, passed: c.passed, counted: c.counted, issues: c.issues.filter((i) => i.code !== 'photo-small').map((i) => `${i.level === 'error' ? 'Error' : 'Warning'}: ${i.message}`) });
  }
  record.markModified('previews');
  for (const url of old) {
    const key = objectKeyFromUrl(url);
    if (key) await deleteFromS3(key).catch(() => undefined);
  }
}

function testSummary(result: StressResult) {
  return { at: new Date(), passed: result.passed, failed: result.failed + (result.invalid.length ? 1 : 0), problems: result.problems.slice(0, 40) };
}

/** Asks the importer for a design (first draft or a repair), keeps the record's id. */
async function askImporter(record: IDesignTemplate, userId: Id, prompt: string, images: ClaudeImage[], label: string): Promise<DesignTemplate> {
  const apiKey = await anthropicKey();
  const started = Date.now();
  try {
    const res = await callClaudeTool<any>({ apiKey, model: DESIGN_MODELS.importer, system: IMPORT_SYSTEM, prompt, images, tool, maxTokens: 24000, timeoutMs: IMPORT_TIMEOUT_MS });
    await logUsage(userId, label, `anthropic/${res.model}`, res.usage, res.cost, Date.now() - started);
    record.cost = (record.cost || 0) + res.cost;
    const design = designFromImport(res.input);
    if (typeof res.input?.notes === 'string') record.notes = res.input.notes.slice(0, 4000);
    return design;
  } catch (error: any) {
    await logUsage(userId, label, `anthropic/${DESIGN_MODELS.importer}`, { input: 0, output: 0 }, 0, Date.now() - started, false, error?.message);
    throw error;
  }
}

/** Test, and while it fails, show the importer the problems and renders (up to two repairs). */
async function testAndRepair(record: IDesignTemplate, design: DesignTemplate, userId: Id, rounds: number): Promise<{ design: DesignTemplate; result: StressResult }> {
  let current = design;
  for (let round = 0; ; round++) {
    current.id = await freeId(current.id, record._id as Id);
    record.message = round ? `Checking the corrected design (round ${round + 1})` : 'Checking the design in every shape';
    await record.save();
    const result = await stressTest(current);
    if ((!result.failed && !result.invalid.length) || round >= rounds) return { design: current, result };
    record.message = `Fixing ${result.invalid.length ? 'the design' : `${result.failed} failing case${result.failed === 1 ? '' : 's'}`}`;
    await record.save();
    const images = result.invalid.length ? [] : await renderSheet(result);
    current = await askImporter(record, userId, repairPrompt(current, result.problems), images, 'Design · import repair');
  }
}

async function finish(record: IDesignTemplate, design: DesignTemplate, result: StressResult): Promise<void> {
  record.designId = design.id;
  record.template = { ...design, source: 'imported' };
  record.markModified('template');
  record.test = testSummary(result);
  await storePreviews(record, result);
  record.status = record.status === 'live' && (result.failed || result.invalid.length) ? 'draft' : record.status === 'importing' ? 'draft' : record.status;
  record.message = undefined;
  record.error = result.invalid.length ? result.invalid.join(' ') : undefined;
  await record.save();
  invalidateDesignLibrary();
}

/** Starts an import from a reference image. Returns at once; the work runs in the background. */
export async function startImport(input: { image: Buffer; note?: string; name?: string }, userId: Id): Promise<IDesignTemplate> {
  await anthropicKey();
  const record = await DesignTemplateModel.create({
    designId: `importing-${crypto.randomBytes(5).toString('hex')}`,
    status: 'importing',
    template: {},
    sourceNote: (input.note || '').slice(0, 2000),
    message: 'Studying the reference',
    createdBy: userId
  });
  const image = await asImage(input.image, 'The reference poster:', 1400);
  void (async () => {
    try {
      const first = await askImporter(record, userId, importPrompt({ note: input.note, name: input.name }), [image], 'Design · import');
      if (input.name?.trim()) first.name = input.name.trim().slice(0, 60);
      const { design, result } = await testAndRepair(record, first, userId, REPAIR_ROUNDS);
      await finish(record, design, result);
    } catch (error: any) {
      record.status = 'failed';
      record.message = undefined;
      record.error = error?.message || 'The import failed.';
      await record.save().catch(() => undefined);
    }
  })();
  return record;
}

/** Imports that were running when the server stopped. */
export async function markStaleImports(): Promise<void> {
  await DesignTemplateModel.updateMany({ status: 'importing', updatedAt: { $lt: new Date(Date.now() - STALE_MS) } }, { $set: { status: 'failed', error: 'The import stopped (the server restarted). Try again.' }, $unset: { message: '' } });
}

export async function getRecord(id: string): Promise<IDesignTemplate> {
  const record = mongoose.isValidObjectId(id) ? await DesignTemplateModel.findById(id) : null;
  if (!record) throw new DesignError(404, 'Design not found');
  return record;
}

/** "Make the headline bigger", "add a story version": the importer revises, then the test runs. */
export async function reviseDesign(record: IDesignTemplate, request: string, userId: Id): Promise<void> {
  if (record.status === 'importing') throw new DesignError(409, 'This design is still being worked on.');
  const current = record.template as DesignTemplate;
  if (!current?.html) throw new DesignError(400, 'There’s no design to change yet.');
  const before = record.status;
  record.status = 'importing';
  record.message = 'Making the change';
  record.error = undefined;
  await record.save();
  void (async () => {
    try {
      const sheet = await stressTest(current);
      const changed = await askImporter(record, userId, repairPrompt(current, sheet.problems, request), await renderSheet(sheet), 'Design · import change');
      changed.id = current.id;
      changed.version = (current.version || 1) + 1;
      record.status = before === 'live' ? 'draft' : before === 'failed' ? 'draft' : before;
      const { design, result } = await testAndRepair(record, changed, userId, 1);
      await finish(record, design, result);
    } catch (error: any) {
      record.status = before === 'failed' ? 'failed' : 'draft';
      record.message = undefined;
      record.error = error?.message || 'The change failed.';
      await record.save().catch(() => undefined);
    }
  })();
}

/** An admin's own edit of the code or settings: checked and stress-tested now. */
export async function saveEditedDesign(record: IDesignTemplate, edited: unknown): Promise<StressResult> {
  if (record.status === 'importing') throw new DesignError(409, 'This design is still being worked on.');
  const design = designFromImport(edited);
  design.id = (record.template as DesignTemplate)?.id || design.id;
  design.version = ((record.template as DesignTemplate)?.version || 1) + 1;
  const problems = validateTemplate(design);
  if (problems.length) throw new DesignError(400, problems.join(' '));
  const result = await stressTest(design);
  if (record.status === 'live') record.status = 'draft';
  await finish(record, design, result);
  return result;
}

export async function retestDesign(record: IDesignTemplate): Promise<StressResult> {
  if (record.status === 'importing') throw new DesignError(409, 'This design is still being worked on.');
  const design = record.template as DesignTemplate;
  const result = await stressTest(design);
  await finish(record, design, result);
  return result;
}

export async function approveDesign(record: IDesignTemplate, userId: Id): Promise<void> {
  const design = record.template as DesignTemplate;
  if (!design?.html || validateTemplate(design).length) throw new DesignError(400, 'This design isn’t valid yet.');
  if (!record.test || record.test.failed || !record.test.passed) throw new DesignError(400, 'Approve a design once it passes the stress test in every shape.');
  record.status = 'live';
  record.approvedBy = userId;
  await record.save();
  invalidateDesignLibrary();
}

export async function retireDesign(record: IDesignTemplate): Promise<void> {
  record.status = 'retired';
  await record.save();
  invalidateDesignLibrary();
}

export async function deleteDesignRecord(record: IDesignTemplate): Promise<void> {
  if (record.status === 'live') throw new DesignError(400, 'Retire the design before deleting it.');
  if (record.status === 'importing') throw new DesignError(409, 'This design is still being worked on.');
  for (const p of record.previews || []) {
    const key = objectKeyFromUrl(p.url);
    if (key) await deleteFromS3(key).catch(() => undefined);
  }
  await record.deleteOne();
  invalidateDesignLibrary();
}

/** Built-in designs' stress test (renders as data URLs; kept for an hour). */
const builtinCache = new Map<string, { at: number; value: unknown }>();
export async function builtinTest(id: string) {
  const design = BUILTIN_DESIGNS.find((d) => d.id === id);
  if (!design) throw new DesignError(404, 'Design not found');
  const hit = builtinCache.get(id);
  if (hit && Date.now() - hit.at < 3600_000) return hit.value;
  const result = await stressTest(design);
  const value = {
    test: testSummary(result),
    previews: result.cases.map((c) => ({
      format: c.format,
      case: c.name,
      url: `data:image/jpeg;base64,${c.preview.toString('base64')}`,
      passed: c.passed,
      counted: c.counted,
      issues: c.issues.filter((i) => i.code !== 'photo-small').map((i) => `${i.level === 'error' ? 'Error' : 'Warning'}: ${i.message}`)
    }))
  };
  builtinCache.set(id, { at: Date.now(), value });
  return value;
}
