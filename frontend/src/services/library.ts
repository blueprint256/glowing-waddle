import api, { API_URL } from './api';

/** Library (Aggregator): API client and upload helpers. */

export type LibraryKind = 'image' | 'video' | 'audio' | 'document' | 'text' | 'design' | 'other';

export interface LibraryVersionInfo {
  id: string;
  number: number;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  originalName: string;
  createdAt: string;
  hasThumbnail?: boolean;
  note?: string;
  source?: string;
  restoredFrom?: number;
  isCurrent?: boolean;
  thumbnailUrl?: string | null;
  fileUrl?: string;
  downloadUrl?: string;
}

export interface LibraryItem {
  id: string;
  ownerId: string;
  title: string;
  kind: LibraryKind;
  category: string;
  description?: string;
  textPreview?: string;
  textContent?: string;
  notes?: string;
  tags: string[];
  event: string;
  colors: string[];
  folder: string;
  capturedAt?: string;
  dateSource?: string;
  links: { campaignId: string | null; projectId: string | null; taskId: string | null };
  versionCount: number;
  currentVersion: LibraryVersionInfo | null;
  aiStatus: 'pending' | 'done' | 'failed' | 'skipped';
  aiError?: string;
  needsReview: boolean;
  review: { versionOf: { assetId: string; distance: number } } | null;
  source: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string | null;
  fileUrl: string;
  versions?: LibraryVersionInfo[];
}

export interface LibraryOverview {
  total: number;
  kinds: Record<string, number>;
  years: {
    year: number;
    count: number;
    months: { month: number; name: string; count: number; kinds: Record<string, number>; events: { name: string; count: number }[] }[];
  }[];
  topEvents: { name: string; count: number }[];
  needsReview: number;
  processing: number;
  inTrash: number;
}

export interface LibraryStatus {
  available: boolean;
  reason?: string;
  ai: { enabled: boolean; problem: string | null; monthlyLimit: number; usedThisMonth: number };
  semanticSearch: boolean;
  maxFileBytes: number;
}

export interface UploadResult {
  name: string;
  status: 'created' | 'version_added' | 'duplicate' | 'failed';
  assetId?: string;
  versionNumber?: number;
  error?: string;
  similarTo?: string;
}

export interface BatchProgress {
  batchId: string;
  total: number;
  processed: number;
  pending: number;
  failed: number;
  needsReview: number;
  done: boolean;
}

export interface LibraryQuery {
  q?: string;
  /** Admins: whose Library to search (default: their own). */
  ownerId?: string;
  kind?: string;
  category?: string;
  event?: string;
  tags?: string;
  from?: string;
  to?: string;
  campaignId?: string;
  taskId?: string;
  needsReview?: boolean;
  trash?: boolean;
  batchId?: string;
  sort?: 'relevance' | 'newest' | 'oldest' | 'recent';
  page?: number;
  limit?: number;
}

/** File links from the API are relative to the API root ("/api/…"); point them at the configured API host. */
export function librarySrc(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/api/') ? `${API_URL.replace(/\/$/, '')}${url.slice(4)}` : url;
}

export const libraryAPI = {
  status: () => api.get<LibraryStatus & { success: boolean }>('/library/status').then((r) => r.data),
  overview: () => api.get<{ overview: LibraryOverview }>('/library/overview').then((r) => r.data.overview),
  search: (params: LibraryQuery) =>
    api
      .get<{ items: LibraryItem[]; total: number; page: number; limit: number }>('/library/items', {
        params: { ...params, needsReview: params.needsReview ? 'true' : undefined, trash: params.trash ? 'true' : undefined }
      })
      .then((r) => r.data),
  get: (id: string) => api.get<{ item: LibraryItem }>(`/library/items/${id}`).then((r) => r.data.item),
  /** Use this picture (or an older version of it) as a post's image. */
  useOnPost: (id: string, taskId: string, versionId?: string) =>
    api.post<{ imageUrl: string; message: string }>(`/library/items/${id}/use-on-post`, { taskId, versionId }).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.patch<{ item: LibraryItem }>(`/library/items/${id}`, body).then((r) => r.data.item),
  addVersion: (id: string, file: File, note: string, onProgress?: (fraction: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    form.append('note', note);
    return api
      .post<{ item: LibraryItem }>(`/library/items/${id}/versions`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => onProgress?.(e.total ? e.loaded / e.total : 0)
      })
      .then((r) => r.data.item);
  },
  restoreVersion: (id: string, versionId: string) =>
    api.post<{ item: LibraryItem }>(`/library/items/${id}/versions/${versionId}/restore`).then((r) => r.data.item),
  reanalyze: (id: string) => api.post(`/library/items/${id}/reanalyze`).then((r) => r.data),
  review: (id: string, action: 'merge' | 'keep') => api.post<{ assetId: string }>(`/library/items/${id}/review`, { action }).then((r) => r.data),
  trash: (id: string) => api.delete(`/library/items/${id}`).then((r) => r.data),
  restore: (id: string) => api.post(`/library/items/${id}/restore`).then((r) => r.data),
  purge: (id: string) => api.delete(`/library/items/${id}/permanent`).then((r) => r.data),
  importApp: () => api.post<{ batchId: string; message: string }>('/library/import-app').then((r) => r.data),
  progress: (batchId: string) => api.get<{ progress: BatchProgress }>(`/library/imports/${batchId}`).then((r) => r.data.progress),
  makeCampaign: (event: string, year?: number) =>
    api
      .post<{ campaign: { id: string; name: string }; linked: number; items: number }>('/library/collections/campaign', { event, year })
      .then((r) => r.data),
  settings: () => api.get('/library/settings').then((r) => r.data.settings),
  saveSettings: (body: Record<string, unknown>) => api.patch('/library/settings', body).then((r) => r.data.settings)
};

