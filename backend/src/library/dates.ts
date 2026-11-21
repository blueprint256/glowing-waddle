/**
 * Working out when a file is "from": photo metadata beats a date in the file name, which beats a
 * date the AI read in the content, which beats the file's last-modified time, which beats upload time.
 */
export type DateSource = 'exif' | 'filename' | 'content' | 'file_modified' | 'upload' | 'user';

const MIN_YEAR = 1990;

function valid(y: number, m: number, d: number, h = 0, mi = 0, s = 0): Date | null {
  const date = new Date(Date.UTC(y, m - 1, d, h, mi, s));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < MIN_YEAR || date.getTime() > Date.now() + 366 * 86400000) return null;
  return date;
}

/** IMG_20240308_101500.jpg, WhatsApp Image 2024-03-08 at 10.15.00, Screenshot 2024-03-08, 2024_03_08-poster.png … */
export function dateFromFilename(name: string): Date | null {
  const base = name.split(/[\\/]/).pop() || name;
  const re = /(?<!\d)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?!\d)/;
  const m = re.exec(base);
  if (!m) return null;
  return valid(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** "YYYY-MM-DD" (AI output or user input). */
export function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? valid(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** EXIF "YYYY:MM:DD HH:MM:SS". */
export function parseExifDateString(value: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  return m ? valid(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]) : null;
}

export function chooseCapturedAt(opts: {
  exif?: Date | null;
  filename?: Date | null;
  content?: Date | null;
  fileModified?: Date | null;
  uploadedAt: Date;
}): { date: Date; source: DateSource } {
  if (opts.exif) return { date: opts.exif, source: 'exif' };
  if (opts.filename) return { date: opts.filename, source: 'filename' };
  if (opts.content) return { date: opts.content, source: 'content' };
  // A last-modified time a day or more before upload is a useful hint (phone/computer copies keep it).
  if (opts.fileModified && opts.fileModified.getTime() < opts.uploadedAt.getTime() - 86400000 && opts.fileModified.getUTCFullYear() >= MIN_YEAR) {
    return { date: opts.fileModified, source: 'file_modified' };
  }
  return { date: opts.uploadedAt, source: 'upload' };
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
