import { DesignPreviewModel } from '../models/DesignPreview';
import { BUILTIN_DESIGNS } from '../design/library';
import { stressTest } from '../design/stressTest';
import { deleteFromS3, objectKeyFromUrl, uploadBufferToS3 } from '../utils/s3Service';

/**
 * Preview images for the built-in designs in Admin › Poster designs. They're made in the background
 * the first time the library is opened (and again when a design's version changes), one at a time,
 * and stored, so the library shows every design at a glance without rendering on each visit.
 */

let making: Promise<void> | null = null;

/** The stored previews for the current versions: design id → image address. */
export async function builtinPreviews(): Promise<Record<string, string>> {
  const rows = await DesignPreviewModel.find({}).lean();
  const out: Record<string, string> = {};
  for (const d of BUILTIN_DESIGNS) {
    const row = rows.find((r) => r.designId === d.id && r.version === d.version);
    if (row) out[d.id] = row.url;
  }
  if (Object.keys(out).length < BUILTIN_DESIGNS.length) void makeMissing();
  return out;
}

/** Makes the previews that are missing or out of date (one run at a time). */
export function makeMissing(): Promise<void> {
  if (making) return making;
  making = (async () => {
    try {
      const rows = await DesignPreviewModel.find({}).lean();
      for (const design of BUILTIN_DESIGNS) {
        const row = rows.find((r) => r.designId === design.id);
        if (row && row.version === design.version) continue;
        try {
          const result = await stressTest(design, { formats: ['portrait'], cases: ['typical-3'], neutral: true });
          const preview = result.cases[0]?.preview;
          if (!preview) continue;
          const url = await uploadBufferToS3(preview, 'image/jpeg', 'design-previews');
          await DesignPreviewModel.updateOne({ designId: design.id }, { $set: { version: design.version, url } }, { upsert: true });
          const oldKey = row?.url ? objectKeyFromUrl(row.url) : null;
          if (oldKey) await deleteFromS3(oldKey).catch(() => undefined);
        } catch (error: any) {
          console.error(`[design] Preview of ${design.id} failed:`, error?.message || error);
        }
      }
    } finally {
      making = null;
    }
  })();
  return making;
}
