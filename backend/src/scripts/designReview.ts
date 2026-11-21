/**
 * Renders chosen designs for a scenario, for a person to look at (not part of the app):
 *
 *   DESIGN_SCENARIO=scenario.json tsx src/scripts/designReview.ts
 *
 * scenario.json: { "designs": ["spotlight"], "formats": ["portrait"], "pack": "rotaract",
 *   "text": {...DesignText}, "photo": "/path.jpg", "cutout": "/path.png" (optional),
 *   "sponsors": 6, "campaign": true, "params": {...}, "out": "/tmp/review", "contact": {...} }
 * Writes one PNG per design and format, plus contact-sheet.png with them side by side.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { BUILTIN_DESIGNS } from '../design/library';
import { renderDesign, closeRenderer } from '../design/renderer';
import { buildTestKit, prepared, preparedWithVersions, testDoc, testPhoto } from '../design/testKit';
import { cutoutEdges } from '../design/assets';
import { packById } from '../design/packs';
import { normalizeParams } from '../design/template';
import type { FormatId, PhotoSlot } from '../design/types';

async function main() {
  const sc = JSON.parse(fs.readFileSync(process.env.DESIGN_SCENARIO || 'scenario.json', 'utf8'));
  const out = sc.out || '/tmp/review';
  fs.mkdirSync(out, { recursive: true });
  const { files, kit, sponsors } = await buildTestKit();
  const pack = packById(sc.pack || 'rotary');
  if (pack) Object.assign(kit, { pack: pack.id, colors: pack.colors, fonts: pack.fonts, rules: pack.rules, name: `Test club (${pack.name} pack)` });
  // Real files instead of the placeholders: "logo" (the club's), "logoReverse", "partners": [{name, file}].
  if (sc.logo) {
    const primary = kit.logos.find((l) => l.role === 'primary')!;
    const club = await preparedWithVersions(files, 'real-club', fs.readFileSync(sc.logo));
    club.main.variant = 'color';
    primary.variants = [club.main, ...club.derived];
    if (sc.logoReverse) {
      const rev = await prepared(files, 'real-club-reverse', fs.readFileSync(sc.logoReverse));
      rev.variant = 'reverse';
      primary.variants.push(rev);
    }
    primary.name = 'Club logo';
  }
  if (sc.campaign === false) kit.logos = kit.logos.filter((l) => l.role !== 'campaign');
  if (Array.isArray(sc.partners)) {
    sponsors.length = 0;
    for (const [i, p] of sc.partners.entries()) {
      const v = await preparedWithVersions(files, `real-partner-${i + 1}`, fs.readFileSync(p.file));
      sponsors.push({ name: p.name, logo: v.main, alts: v.derived });
    }
  }
  const photos: PhotoSlot[] = [];
  if (sc.photo) {
    const slot = await testPhoto(files, path.basename(sc.photo), fs.readFileSync(sc.photo));
    // Where the people are, as the art director would say (the automatic focal point chases texture).
    if (sc.focal) slot.focal = sc.focal;
    if (sc.cutout) {
      const buf = fs.readFileSync(sc.cutout);
      const meta = await sharp(buf).metadata();
      const url = `test://cutout/${path.basename(sc.cutout)}`;
      files.set(url, buf);
      slot.cutout = { url, width: meta.width!, height: meta.height!, edges: await cutoutEdges(buf) };
      console.log('cut-out edges', slot.cutout.edges);
    }
    photos.push(slot);
  }
  const loader = async (url: string) => {
    const b = files.get(url);
    if (!b) throw new Error(`missing ${url}`);
    return b;
  };
  const shots: { file: string; buf: Buffer }[] = [];
  for (const id of sc.designs || ['spotlight']) {
    const design = BUILTIN_DESIGNS.find((d) => d.id === id)!;
    for (const format of (sc.formats || ['portrait']) as FormatId[]) {
      if (!design.formats.includes(format)) continue;
      const doc = testDoc(id, format, { ...sc.text }, photos, sponsors.slice(0, sc.sponsors ?? 6), sc.campaign !== false);
      doc.params = normalizeParams(design.params, sc.params || {});
      const r = await renderDesign(design, doc, kit, loader, { scale: 1 });
      const name = `${sc.name || 'review'}--${id}--${format}.png`;
      fs.writeFileSync(path.join(out, name), r.file);
      shots.push({ file: name, buf: r.file });
      const issues = r.report.issues.map((i) => `${i.level}: ${i.message}`);
      console.log(`${name}  contrast ${r.report.minContrast?.toFixed(2)}  ${r.report.ms}ms${issues.length ? '\n   ' + issues.join('\n   ') : ''}`);
    }
  }
  if (shots.length > 1) {
    const H = 900;
    const scaled = await Promise.all(shots.map(async (s) => sharp(s.buf).resize({ height: H }).png().toBuffer({ resolveWithObject: true })));
    const W = scaled.reduce((a, s) => a + s.info.width + 24, 24);
    let x = 24;
    const comps = scaled.map((s) => {
      const c = { input: s.data, left: x, top: 24 };
      x += s.info.width + 24;
      return c;
    });
    await sharp({ create: { width: W, height: H + 48, channels: 3, background: '#e9e7e2' } }).composite(comps).png().toFile(path.join(out, `${sc.name || 'review'}--sheet.png`));
  }
  await closeRenderer();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
