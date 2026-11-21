import { listZip, readZipEntry } from './zip';
import { extensionOf } from './files';

/**
 * Pull readable text out of uploads so captions, notes and briefs become searchable and readable by AI:
 * plain text / markdown / CSV / JSON / HTML, Word (.docx) and PowerPoint (.pptx).
 */
const MAX_TEXT = 60_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function tidy(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

export function htmlToText(html: string): string {
  return tidy(
    decodeEntities(
      html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function docxText(buf: Buffer): string {
  const entries = listZip(buf);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return '';
  const xml = readZipEntry(buf, doc, 20 * 1024 * 1024).toString('utf8');
  return tidy(
    decodeEntities(
      xml
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
    )
  );
}

function pptxText(buf: Buffer): string {
  const entries = listZip(buf)
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(a.name.match(/\d+/)![0]) - Number(b.name.match(/\d+/)![0]));
  const slides = entries.map((e, i) => {
    const xml = readZipEntry(buf, e, 10 * 1024 * 1024).toString('utf8');
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeEntities(m[1]));
    return `Slide ${i + 1}: ${runs.join(' ')}`;
  });
  return tidy(slides.join('\n'));
}

export function extractText(buf: Buffer, name: string, mime: string): string {
  const ext = extensionOf(name);
  try {
    if (ext === 'docx') return docxText(buf);
    if (ext === 'pptx') return pptxText(buf);
    if (mime === 'text/html' || ext === 'html' || ext === 'htm') return htmlToText(buf.toString('utf8'));
    if (mime.startsWith('text/') || ['txt', 'md', 'csv', 'json'].includes(ext)) {
      return tidy(buf.toString('utf8').replace(/^﻿/, ''));
    }
  } catch {
    return '';
  }
  return '';
}
