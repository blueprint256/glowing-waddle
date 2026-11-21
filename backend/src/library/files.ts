import path from 'path';

/** What kind of item a file is, from its MIME type and extension. */
export type LibraryKind = 'image' | 'video' | 'audio' | 'document' | 'text' | 'design' | 'other';

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html', rtf: 'application/rtf',
  psd: 'image/vnd.adobe.photoshop', ai: 'application/postscript', eps: 'application/postscript', indd: 'application/x-indesign',
  fig: 'application/octet-stream', sketch: 'application/octet-stream', zip: 'application/zip'
};

export function extensionOf(name: string): string {
  return path.extname(name || '').slice(1).toLowerCase();
}

/** Browsers often send application/octet-stream; fall back to the extension. */
export function resolveMime(name: string, mime?: string): string {
  const m = (mime || '').toLowerCase();
  if (m && m !== 'application/octet-stream' && m !== 'binary/octet-stream') return m;
  return EXT_MIME[extensionOf(name)] || 'application/octet-stream';
}

export function kindOf(name: string, mime: string): LibraryKind {
  const ext = extensionOf(name);
  if (['psd', 'ai', 'eps', 'indd', 'fig', 'sketch'].includes(ext)) return 'design';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || ['json', 'md', 'csv', 'txt', 'rtf'].includes(ext)) return 'text';
  if (mime === 'application/pdf' || ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'odp'].includes(ext)) return 'document';
  return 'other';
}

export function isZip(name: string, mime: string): boolean {
  return extensionOf(name) === 'zip' || mime === 'application/zip' || mime === 'application/x-zip-compressed';
}

/** sharp can decode these into thumbnails (HEIC usually can't be with prebuilt binaries). */
export function isRasterImage(mime: string): boolean {
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/tiff', 'image/bmp', 'image/svg+xml'].includes(mime);
}

/** A readable title from a file name: "IMG_2041 women's-day_final.png" → "IMG 2041 women's day final". */
export function titleFromFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() || name).replace(/\.[^.]+$/, '');
  const clean = base.replace(/[_]+/g, ' ').replace(/(?<=\w)-(?=\w)/g, ' ').replace(/\s+/g, ' ').trim();
  return (clean || 'Untitled').slice(0, 120);
}

/** Folder path inside an upload or zip ("Clients/Acme/2024/") is a useful hint for the AI and search. */
export function folderOf(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.join('/').slice(0, 300);
}

export function safeKeyName(name: string): string {
  const ext = extensionOf(name);
  return ext && /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
}
