import mongoose from 'mongoose';
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
import { applyEdits, applyTextEdits, editPrompt, EDIT_SYSTEM, EDIT_TOOL, type EditOp } from '../design/edits';
import { callClaudeTool, DESIGN_MODELS } from '../design/claude';
import { hasErrors } from '../design/checks';
import type { DesignDoc, TextField } from '../design/types';

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
  text?: Partial<Record<TextField, string | null>>;
  /** A change described in words. */
  request?: string;
}

export interface EditAnswer {
  draft: PostAIDraft | null;
  reply: string;
  refused?: string;
}

export async function editDesign(task: ITask, ref: string, edit: EditRequest, userId: Id): Promise<EditAnswer> {
  const { design } = findDesign(task, ref);
  let doc: DesignDoc = JSON.parse(JSON.stringify(design.doc));
  const kitDoc = await loadBrandKit(task.ownerId);
  const kit = engineKit(kitDoc);
  let reply = 'Done.';
  let refused: string | undefined;

  if (edit.text && Object.keys(edit.text).length) doc = applyTextEdits(doc, edit.text);

  if (edit.request?.trim()) {
    let apiKey: string;
    try {
      apiKey = await getProviderKey('anthropic');
    } catch {
      throw new DesignError(400, 'Describing changes needs an Anthropic key (Settings › AI). You can still type on the poster.');
    }
    const current = await designById(doc.designId, { includeDrafts: true });
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
      const target = await designById(doc.designId, { includeDrafts: true });
      if (target && target.background !== 'none') doc.background = await makeBackground(applied.backgroundPrompt, kit, target, doc.format, userId);
    }
  }

  const template = await designById(doc.designId, { includeDrafts: true });
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
    size: doc.format,
    at: new Date(),
    design: { doc, issues: result.report.issues.map((i) => ({ level: i.level, code: i.code, message: i.message })), why: design.why }
  };
  addDraft(task, draft);
  return { draft, reply, refused };
}

/** A print-ready PDF (A4 or A3) of a designed poster; text stays sharp at any size. */
export async function printDesign(task: ITask, ref: string, size: 'a4' | 'a3'): Promise<string> {
  const { design } = findDesign(task, ref);
  const doc: DesignDoc = { ...JSON.parse(JSON.stringify(design.doc)), format: size };
  const template = await designById(doc.designId, { includeDrafts: true });
  if (!template) throw new DesignError(400, 'This poster’s design is no longer in the library.');
  if (!template.formats.includes(size)) throw new DesignError(400, 'This design isn’t made for print sizes.');
  const kit = engineKit(await loadBrandKit(task.ownerId));
  const result = await renderDesign(template, doc, kit, loader, { type: 'pdf' });
  if (hasErrors(result.report.issues)) throw new DesignError(422, 'The poster doesn’t fit the print size as it is. Try fewer words.');
  return uploadBufferToS3(result.file, 'application/pdf', 'post-prints');
}