export interface PickedFile {
  file: File;
  /** Path inside the chosen folder, e.g. "2023/Women's Day/poster-final.png". */
  relativePath: string;
}

/** Collects files from a drag-and-drop, walking dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(dt.items || [])
    .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return Array.from(dt.files).map((file) => ({ file, relativePath: file.name }));
  const out: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (out.length >= 5000) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, relativePath: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in pages; keep reading until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

const SKIP = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX\/.*|\._.*)$/i;

/** Drops OS clutter files that should never be imported. */
export function importable(files: PickedFile[]): PickedFile[] {
  return files.filter((f) => !SKIP.test(f.relativePath) && f.file.size > 0);
}

export function newBatchId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Uploads files in small groups (≤ 10 files / ~100 MB per request) under one batch id, so one bad
 * file or a dropped connection never loses the whole import and progress is smooth.
 */
export async function uploadFiles(
  files: PickedFile[],
  opts: {
    batchId: string;
    event?: string;
    tags?: string;
    onProgress?: (sentBytes: number, totalBytes: number) => void;
    onResults?: (results: UploadResult[]) => void;
    signal?: AbortSignal;
  }
): Promise<UploadResult[]> {
  const totalBytes = files.reduce((s, f) => s + f.file.size, 0);
  const groups: PickedFile[][] = [];
  let current: PickedFile[] = [];
  let currentBytes = 0;
  for (const f of files) {
    if (current.length && (current.length >= 10 || currentBytes + f.file.size > 100 * 1024 * 1024)) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(f);
    currentBytes += f.file.size;
  }
  if (current.length) groups.push(current);

  const all: UploadResult[] = [];
  let sentBefore = 0;
  for (const group of groups) {
    if (opts.signal?.aborted) break;
    const form = new FormData();
    for (const f of group) form.append('files', f.file, f.file.name);
    form.append('relativePaths', JSON.stringify(group.map((f) => f.relativePath)));
    form.append('lastModified', JSON.stringify(group.map((f) => f.file.lastModified || null)));
    form.append('batchId', opts.batchId);
    if (opts.event) form.append('event', opts.event);
    if (opts.tags) form.append('tags', opts.tags);
    const groupBytes = group.reduce((s, f) => s + f.file.size, 0);
    try {
      const res = await api.post<{ results: UploadResult[] }>('/library/uploads', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: opts.signal,
        timeout: 0,
        onUploadProgress: (e) => opts.onProgress?.(sentBefore + (e.total ? (e.loaded / e.total) * groupBytes : 0), totalBytes)
      });
      all.push(...res.data.results);
      opts.onResults?.(res.data.results);
    } catch (error: any) {
      if (opts.signal?.aborted) break;
      const message = error?.response?.data?.message || error?.message || 'Upload failed';
      const failed = group.map((f) => ({ name: f.relativePath, status: 'failed' as const, error: message }));
      all.push(...failed);
      opts.onResults?.(failed);
      // Access problems affect every group: stop instead of repeating the same error.
      if (error?.response?.status === 403 || error?.response?.status === 401) break;
    }
    sentBefore += groupBytes;
    opts.onProgress?.(sentBefore, totalBytes);
  }
  return all;
}

export function formatBytes(n?: number): string {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatItemDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const KIND_LABELS: Record<string, string> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  document: 'Documents',
  text: 'Text & notes',
  design: 'Design files',
  other: 'Other'
};

export const CATEGORY_LABELS: Record<string, string> = {
  poster: 'Poster',
  social_post: 'Social post',
  photo: 'Photo',
  logo: 'Logo',
  illustration: 'Illustration',
  screenshot: 'Screenshot',
  document: 'Document',
  caption: 'Caption',
  draft: 'Draft',
  video: 'Video',
  other: 'Other'
};
