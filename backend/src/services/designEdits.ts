import mongoose from 'mongoose';
import { templateForConceptDoc } from '../design/concept';
import { LLMUsage } from '../models/LLMUsage';
import type { ITask, PostAIDraft, PostDesign } from '../models/Task';
import { getProviderKey } from './llmService';
import { loadPicture } from './postPicture';
import { addDraft, newId } from './posts';
import { engineKit, loadBrandKit } from './designBrand';
import { allDesigns, designById } from './designLibrary';
import { DesignError, makeBackground } from './designPipeline';
import { uploadBufferToS3 } from '../utils/s3Service';
import { renderDesign } from '../design/renderer';
import { applyEdits, applyTextEdits, editPrompt, EDIT_SYSTEM, EDIT_TOOL, type EditOp, type TextEdits } from '../design/edits';
import { callClaudeTool, DESIGN_MODELS } from '../design/claude';
import { editableAreas, hasErrors } from '../design/checks';
import type { DesignDoc, FormatId, TextField } from '../design/types';
import { roomierSettings } from '../design/template';

/**
 * Changing a designed poster: typing on the poster itself (no AI), or describing the change in
 * words (a quick model turns it into operations). Either way the poster is re-rendered from its
 * document in seconds and the result is a new draft next to the original, so nothing is lost.
 */

type Id = mongoose.Types.ObjectId;

const loader = async (url: string) => (await loadPicture(url)).buffer;

/** "current" is the post's picture; anything else is a draft id. */
export function findDesign(task: ITask, ref: string): { design: PostDesign; draft?: PostAIDraft } {
  if (ref === 'current') {
    if (!task.pictureDesign?.doc) throw new DesignError(400, 'The post’s picture isn’t a designed poster.');
    return { design: task.pictureDesign };
  }
  const draft = (task.aiDrafts || []).find((d) => d.id === ref);
  if (!draft?.design?.doc) throw new DesignError(404, 'That poster option is no longer here.');
  return { design: draft.design, draft };
}

export interface EditRequest {
  /** Words typed on the poster: field → new text (empty or null removes the field). */
  text?: TextEdits;
  /** A change described in words. */
  request?: string;
  /** Quick changes from buttons (no AI): bigger headline, swap colours, another shape or design. */
  ops?: EditOp[];
}

/** The operations the app's buttons may send directly. */
const QUICK_OPS = new Set(['headline_size', 'swap_colours', 'change_format', 'switch_design', 'photo_focus', 'remove_sponsor', 'set_param']);

export interface EditAnswer {
  draft: PostAIDraft | null;
  reply: string;
  refused?: string;
}

export async function editDesign(task: ITask, ref: string, edit: EditRequest, userId: Id): Promise<EditAnswer> {
  const { design, draft: source } = findDesign(task, ref);
  let doc: DesignDoc = JSON.parse(JSON.stringify(design.doc));
  const kitDoc = await loadBrandKit(task.ownerId);
  const kit = engineKit(kitDoc);
  let reply = 'Done.';
  let refused: string | undefined;

  if (edit.text && Object.keys(edit.text).length) doc = applyTextEdits(doc, edit.text);
  if (Array.isArray(edit.ops) && edit.ops.length) {
    const quick = applyEdits(doc, edit.ops.filter((o: any) => o && QUICK_OPS.has(o.op)).slice(0, 10), await allDesigns({ includeDrafts: true }));
    if (!quick.changed.length && !edit.text && !edit.request) return { draft: null, reply: 'That change isn’t possible with this design.' };
    doc = quick.doc;
  }

  if (edit.request?.trim()) {
    let apiKey: string;
    try {
      apiKey = await getProviderKey('anthropic');
    } catch {
      throw new DesignError(400, 'Describing changes needs an Anthropic key (Settings › AI). You can still type on the poster.');
    }
    const current = await designFor(doc);
    if (!current) throw new DesignError(400, 'This poster’s design is no longer in the library.');
    const designs = await allDesigns();
    const started = Date.now();
    const res = await callClaudeTool<{ ops: EditOp[]; reply: string }>({
      apiKey,
      model: DESIGN_MODELS.quick,
      system: EDIT_SYSTEM,
      prompt: editPrompt(doc, current, designs, edit.request.slice(0, 1500), kit.rules.filter((r) => r.hard).map((r) => r.text)),
      tool: EDIT_TOOL,
      maxTokens: 1200
    });
    await LLMUsage.create({
      userId,
      promptName: 'Design · change',
      llmModel: `anthropic/${res.model}`,
      promptTokens: res.usage.input + res.usage.cacheRead + res.usage.cacheWrite,
      completionTokens: res.usage.output,
      totalTokens: res.usage.input + res.usage.output,
      estimatedCost: res.cost,
      success: true,
      requestDuration: Date.now() - started
    }).catch(() => undefined);
    const applied = applyEdits(doc, res.input.ops || [], designs);
    reply = typeof res.input.reply === 'string' && res.input.reply.trim() ? res.input.reply.trim().slice(0, 300) : reply;
    refused = applied.refused;
    if (!applied.changed.length) return { draft: null, reply: refused || reply, refused };
    doc = applied.doc;
    if (applied.backgroundPrompt) {
      const target = await designFor(doc);
      if (target && target.background !== 'none') doc.background = await makeBackground(applied.backgroundPrompt, kit, target, doc.format, userId);
    }
  }

  const template = await designFor(doc);
  if (!template) throw new DesignError(400, 'This poster’s design is no longer in the library.');
  const result = await renderDesign(template, doc, kit, loader, { type: 'jpeg', quality: 90 });
  if (hasErrors(result.report.issues)) {
    const first = result.report.issues.find((i) => i.level === 'error')!;
    throw new DesignError(422, `${first.message} Try fewer words or another change.`);
  }
  const url = await uploadBufferToS3(result.file, 'image/jpeg', 'post-pictures');
  const draft: PostAIDraft = {
    id: newId(),
    url,
    kind: 'design',
    prompt: (edit.request || 'Edited on the poster').slice(0, 4000),
    from: source ? source.url : task.designedImage || undefined,
    size: doc.format,
    at: new Date(),
    design: { doc, issues: result.report.issues.map((i) => ({ level: i.level, code: i.code, message: i.message })), why: design.why, areas: editableAreas(result.report) }
  };
  addDraft(task, draft);
  return { draft, reply, refused };
}

