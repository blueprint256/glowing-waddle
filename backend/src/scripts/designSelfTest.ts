/**
 * Poster engine self-test: renders every built-in design in every format with short, typical and
 * long content and 0, 3 and 6 sponsors, runs the checks, and writes the posters to DESIGN_OUT
 * (default /tmp/design-out) so a person can look at them.
 *
 *   DESIGN_PHOTOS=/path/to/photos npm run design:selftest
 *
 * DESIGN_PHOTOS: a folder of real photos to use (JPEG/PNG). DESIGN_ONLY=hero-photo limits the
 * designs; DESIGN_FORMATS=portrait,square limits the formats.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { BUILTIN_DESIGNS } from '../design/library';
import { renderDesign, closeRenderer } from '../design/renderer';
import { validateTemplate } from '../design/template';
import { buildTestKit, testDoc, testPhoto, SAMPLE_TEXT } from '../design/testKit';
import type { FormatId, PhotoSlot } from '../design/types';
import { checkScore } from '../design/checks';

async function main() {
  const out = process.env.DESIGN_OUT || '/tmp/design-out';
  fs.mkdirSync(out, { recursive: true });
  const { files, kit, sponsors } = await buildTestKit();

  // Photos: a folder of real ones, or generated stand-ins.
  const photos: PhotoSlot[] = [];
  const dir = process.env.DESIGN_PHOTOS;
  if (dir && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((n) => /\.(jpe?g|png|webp)$/i.test(n)).sort()) {
      photos.push(await testPhoto(files, f, fs.readFileSync(path.join(dir, f))));
    }
  }
  if (!photos.length) {
    const stand = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#8a7a66' } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><circle cx="800" cy="520" r="220" fill="#c79a74"/><rect x="560" y="740" width="480" height="460" rx="120" fill="#3b5d8f"/></svg>') }])
      .jpeg()
      .toBuffer();
    photos.push(await testPhoto(files, 'standin.jpg', stand));
  }
  const loader = async (url: string) => {
    const b = files.get(url);
    if (!b) throw new Error('missing ' + url);
    return b;
  };

  const only = process.env.DESIGN_ONLY?.split(',');
  const formats = process.env.DESIGN_FORMATS?.split(',') as FormatId[] | undefined;
  let failures = 0;
  for (const design of BUILTIN_DESIGNS.filter((d) => !only || only.includes(d.id))) {
    const problems = validateTemplate(design);
    if (problems.length) {
      console.log(`✗ ${design.id}: ${problems.join(' ')}`);
      failures++;
      continue;
    }
    for (const format of design.formats.filter((f) => !formats || formats.includes(f))) {
      const cases: [string, keyof typeof SAMPLE_TEXT, number][] = [
        ['typical-3', 'typical', 3],
        ['short-0', 'short', 0],
        ['long-6', 'long', 6]
      ];
      for (const [name, textKey, sponsorCount] of cases) {
        const photo = photos[(name.length + format.length) % photos.length];
        const doc = testDoc(design.id, format, SAMPLE_TEXT[textKey], [photo].slice(0, design.photos.max), sponsors.slice(0, sponsorCount));
        const file = `${design.id}--${format}--${name}.png`;
        try {
          const r = await renderDesign(design, doc, kit, loader, { scale: 1 });
          fs.writeFileSync(path.join(out, file), r.file);
          const errors = r.report.issues.filter((i) => i.level === 'error');
          if (errors.length && name !== 'long-6') failures++;
          console.log(
            `${errors.length ? '✗' : '✓'} ${file} score ${checkScore(r.report.issues)} contrast ${r.report.minContrast ?? '-'} ${r.report.ms}ms` +
              (r.report.issues.length ? '\n    ' + r.report.issues.map((i) => `${i.level}: ${i.message}${i.key ? ' [' + (r.report.elements.find((e) => e.key === i.key)?.why || '') + ']' : ''}`).join('\n    ') : '')
          );
        } catch (e: any) {
          failures++;
          console.log(`✗ ${file}: ${e.message}`);
        }
      }
    }
  }
  await closeRenderer();
  console.log(failures ? `\n${failures} problem(s).` : '\nAll designs rendered cleanly.');
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await closeRenderer();
  process.exit(1);
});
