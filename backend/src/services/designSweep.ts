import { Task } from '../models/Task';
import { CutoutCache } from './cutout';
import { deleteFromS3, listObjects, objectKeyFromUrl } from '../utils/s3Service';
import { designFileUrls } from '../design/files';

/**
 * Files posters make besides the poster itself: AI backgrounds, cut-out people, print PDFs. A
 * poster's own picture is deleted when its draft goes (posts.deleteUnusedPictures); these are
 * swept once a day: anything in their folders older than a week that no poster refers to any more
 * (as a draft, the post's picture or an earlier picture) is deleted. Cut-outs stay as long as a
 * poster uses them, and for 30 days after they were made so the same photo isn't cut out twice.
 */

const FOLDERS = ['design-backgrounds/', 'design-cutouts/', 'post-prints/'];
const GRACE_MS = 7 * 24 * 3600_000;
const CUTOUT_KEEP_MS = 30 * 24 * 3600_000;

/** The storage keys of every side file a poster refers to. */
function filesOf(design: any, keys: Set<string>) {
  for (const url of designFileUrls(design, new Set())) {
    const key = objectKeyFromUrl(url);
    if (key) keys.add(key);
  }
}

export async function referencedDesignFiles(): Promise<Set<string>> {
  const keys = new Set<string>();
  const cursor = Task.find(
    { $or: [{ 'aiDrafts.kind': 'design' }, { pictureDesign: { $ne: null } }, { 'imageHistory.design': { $exists: true } }] },
    { 'aiDrafts.design': 1, pictureDesign: 1, 'imageHistory.design': 1 }
  )
    .lean()
    .cursor();
  for await (const t of cursor as any) {
    for (const d of t.aiDrafts || []) if (d?.design) filesOf(d.design, keys);
    if (t.pictureDesign) filesOf(t.pictureDesign, keys);
    for (const h of t.imageHistory || []) if (h?.design) filesOf(h.design, keys);
  }
  return keys;
}

export async function sweepDesignFiles(now = Date.now()): Promise<{ deleted: number; kept: number }> {
  const used = await referencedDesignFiles();
  // Cut-outs: the cache entry goes with its file once nothing uses it and it's past its keep time.
  const recentCutouts = new Set<string>();
  for (const c of await CutoutCache.find({ url: { $ne: null } }, { url: 1, createdAt: 1 }).lean()) {
    const key = c.url ? objectKeyFromUrl(c.url) : null;
    if (!key) continue;
    if (used.has(key) || now - new Date(c.createdAt).getTime() < CUTOUT_KEEP_MS) recentCutouts.add(key);
    else await CutoutCache.deleteOne({ _id: (c as any)._id });
  }
  let deleted = 0;
  let kept = 0;
  for (const folder of FOLDERS) {
    for await (const o of listObjects(folder)) {
      if (used.has(o.key) || recentCutouts.has(o.key) || now - o.lastModified.getTime() < GRACE_MS) {
        kept++;
        continue;
      }
      try {
        await deleteFromS3(o.key);
        deleted++;
      } catch (error) {
        console.error('[design] Couldn’t delete an unused poster file:', o.key, error);
      }
    }
  }
  return { deleted, kept };
}