/** A print-ready PDF (A4 or A3) of a designed poster; text stays sharp at any size. */
/** The design a poster renders with: its concept blueprint, or the library design it names. */
async function designFor(doc: DesignDoc) {
  return templateForConceptDoc(doc) || (await designById(doc.designId, { includeDrafts: true }));
}

export async function printDesign(task: ITask, ref: string, size: 'a4' | 'a3'): Promise<string> {
  const { design } = findDesign(task, ref);
  const doc: DesignDoc = { ...JSON.parse(JSON.stringify(design.doc)), format: size };
  const template = await designFor(doc);
  if (!template) throw new DesignError(400, 'This poster’s design is no longer in the library.');
  if (!template.formats.includes(size)) throw new DesignError(400, 'This design isn’t made for print sizes.');
  const kit = engineKit(await loadBrandKit(task.ownerId));
  const result = await renderDesign(template, doc, kit, loader, { type: 'pdf' });
  if (hasErrors(result.report.issues)) throw new DesignError(422, 'The poster doesn’t fit the print size as it is. Try fewer words.');
  return uploadBufferToS3(result.file, 'application/pdf', 'post-prints');
}

/** The same poster in every other social shape its design has (feed, story, landscape), each
 *  checked; shapes the words don't fit are skipped with the reason. Not drafts: files to download. */
export async function exportSizes(task: ITask, ref: string): Promise<{ sizes: { format: FormatId; url: string }[]; skipped: { format: FormatId; reason: string }[] }> {
  const { design } = findDesign(task, ref);
  const template = await designFor(design.doc);
  if (!template) throw new DesignError(400, 'This poster’s design is no longer in the library.');
  const kit = engineKit(await loadBrandKit(task.ownerId));
  const cached: Record<string, string> = (design as any).sizes || {};
  const sizes: { format: FormatId; url: string }[] = [];
  const skipped: { format: FormatId; reason: string }[] = [];
  for (const format of (['square', 'portrait', 'story', 'landscape'] as FormatId[]).filter((f) => template.formats.includes(f))) {
    if (format === design.doc.format) continue;
    if (cached[format]) {
      sizes.push({ format, url: cached[format] });
      continue;
    }
    let doc: DesignDoc = { ...JSON.parse(JSON.stringify(design.doc)), format };
    let result = await renderDesign(template, doc, kit, loader, { type: 'jpeg' });
    if (hasErrors(result.report.issues)) {
      const params = roomierSettings(template, doc.params);
      if (params) {
        doc = { ...doc, params };
        result = await renderDesign(template, doc, kit, loader, { type: 'jpeg' });
      }
    }
    const errors = result.report.issues.filter((i) => i.level === 'error');
    if (errors.length) {
      skipped.push({ format, reason: errors[0].message });
      continue;
    }
    const url = await uploadBufferToS3(result.file, 'image/jpeg', 'post-prints');
    cached[format] = url;
    sizes.push({ format, url });
  }
  (design as any).sizes = cached;
  return { sizes, skipped };
}
