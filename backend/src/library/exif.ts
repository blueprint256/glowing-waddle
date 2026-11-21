import { parseExifDateString } from './dates';

/**
 * Reads the capture date from a raw EXIF block (as returned by sharp's metadata().exif):
 * DateTimeOriginal (0x9003), then DateTimeDigitized (0x9004), then DateTime (0x0132).
 */
export function exifCaptureDate(exif: Buffer | undefined | null): Date | null {
  if (!exif || exif.length < 14) return null;
  try {
    let base = 0;
    if (exif.subarray(0, 6).toString('latin1') === 'Exif\0\0') base = 6;
    const order = exif.subarray(base, base + 2).toString('latin1');
    const le = order === 'II';
    if (!le && order !== 'MM') return null;
    const u16 = (o: number) => (le ? exif.readUInt16LE(base + o) : exif.readUInt16BE(base + o));
    const u32 = (o: number) => (le ? exif.readUInt32LE(base + o) : exif.readUInt32BE(base + o));
    if (u16(2) !== 42) return null;

    const readIfd = (offset: number): Map<number, { type: number; count: number; valueOffset: number; entryOffset: number }> => {
      const tags = new Map();
      if (base + offset + 2 > exif.length) return tags;
      const n = u16(offset);
      for (let i = 0; i < n && i < 512; i++) {
        const e = offset + 2 + i * 12;
        if (base + e + 12 > exif.length) break;
        tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), valueOffset: u32(e + 8), entryOffset: e + 8 });
      }
      return tags;
    };
    const ascii = (t: { type: number; count: number; valueOffset: number; entryOffset: number } | undefined) => {
      if (!t || t.type !== 2 || t.count < 19) return null;
      const start = base + (t.count <= 4 ? t.entryOffset : t.valueOffset);
      if (start + 19 > exif.length) return null;
      return exif.subarray(start, start + 19).toString('latin1');
    };

    const ifd0 = readIfd(u32(4));
    const exifPtr = ifd0.get(0x8769);
    const exifIfd = exifPtr ? readIfd(exifPtr.valueOffset) : new Map();
    for (const value of [ascii(exifIfd.get(0x9003)), ascii(exifIfd.get(0x9004)), ascii(ifd0.get(0x0132))]) {
      if (value) {
        const d = parseExifDateString(value);
        if (d) return d;
      }
    }
    return null;
  } catch {
    return null;
  }
}
