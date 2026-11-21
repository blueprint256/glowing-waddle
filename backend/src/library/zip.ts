import zlib from 'zlib';

/**
 * Minimal, safe ZIP reader (no dependency): lists entries and extracts stored/deflated files.
 * Used for bulk uploads (.zip) and for reading text out of .docx / .pptx files.
 * ZIP64 and encrypted archives are rejected; every entry is size-capped (zip-bomb safe).
 */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  encrypted: boolean;
  isDirectory: boolean;
}

export class ZipError extends Error {}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export function listZip(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw new ZipError('Not a zip file');
  let eocd = -1;
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported. Split it into smaller zips.');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipError('The zip file is damaged');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({
      name,
      method,
      compressedSize,
      size,
      localOffset,
      encrypted: (flags & 1) === 1,
      isDirectory: name.endsWith('/')
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(buf: Buffer, entry: ZipEntry, maxSize: number): Buffer {
  if (entry.encrypted) throw new ZipError(`${entry.name} is password-protected`);
  if (entry.size > maxSize) throw new ZipError(`${entry.name} is too large`);
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== SIG_LOCAL) throw new ZipError('The zip file is damaged');
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, maxSize) });
    } catch {
      throw new ZipError(`${entry.name} could not be decompressed`);
    }
  }
  throw new ZipError(`${entry.name} uses an unsupported compression method`);
}

/** Files worth importing from a zip (skips folders, macOS metadata and hidden files). */
export function importableEntries(entries: ZipEntry[]): ZipEntry[] {
  return entries.filter((e) => {
    if (e.isDirectory || e.encrypted) return false;
    const parts = e.name.split('/');
    if (parts.some((part) => part === '__MACOSX' || part.startsWith('.'))) return false;
    const base = parts[parts.length - 1];
    return base.length > 0 && base !== 'Thumbs.db' && base !== 'desktop.ini';
  });
}
