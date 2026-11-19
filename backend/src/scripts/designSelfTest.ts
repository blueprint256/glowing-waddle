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
import { roomierSettings, validateTemplate } from '../design/template';
import { buildTestKit, preparedWithVersions, testBackground, testDoc, testPhoto, SAMPLE_TEXT } from '../design/testKit';
import type { DesignTemplate, DesignText, FormatId, PhotoSlot } from '../design/types';
import { checkScore, hasErrors } from '../design/checks';
import { plannedDocs, planWithoutAI, cleanCopy, type DirectorInput, type DirectorPlan } from '../design/director';
import { applyEdits, applyTextEdits } from '../design/edits';
import { buildToolRequest } from '../design/claude';
import { DIRECTOR_TOOL } from '../design/director';

async function main() {
  const out = process.env.DESIGN_OUT || '/tmp/design-out';
  fs.mkdirSync(out, { recursive: true });
  const { files, kit, sponsors } = await buildTestKit();
  let smallPhoto = 0;

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
  const background = await testBackground(files);
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
        // Many partners with ordinary words: clubs often list six to nine.
        ['typical-6', 'typical', 6],
        ['short-0', 'short', 0],
        ['long-6', 'long', 6]
      ];
      for (const [name, textKey, sponsorCount] of cases) {
        const photo = photos[(name.length + format.length) % photos.length];
        const usePhotos = (name === 'long-6' && design.photos.max >= 2 ? [photo, photos[(photos.indexOf(photo) + 1) % photos.length]] : [photo]).slice(0, design.photos.max);
        // Typical and short words are written to the design's limits, as the art director writes
        // them; the long words are the stress test and stay as they are.
        const words = textKey === 'long' ? SAMPLE_TEXT[textKey] : withinLimits(SAMPLE_TEXT[textKey], design);
        const doc = testDoc(design.id, format, words, usePhotos, sponsors.slice(0, sponsorCount));
        if (design.background !== 'none' && name !== 'short-0') doc.background = background;
        const file = `${design.id}--${format}--${name}.png`;
        try {
          let r = await renderDesign(design, doc, kit, loader, { scale: 1 });
          // As the pipeline does: when something doesn't fit, the roomier settings get a try.
          let roomier = false;
          if (name !== 'long-6' && r.report.issues.some((i) => i.level === 'error')) {
            const params = roomierSettings(design, doc.params);
            if (params) {
              const again = await renderDesign(design, { ...doc, params }, kit, loader, { scale: 1 });
              if (!again.report.issues.some((i) => i.level === 'error')) {
                r = again;
                roomier = true;
              }
            }
          }
          fs.writeFileSync(path.join(out, file), r.file);
          // A photo too small for the paper says something about the test photo, not the layout:
          // reported, not counted.
          const errors = r.report.issues.filter((i) => i.level === 'error' && i.code !== 'photo-small');
          if (r.report.issues.some((i) => i.code === 'photo-small')) smallPhoto++;
          if (errors.length && name !== 'long-6') failures++;
          console.log(
            `${errors.length ? '✗' : '✓'} ${file}${roomier ? ' (roomier settings)' : ''} score ${checkScore(r.report.issues)} contrast ${r.report.minContrast ?? '-'} ${r.report.ms}ms` +
              (r.report.issues.length ? '\n    ' + r.report.issues.map((i) => `${i.level}: ${i.message}${i.key ? ' [' + (r.report.elements.find((e) => e.key === i.key)?.why || '') + ']' : ''}`).join('\n    ') : '')
          );
        } catch (e: any) {
          failures++;
          console.log(`✗ ${file}: ${e.message}`);
        }
      }
    }
  }
  // The checks themselves: words pushed under the circle photo, and over its edge, must be caught.
  if (!only || only.includes('bold-event')) {
    const be = BUILTIN_DESIGNS.find((d) => d.id === 'bold-event')!;
    const words = { ...SAMPLE_TEXT.typical, subhead: 'Join Rotary volunteers as we help health' };
    for (const [name, extra, code] of [
      ['words across a photo edge', '#poster .be-info { width: 80cqw !important; }', 'text-photo-edge'],
      ['a photo on top of words', '#poster .be-info { width: 80cqw !important; } #poster .be-circle-wrap { z-index: 9 !important; }', 'text-covered']
    ] as const) {
      const r = await renderDesign({ ...be, css: be.css + extra }, testDoc(be.id, 'a4', words, [photos[0]], sponsors.slice(0, 3)), kit, loader, { scale: 1 });
      const caught = r.report.issues.some((i) => i.code === code);
      console.log(`${caught ? '✓' : '✗'} check catches ${name}`);
      if (!caught) failures++;
    }
  }

  // Logo versions: a one-colour cranberry club logo on a cranberry ground shows its white version; a
  // white-only partner logo on the white partner band shows its dark version; a two-colour logo that
  // can't read on a ground sits on a plate.
  if (!only || only.includes('bold-event')) {
    const be = BUILTIN_DESIGNS.find((d) => d.id === 'bold-event')!;
    const svgBuf = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
    const png = (b: Buffer) => sharp(b, { density: 144 }).png().toBuffer();
    const clubMono = await preparedWithVersions(files, 'mono-club', await png(svgBuf(900, 300, `<circle cx="760" cy="150" r="120" fill="none" stroke="#d22163" stroke-width="40"/><text x="20" y="200" font-family="DejaVu Sans" font-weight="700" font-size="150" fill="#d22163">Club</text>`)));
    const whitePartner = await preparedWithVersions(files, 'white-partner', await png(svgBuf(900, 300, `<text x="20" y="200" font-family="DejaVu Sans" font-weight="700" font-size="150" fill="#ffffff">HOTEL</text>`)));
    const kit2 = JSON.parse(JSON.stringify(kit)) as typeof kit;
    kit2.colors.secondary = { name: 'Cranberry', hex: '#d22163' };
    kit2.logos = kit2.logos.filter((l) => l.role !== 'campaign').map((l) => (l.role === 'primary' ? { ...l, variants: [clubMono.main, ...clubMono.derived] } : l));
    const sponsorsWhite = [{ name: 'Hotel', logo: whitePartner.main, alts: whitePartner.derived }, ...sponsors.slice(0, 2)];
    const doc = testDoc(be.id, 'portrait', withinLimits(SAMPLE_TEXT.typical, be), [photos[0]], sponsorsWhite, false);
    const r = await renderDesign(be, doc, kit2, loader, { scale: 1 });
    fs.writeFileSync(path.join(out, 'logo-versions.png'), r.file);
    const club = r.report.elements.find((e) => e.kind === 'logo');
    const hotel = r.report.elements.find((e) => e.kind === 'sponsor' && e.key === 'sponsor-1');
    const ok1 = club?.variant === 'mono-light-derived' && !club.plated;
    const ok2 = hotel?.variant === 'mono-dark-derived' && !hotel.plated;
    console.log(`${ok1 ? '✓' : '✗'} one-colour club logo on its own colour shows the white version (${club?.variant}${club?.plated ? ', plated' : ''})`);
    console.log(`${ok2 ? '✓' : '✗'} white-only partner on the white band shows the dark version (${hotel?.variant}${hotel?.plated ? ', plated' : ''})`);
    if (!ok1) failures++;
    if (!ok2) failures++;
  }

  // The pipeline's pure steps: a plan as the art director would send it, then typed edits.
  if (!only) {
    const input: DirectorInput = {
      brief: 'Polio vaccination drive this Saturday 14 December at Kawempe Health Centre, 8am to 5pm. We need volunteers.',
      kit,
      format: 'portrait',
      photos: photos.map((p) => ({ slot: p })),
      sponsors: sponsors.slice(0, 3),
      campaignLogoIds: ['campaign'],
      designs: BUILTIN_DESIGNS,
      count: 4,
      today: new Date('2026-12-08T09:00:00Z')
    };
    const plan: DirectorPlan = {
      copy: {
        eyebrow: 'National Immunisation Days',
        headline: 'Every child.\nEvery dose.',
        subhead: 'Help health workers reach every child under five with the polio vaccine.',
        details: [
          { kind: 'date', text: 'Sat 14 December' },
          { kind: 'time', text: '8:00 am – 5:00 pm' },
          { kind: 'place', text: 'Kawempe Health Centre IV' }
        ],
        cta: 'Volunteer with us',
        badge: { top: 'Sat', main: '14', bottom: 'Dec' }
      },
      options: [
        { design: 'hero-photo', params: { shade: 0.9, focusY: 0.4 }, photos: [1], why: 'The photo carries it.' },
        { design: 'split-panel', params: { slope: 10, panel: 'secondary' }, photos: [1] },
        { design: 'art-led', background: true },
        { design: 'no-such-design' }
      ],
      background_prompt: 'sunrise over hills'
    };
    const options = plannedDocs(plan, input, background);
    const ok = options.length === 3 && options[0].doc.params.shade === 0.9 && options[1].doc.params.panel === 'secondary' && !!options[2].doc.background && options[0].doc.sponsors.length === 3;
    console.log(`${ok ? '✓' : '✗'} plan → ${options.length} options (${options.map((o) => o.design.id).join(', ')})`);
    if (!ok) failures++;
    for (const o of options) {
      const r = await renderDesign(o.design, o.doc, kit, loader, { scale: 1 });
      fs.writeFileSync(path.join(out, `plan--${o.design.id}.png`), r.file);
      if (hasErrors(r.report.issues)) {
        failures++;
        console.log(`✗ plan option ${o.design.id}: ${r.report.issues.map((i) => i.message).join(' ')}`);
      }
    }
    const fallback = plannedDocs(planWithoutAI(input), input, null);
    console.log(`${fallback.length ? '✓' : '✗'} plan without AI → ${fallback.length} options`);
    if (!fallback.length) failures++;

    const first = options[0].doc;
    const edited = applyEdits(
      first,
      [
        { op: 'headline_size', scale: 1.15 },
        { op: 'swap_colours' },
        { op: 'set_text', field: 'cta', value: 'Join the drive' },
        { op: 'remove_sponsor', name: 'acacia' },
        { op: 'set_param', key: 'shade', value: 5 },
        { op: 'switch_design', design: 'nope' } as any
      ],
      BUILTIN_DESIGNS
    );
    const e = edited.doc;
    const editOk = e.tweaks?.headlineScale === 1.15 && e.tweaks?.colorSwap === true && e.text.cta === 'Join the drive' && e.sponsors.length === 2 && e.params.shade === 0.95 && e.designId === 'hero-photo' && first.text.cta === 'Volunteer with us';
    console.log(`${editOk ? '✓' : '✗'} edits: ${edited.changed.join(', ')}`);
    if (!editOk) failures++;
    const switched = applyEdits(first, [{ op: 'switch_design', design: 'split-panel' }, { op: 'change_format', format: 'square' }], BUILTIN_DESIGNS).doc;
    const typed = applyTextEdits(switched, { headline: 'Every child counts', eyebrow: '' });
    const r2 = await renderDesign(BUILTIN_DESIGNS.find((d) => d.id === 'split-panel')!, typed, kit, loader, { scale: 1 });
    fs.writeFileSync(path.join(out, 'edit--split-square.png'), r2.file);
    const typedOk = typed.designId === 'split-panel' && typed.format === 'square' && typed.text.headline === 'Every child counts' && !typed.text.eyebrow && !hasErrors(r2.report.issues);
    console.log(`${typedOk ? '✓' : '✗'} switch design + format + typed text`);
    if (!typedOk) failures++;
    const refused = applyEdits(first, [{ op: 'refuse', reason: 'Logos stay in their official colours.' }], BUILTIN_DESIGNS);
    console.log(`${refused.refused && !refused.changed.length ? '✓' : '✗'} hard-rule refusal`);
    if (!refused.refused) failures++;
    const copy = cleanCopy({ headline: '  **Every**  child  ', details: [{ kind: 'nonsense', text: 'x' }], badge: { main: '' } });
    const copyOk = copy.headline === 'Every child' && copy.details?.[0].kind === 'info' && !copy.badge;
    console.log(`${copyOk ? '✓' : '✗'} copy cleaning`);
    if (!copyOk) failures++;
    const req = buildToolRequest({ apiKey: 'x', model: 'claude-sonnet-5-5', system: 'S', context: 'C', prompt: 'P', images: [{ mediaType: 'image/jpeg', base64: 'AA', label: 'Photo 1:' }], tool: DIRECTOR_TOOL });
    const reqOk = req.tool_choice.name === DIRECTOR_TOOL.name && req.system.length === 2 && (req.system[1] as any).cache_control && req.messages[0].content.length === 3;
    console.log(`${reqOk ? '✓' : '✗'} Claude request shape`);
    if (!reqOk) failures++;
  }

  await closeRenderer();
  if (smallPhoto) console.log(`\n(${smallPhoto} render(s) where the test photo is too small for the paper: expected with small test photos.)`);
  console.log(failures ? `\n${failures} problem(s).` : '\nAll designs rendered cleanly.');
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await closeRenderer();
  process.exit(1);
});

/** Cuts each field to the design's limit at a word, the way a copywriter would shorten it. */
function withinLimits(text: DesignText, design: DesignTemplate): DesignText {
  const out: DesignText = { ...text };
  for (const f of design.fields) {
    const v = (out as any)[f.name];
    // The headline stays whole (cutting it mid-phrase reads wrongly); designs shrink it to fit.
    if (f.name === 'headline' || !f.max || typeof v !== 'string' || v.length <= f.max) continue;
    const words = v.replace(/\s+/g, ' ').split(' ');
    let cut = '';
    for (const w of words) {
      if ((cut ? cut.length + 1 : 0) + w.length > f.max) break;
      cut = cut ? `${cut} ${w}` : w;
    }
    (out as any)[f.name] = cut.replace(/[,;:–-]+$/, '');
  }
  return out;
}
