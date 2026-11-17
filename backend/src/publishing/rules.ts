import { PlatformId } from './types';

/**
 * Each platform's posting rules, checked before a post is scheduled so problems show up while the user
 * is still writing — not hours later when it fails. Pure functions; no network.
 */

export interface PlatformRules {
  name: string;
  /** Maximum caption length (characters as the platform counts them). */
  maxText: number;
  textRequired: boolean;
  mediaRequired: boolean;
  maxImages: number;
  maxVideos: number;
  /** Can one post mix images and videos? */
  allowMixed: boolean;
  videoRequired: boolean;
  titleRequired: boolean;
  maxTitle?: number;
  maxHashtags?: number;
  /** Largest accepted file sizes (bytes). */
  maxImageBytes: number;
  maxVideoBytes: number;
  imageTypes: string[];
  videoTypes: string[];
  /** Allowed width/height ratio for images, when the platform enforces one. */
  imageRatio?: [number, number];
}

const MB = 1024 * 1024;
const COMMON_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const COMMON_VIDEOS = ['video/mp4', 'video/quicktime', 'video/webm'];

export const RULES: Record<PlatformId, PlatformRules> = {
  x: {
    name: 'X',
    maxText: 280,
    textRequired: false,
    mediaRequired: false,
    maxImages: 4,
    maxVideos: 1,
    allowMixed: false,
    videoRequired: false,
    titleRequired: false,
    maxImageBytes: 5 * MB,
    maxVideoBytes: 512 * MB,
    imageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    videoTypes: ['video/mp4', 'video/quicktime']
  },
  linkedin: {
    name: 'LinkedIn',
    maxText: 3000,
    textRequired: false,
    mediaRequired: false,
    maxImages: 20,
    maxVideos: 1,
    allowMixed: false,
    videoRequired: false,
    titleRequired: false,
    maxImageBytes: 36 * MB,
    maxVideoBytes: 500 * MB,
    imageTypes: ['image/jpeg', 'image/png', 'image/gif'],
    videoTypes: ['video/mp4']
  },
  facebook: {
    name: 'Facebook',
    maxText: 63206,
    textRequired: false,
    mediaRequired: false,
    maxImages: 10,
    maxVideos: 1,
    allowMixed: false,
    videoRequired: false,
    titleRequired: false,
    maxImageBytes: 10 * MB,
    maxVideoBytes: 1024 * MB,
    imageTypes: COMMON_IMAGES,
    videoTypes: COMMON_VIDEOS
  },
  instagram: {
    name: 'Instagram',
    maxText: 2200,
    textRequired: false,
    mediaRequired: true,
    maxImages: 10,
    maxVideos: 10,
    allowMixed: true,
    videoRequired: false,
    titleRequired: false,
    maxHashtags: 30,
    maxImageBytes: 8 * MB,
    maxVideoBytes: 300 * MB,
    // Non-JPEG images are converted to JPEG automatically before posting.
    imageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    videoTypes: ['video/mp4', 'video/quicktime'],
    imageRatio: [0.8, 1.91]
  },
  tiktok: {
    name: 'TikTok',
    maxText: 2200,
    textRequired: false,
    mediaRequired: true,
    maxImages: 0,
    maxVideos: 1,
    allowMixed: false,
    videoRequired: true,
    titleRequired: false,
    maxImageBytes: 20 * MB,
    maxVideoBytes: 4 * 1024 * MB,
    imageTypes: [],
    videoTypes: ['video/mp4', 'video/quicktime', 'video/webm']
  },
  youtube: {
    name: 'YouTube',
    maxText: 5000,
    textRequired: false,
    mediaRequired: true,
    maxImages: 0,
    maxVideos: 1,
    allowMixed: false,
    videoRequired: true,
    titleRequired: true,
    maxTitle: 100,
    maxImageBytes: 0,
    maxVideoBytes: 256 * 1024 * MB,
    imageTypes: [],
    videoTypes: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/mpeg']
  }
};

export interface MediaInfo {
  kind: 'image' | 'video';
  mime: string;
  size: number;
  width?: number;
  height?: number;
  name?: string;
}

