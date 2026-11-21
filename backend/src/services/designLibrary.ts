import { DesignTemplateModel } from '../models/DesignTemplate';
import { BUILTIN_DESIGNS } from '../design/library';
import { validateTemplate } from '../design/template';
import type { DesignTemplate } from '../design/types';

/**
 * The design library: built-in designs plus the live designs admins have added. Imported designs
 * are re-checked when read, so a bad record can never reach the renderer.
 */

let cache: { at: number; designs: DesignTemplate[] } | null = null;
const CACHE_MS = 30_000;

export function invalidateDesignLibrary(): void {
  cache = null;
}

export async function allDesigns(options: { includeDrafts?: boolean } = {}): Promise<DesignTemplate[]> {
  if (!options.includeDrafts && cache && Date.now() - cache.at < CACHE_MS) return cache.designs;
  const rows = await DesignTemplateModel.find(options.includeDrafts ? { status: { $ne: 'retired' } } : { status: 'live' }).lean();
  const imported: DesignTemplate[] = [];
  for (const row of rows as any[]) {
    const t = { ...(row.template as DesignTemplate), id: row.designId, version: row.version, source: 'imported' as const };
    if (BUILTIN_DESIGNS.some((b) => b.id === t.id)) continue;
    if (validateTemplate(t).length) continue;
    imported.push(t);
  }
  const designs = [...BUILTIN_DESIGNS, ...imported];
  if (!options.includeDrafts) cache = { at: Date.now(), designs };
  return designs;
}

export async function designById(id: string, options: { includeDrafts?: boolean } = {}): Promise<DesignTemplate | undefined> {
  return (await allDesigns(options)).find((d) => d.id === id);
}
