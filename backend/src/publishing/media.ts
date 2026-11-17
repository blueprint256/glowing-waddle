import mongoose from 'mongoose';
import sharp from 'sharp';
import { LibraryVersion } from '../models/LibraryVersion';
import { LibraryAsset } from '../models/LibraryAsset';
import { PostMedia } from '../models/SocialPost';
import { objectKeyFromUrl, headObjectInfo, getObjectRange, signedObjectUrl, putPrivateObject, downloadImageFromUrl } from '../utils/s3Service';
import { MediaFile, PublishError } from './types';

/**
 * Turns the pictures/videos chosen for a post into MediaFiles adapters can read. Files are read in
 * byte ranges straight from storage, so a 1 GB video never sits in the server's memory.
 */

type Id = mongoose.Types.ObjectId;

function kindOfMime(mime: string): 'image' | 'video' | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

// The publish form re-checks a post as the user types; remember file details for a few minutes so
// pictures aren't downloaded again on every check.
const describeCache = new Map<string, { at: number; value: PostMedia }>();

/** Fill in type/size/dimensions for a chosen media item (used for validation before scheduling). */
export async function describeMedia(ownerId: Id, ref: { source: 'url' | 'library'; url?: string; assetId?: string; versionId?: string }): Promise<PostMedia> {
  const key = `${ownerId}|${ref.source}|${ref.url || ''}|${ref.assetId || ''}|${ref.versionId || ''}`;
  const hit = describeCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return { ...hit.value };
  const value = await describeMediaUncached(ownerId, ref);
  if (describeCache.size > 500) describeCache.clear();
  describeCache.set(key, { at: Date.now(), value });
  return { ...value };
}

async function describeMediaUncached(ownerId: Id, ref: { source: 'url' | 'library'; url?: string; assetId?: string; versionId?: string }): Promise<PostMedia> {
  if (ref.source === 'library') {
    if (!mongoose.isValidObjectId(ref.assetId)) throw new PublishError('Unknown Library item');
    const asset = await LibraryAsset.findOne({ _id: ref.assetId, ownerId, deletedAt: null }).select('currentVersionId title');
    if (!asset) throw new PublishError('That Library item no longer exists');
    const versionId = ref.versionId && mongoose.isValidObjectId(ref.versionId) ? ref.versionId : asset.currentVersionId;
    const v = await LibraryVersion.findOne({ _id: versionId, assetId: asset._id });
    if (!v) throw new PublishError('That version no longer exists');
    const kind = kindOfMime(v.mime);
    if (!kind) throw new PublishError(`"${v.originalName}" is not a picture or video`);
    return { kind, source: 'library', assetId: asset._id as Id, versionId: v._id as Id, mime: v.mime, size: v.size, width: v.width, height: v.height, name: v.originalName };
  }
  const url = (ref.url || '').trim();
  if (!/^https:\/\//i.test(url)) throw new PublishError('Pictures must be stored files (https links)');
  const key = objectKeyFromUrl(url);
  let mime = '';
  let size = 0;
  let width: number | undefined;
  let height: number | undefined;
  if (key) {
    const info = await headObjectInfo(key);
    mime = info.contentType;
    size = info.size;
    if (mime.startsWith('image/') && size <= 25 * 1024 * 1024) {
      const meta = await sharp(await getObjectRange(key, 0, size - 1)).metadata();
      width = meta.width;
      height = meta.height;
    }
  } else {
    const dl = await downloadImageFromUrl(url);
    mime = dl.contentType;
    size = dl.buffer.length;
    const meta = await sharp(dl.buffer).metadata();
    width = meta.width;
    height = meta.height;
  }
  const kind = kindOfMime(mime);
  if (!kind) throw new PublishError('That file is not a picture or video');
  const name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'file');
  return { kind, source: 'url', url, mime, size, width, height, name };
}

/** Build a readable MediaFile for publishing. */
export async function openMedia(ownerId: Id, postId: Id, m: PostMedia, index: number): Promise<MediaFile> {
  let key: string | null = null;
  let externalUrl: string | null = null;
  let mime = m.mime || 'application/octet-stream';
  let size = m.size || 0;
  if (m.source === 'library') {
    const v = await LibraryVersion.findOne({ _id: m.versionId, ownerId });
    if (!v) throw new PublishError(`"${m.name || 'A file'}" was removed from the Library`);
    key = v.s3Key;
    mime = v.mime;
    size = v.size;
  } else if (m.url) {
    key = objectKeyFromUrl(m.url);
    if (key) {
      const info = await headObjectInfo(key);
      mime = info.contentType;
      size = info.size;
    } else {
      externalUrl = m.url;
    }
  }
  let external: Buffer | null = null;
  const loadExternal = async () => {
    if (!external) {
      const dl = await downloadImageFromUrl(externalUrl!);
      external = dl.buffer;
      size = external.length;
    }
    return external;
  };
  if (externalUrl) await loadExternal();

  const read = async (start: number, end: number) => (key ? getObjectRange(key, start, end) : (await loadExternal()).subarray(start, end + 1));
  const publicUrl = async () => (key ? signedObjectUrl(key, { contentType: mime }) : externalUrl!);
  let jpegUrl: string | null = null;

  return {
    kind: m.kind,
    mime,
    size,
    name: m.name || `media-${index + 1}`,
    width: m.width,
    height: m.height,
    read,
    readAll: () => read(0, size - 1),
    publicUrl,
    async publicJpegUrl() {
      if (mime === 'image/jpeg') return publicUrl();
      if (jpegUrl) return jpegUrl;
      const jpeg = await sharp(await read(0, size - 1)).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
      const jpegKey = `publishing/${ownerId}/${postId}/${index}.jpg`;
      await putPrivateObject(jpegKey, jpeg, 'image/jpeg', jpeg.length);
      jpegUrl = await signedObjectUrl(jpegKey, { contentType: 'image/jpeg' });
      return jpegUrl;
    }
  };
}

/** A temporary link to download one of a post's files (manual posting). */
export async function mediaDownloadUrl(ownerId: Id, m: PostMedia): Promise<string> {
  if (m.source === 'library') {
    const v = await LibraryVersion.findOne({ _id: m.versionId, ownerId });
    if (!v) throw new PublishError('That file was removed from the Library');
    return signedObjectUrl(v.s3Key, { downloadName: v.originalName });
  }
  const key = m.url ? objectKeyFromUrl(m.url) : null;
  return key ? signedObjectUrl(key, { downloadName: m.name || 'image' }) : m.url || '';
}