export interface Problem {
  level: 'error' | 'warning';
  message: string;
}

const URL_RE = /https?:\/\/[^\s]+/gi;

/** X counts every link as 23 characters, and most emoji/CJK as 2. */
export function xLength(text: string): number {
  let n = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    n += 23;
    return '';
  });
  for (const ch of withoutUrls) {
    const code = ch.codePointAt(0) || 0;
    n += code > 0x10ff ? 2 : 1;
  }
  return n;
}

export function textLength(platform: PlatformId, text: string): number {
  return platform === 'x' ? xLength(text) : [...text].length;
}

export function validatePost(platform: PlatformId, post: { text: string; media: MediaInfo[]; title?: string }): Problem[] {
  const r = RULES[platform];
  const problems: Problem[] = [];
  const err = (message: string) => problems.push({ level: 'error', message });
  const warn = (message: string) => problems.push({ level: 'warning', message });
  const text = post.text || '';
  const images = post.media.filter((m) => m.kind === 'image');
  const videos = post.media.filter((m) => m.kind === 'video');

  const len = textLength(platform, text);
  if (len > r.maxText) err(`${r.name} allows ${r.maxText.toLocaleString()} characters; this caption has ${len.toLocaleString()}.`);
  if (!text.trim() && !post.media.length) err('Add a caption or a picture.');
  if (r.mediaRequired && !post.media.length) err(`${r.name} needs ${r.videoRequired ? 'a video' : 'at least one picture or video'}.`);
  if (r.videoRequired && post.media.length && !videos.length) err(`${r.name} posts must be a video.`);
  if (images.length > r.maxImages) {
    err(r.maxImages ? `${r.name} allows up to ${r.maxImages} pictures per post.` : `${r.name} doesn't accept pictures here; attach a video.`);
  }
  if (videos.length > r.maxVideos) err(`${r.name} allows ${r.maxVideos === 1 ? 'one video' : `up to ${r.maxVideos} videos`} per post.`);
  if (!r.allowMixed && images.length && videos.length) err(`${r.name} can't mix pictures and a video in one post.`);
  if (platform === 'instagram' && post.media.length > 10) err('Instagram carousels hold up to 10 items.');
  if (r.titleRequired && !(post.title || '').trim()) err(`${r.name} needs a title.`);
  if (r.maxTitle && (post.title || '').length > r.maxTitle) err(`${r.name} titles can be up to ${r.maxTitle} characters.`);
  if (r.maxHashtags) {
    const tags = (text.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    if (tags > r.maxHashtags) err(`${r.name} allows up to ${r.maxHashtags} hashtags; this caption has ${tags}.`);
  }

  for (const m of post.media) {
    const label = m.name ? `"${m.name}"` : m.kind === 'image' ? 'A picture' : 'The video';
    const types = m.kind === 'image' ? r.imageTypes : r.videoTypes;
    if (types.length && m.mime && !types.includes(m.mime.toLowerCase())) {
      err(`${label} is a ${m.mime.split('/')[1] || m.mime} file, which ${r.name} doesn't accept.`);
    }
    const max = m.kind === 'image' ? r.maxImageBytes : r.maxVideoBytes;
    if (max && m.size > max) err(`${label} is ${(m.size / MB).toFixed(1)} MB; ${r.name} accepts up to ${Math.round(max / MB)} MB.`);
    if (m.kind === 'image' && r.imageRatio && m.width && m.height) {
      const ratio = m.width / m.height;
      if (ratio < r.imageRatio[0] - 0.01 || ratio > r.imageRatio[1] + 0.01) {
        err(`${label} is ${m.width}×${m.height}; ${r.name} needs pictures between portrait 4:5 and landscape 1.91:1. Crop it first.`);
      }
    }
  }

  if (platform === 'x' && URL_RE.test(text)) warn('X charges more for posts that contain a link.');
  URL_RE.lastIndex = 0;
  if (platform === 'instagram' && URL_RE.test(text)) warn('Links in Instagram captions are not clickable.');
  URL_RE.lastIndex = 0;
  return problems;
}

export function hasErrors(problems: Problem[]): boolean {
  return problems.some((p) => p.level === 'error');
}
