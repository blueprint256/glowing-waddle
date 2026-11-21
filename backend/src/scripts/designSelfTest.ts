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
import { roomierSettings, validateTemplate, withinLimits } from '../design/template';
import { stressTest } from '../design/stressTest';
import { designFromImport, IMPORT_SYSTEM } from '../design/importer';
import { designFileUrls } from '../design/files';
import { buildTestKit, preparedWithVersions, testBackground, testDoc, testPhoto, SAMPLE_TEXT } from '../design/testKit';
import type { DesignTemplate, DesignText, FormatId, PhotoSlot } from '../design/types';
import { checkScore, hasErrors } from '../design/checks';
import { plannedDocs, planWithoutAI, cleanCopy, type DirectorInput, type DirectorPlan } from '../design/director';
import { applyEdits, applyTextEdits } from '../design/edits';
import { buildToolRequest, callClaudeTool } from '../design/claude';
import { DIRECTOR_TOOL, factsInBrief, voiceText } from '../design/director';
import { FONT_DIR, fontFormatOf, fontStack, customFontFaceCss } from '../design/fonts';
import { buildPage } from '../design/page';

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
        ['long-6', 'long', 6],
        // Designs that work without a photo are also made without one ("no photo chosen").
        ...(design.photos.min === 0 ? ([['nophoto-3', 'typical', 3]] as [string, keyof typeof SAMPLE_TEXT, number][]) : [])
      ];
      for (const [name, textKey, sponsorCount] of cases) {
        const photo = photos[(name.length + format.length) % photos.length];
        const usePhotos = name.startsWith('nophoto') ? [] : (name === 'long-6' && design.photos.max >= 2 ? [photo, photos[(photos.indexOf(photo) + 1) % photos.length]] : [photo]).slice(0, design.photos.max);
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
    const words = { ...SAMPLE_TEXT.typical, subhead: 'Join our volunteers as we help health' };
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

  // The design library's import path, without the AI: a design as the importer would send it goes
  // through the parser and the stress test; a broken one is refused before anything renders.
  if (!only || only.includes('import')) {
    const asImported = designFromImport(JSON.parse(JSON.stringify({ ...BUILTIN_DESIGNS.find((d) => d.id === 'recap')!, id: 'Imported Recap!', notes: 'test' })));
    const st = await stressTest(asImported, { formats: ['portrait', 'square'] });
    const okImport = asImported.id === 'imported-recap' && !st.invalid.length && st.failed === 0 && st.passed === 6 && st.cases.length === 8 && st.cases.every((c) => c.preview.length > 1000);
    console.log(`${okImport ? '✓' : '✗'} imported design: parsed, ${st.passed} passed, ${st.failed} failed${st.problems.length ? ' (' + st.problems[0] + ')' : ''}`);
    if (!okImport) failures++;
    const broken = designFromImport({ id: 'broken', name: 'Broken', formats: ['portrait'], fields: [{ name: 'headline' }], photos: { min: 0, max: 0 }, sponsors: { max: 0 }, background: 'none', params: [], html: '<div><script>alert(1)</script></div>', css: '' });
    const sb = await stressTest(broken);
    const okBroken = sb.invalid.length > 0 && !sb.cases.length;
    console.log(`${okBroken ? '✓' : '✗'} broken design refused: ${sb.invalid.slice(0, 2).join(' ')}`);
    if (!okBroken) failures++;
    // The sweep keeps every file a poster refers to.
    const keys = new Set<string>();
    const base = 'https://bucket.s3.amazonaws.com/';
    designFileUrls({ doc: { background: { url: base + 'design-backgrounds/a.jpeg' }, photos: [{ cutout: { url: base + 'design-cutouts/b.png' } }, {}] }, pdf_a4: base + 'post-prints/c.pdf' }, keys);
    console.log(`${keys.size === 3 ? '✓' : '✗'} sweep sees a poster’s background, cut-out and print file (${[...keys].join(', ')})`);
    if (keys.size !== 3) failures++;
    const sys = IMPORT_SYSTEM.length;
    console.log(`${sys > 5000 && sys < 60000 ? '✓' : '✗'} importer guide (${sys} characters, with the worked example)`);
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

    // Two options that would look the same are one option; a real difference keeps both.
    const twin = { copy: { headline: 'Same' }, options: [{ design: 'art-led' }, { design: 'art-led' }, { design: 'art-led', params: { ground: 'dark' } }] } as any;
    const twins = plannedDocs(twin, { ...input, photos: [] }, null);
    const artParams = BUILTIN_DESIGNS.find((d) => d.id === 'art-led')!.params.map((p) => p.key);
    console.log(`✓ look-alike options dropped (${twins.length} of 3 kept; art-led settings: ${artParams.join(', ')})`);
    if (twins.length < 1 || twins.length > 2) failures++;

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
    const stats = cleanCopy({ headline: 'x', stats: [{ value: '312', label: 'children vaccinated' }, { value: 'many', label: 'smiles' }] }).stats || [];
    const copyOk = copy.headline === 'Every child' && copy.details?.[0].kind === 'info' && !copy.badge && stats.length === 1 && stats[0].value === '312';
    console.log(`${copyOk ? '✓' : '✗'} copy cleaning`);
    if (!copyOk) failures++;
    const req = buildToolRequest({ apiKey: 'x', model: 'claude-sonnet-5-5', system: 'S', context: 'C', prompt: 'P', images: [{ mediaType: 'image/jpeg', base64: 'AA', label: 'Photo 1:' }], tool: DIRECTOR_TOOL });
    const reqOk = req.tool_choice.type === 'auto' && req.tools[0].name === DIRECTOR_TOOL.name && String((req.messages[0].content.slice(-1)[0] as any).text).includes(`calling the ${DIRECTOR_TOOL.name} tool`) && req.system.length === 2 && (req.system[1] as any).cache_control && req.messages[0].content.length === 3;
    console.log(`${reqOk ? '✓' : '✗'} Claude request shape`);
    if (!reqOk) failures++;
  }

  // Uploaded fonts: recognised from their bytes, given a family of their own and used on the poster.
  {
    const marker = fs.readFileSync(path.join(FONT_DIR, 'permanentmarker', 'PermanentMarker-Regular.ttf'));
    const url = 'https://files.test/brand-fonts/marker.ttf';
    files.set(url, marker);
    const custom = [{ id: 'custom-abc12345', name: 'Our Marker', category: 'script' as const, files: [{ url, style: 'normal' as const, weight: '400', format: 'truetype' as const }] }];
    const formatsOk = fontFormatOf(marker) === 'truetype' && fontFormatOf(Buffer.from('wOF2xxxxxxxxxxxx')) === 'woff2' && fontFormatOf(Buffer.from('<html>not a font')) === null;
    const stackOk = fontStack('custom-abc12345', custom).startsWith('"Brand custom-abc12345"') && fontStack('custom-gone0000', custom).includes('Open Sans');
    const css = customFontFaceCss(['custom-abc12345'], custom, () => 'https://design.local/a/9');
    const cssOk = css.includes('font-family:"Brand custom-abc12345"') && css.includes('url("https://design.local/a/9") format("truetype")');
    const design = BUILTIN_DESIGNS.find((d) => d.id === 'bold-event') || BUILTIN_DESIGNS[0];
    const doc = testDoc(design.id, 'portrait', withinLimits(SAMPLE_TEXT.typical, design), design.photos.min ? [photos[0]] : [], []);
    const ownKit = { ...kit, fonts: { ...kit.fonts, display: 'custom-abc12345' }, customFonts: custom };
    const page = buildPage(design, doc, ownKit as any, (u: string) => `https://design.local/x/${encodeURIComponent(u)}`);
    const pageHtml = page.html;
    const pageOk = pageHtml.includes('Brand custom-abc12345') && pageHtml.includes(encodeURIComponent(url));
    const plain = await renderDesign(design, doc, kit, loader, { scale: 1 });
    const own = await renderDesign(design, doc, ownKit as any, loader, { scale: 1 });
    fs.writeFileSync(path.join(out, 'custom-font.png'), own.file);
    const differs = Buffer.compare(plain.file, own.file) !== 0;
    const fontOk = formatsOk && stackOk && cssOk && pageOk && differs && !hasErrors(own.report.issues);
    console.log(`${fontOk ? '✓' : '✗'} uploaded font: detected ${formatsOk}, stack ${stackOk}, css ${cssOk}, page ${pageOk}, poster changes ${differs}, checks ${own.report.issues.filter((i) => i.level === 'error').map((i) => i.code).join(',') || 'clean'}`);
    if (!fontOk) failures++;
  }

  // Current Claude models refuse forced tool use: the call offers the tool ("auto") and, if the
  // model answers in words, asks once more.
  {
    const sent: any[] = [];
    const replies = [
      { content: [{ type: 'text', text: 'Here is my plan…' }], usage: { input_tokens: 10, output_tokens: 5 } },
      { content: [{ type: 'tool_use', name: 'plan', input: { ok: 1 } }], usage: { input_tokens: 12, output_tokens: 7 } }
    ];
    const fetchImpl = async (_url: string, init: any) => {
      sent.push(JSON.parse(init.body));
      const r = replies.shift()!;
      return { ok: true, status: 200, text: async () => JSON.stringify(r) } as any;
    };
    const out = await callClaudeTool<{ ok: number }>({ apiKey: 'k', model: 'claude-sonnet-5-5', system: 'S', prompt: 'P', tool: { name: 'plan', description: 'd', schema: { type: 'object' } }, fetchImpl });
    const retryOk = out.input.ok === 1 && sent.length === 2 && sent.every((b) => b.tool_choice.type === 'auto') && sent[1].messages.length === 3 && out.usage.input === 22 && out.usage.output === 12;
    console.log(`${retryOk ? '✓' : '✗'} Claude call without forced tool use (and one retry)`);
    if (!retryOk) failures++;
  }

  // Without the art director, the brief's poster facts still become the poster's words.
  {
    const brief = 'Invite the community to our clean-water open day. Families see the new borehole.\n\nPoster facts:\n- Headline idea: Clean water, open to all\n- Date: Saturday 5 December\n- Time: 9:00 am – 1:00 pm\n- Place: Nakawa Community Centre\n- Figures: 1,200 families served this year';
    const f = factsInBrief(brief);
    const plan = planWithoutAI({ brief, format: 'portrait', photos: [], sponsors: [], designs: BUILTIN_DESIGNS, count: 2, kit } as any);
    const c = plan.copy;
    const ok =
      f.headline === 'Clean water, open to all' && f.place === 'Nakawa Community Centre' && !/Poster facts|Headline idea/.test(f.text) &&
      c.headline === 'Clean water, open to all' && c.subhead?.startsWith('Invite the community') && !/Poster facts|Date:/.test(c.subhead || '') &&
      c.details?.map((d) => d.kind).join() === 'date,time,place' && c.stats?.[0]?.value === '1,200' && c.stats?.[0]?.label === 'families served this year' &&
      plan.options[0]?.design === 'bold-event';
    console.log(`${ok ? '✓' : '✗'} plan without AI uses the poster facts (${c.headline} · ${plan.options.map((o) => o.design).join(', ')})`);
    if (!ok) failures++;
  }

  // Concept-first: a blueprint read from a concept becomes a valid design; the repair step fixes
  // what the checks find (here: text colour, then a panel).
  {
    const { cleanBlueprint, conceptTemplate, repairBlueprint } = await import('../design/concept');
    const { validateTemplate } = await import('../design/template');
    const bp = cleanBlueprint(
      { regions: [{ role: 'headline', x: 6, y: 20, w: 80, h: 20, color: 'primary' }, { role: 'partners', x: 0, y: 86, w: 100, h: 12 }, { role: 'photo', x: 0, y: 0, w: 100, h: 50 }, { role: 'nonsense', x: 1, y: 1, w: 1, h: 1 }], photoUse: 'keep', copy: { headline: 'Clean water', cta: 'Join' } },
      { partners: 3, photos: 1 }
    );
    const t = conceptTemplate(bp, 'concept-selftest', 'portrait');
    const fixed1 = repairBlueprint(bp, [{ level: 'error', code: 'contrast', key: 'headline' }]);
    const fixed2 = fixed1 && repairBlueprint(fixed1, [{ level: 'error', code: 'contrast', key: 'headline' }]);
    const head = (b: any) => b.regions.find((r: any) => r.role === 'headline');
    const ok =
      !validateTemplate(t).length &&
      bp.regions.some((r) => r.role === 'logo') && !bp.regions.some((r) => r.role === 'photo') &&
      t.formats.join() === 'portrait,a4,a3' &&
      head(fixed1).color === 'auto' && head(fixed2).panel === 'ink' && repairBlueprint(bp, []) === null;
    console.log(`${ok ? '✓' : '✗'} concept blueprint → design, and its repair`);
    if (!ok) failures++;
  }

  // The brand's own words reach the art director.
  {
    const v = voiceText({ about: 'A Kampala café', tone: 'Warm', rules: 'Say “Ugandan coffee”' });
    const vOk = v.includes('What the brand does: A Kampala café') && v.includes('Tone of voice: Warm') && v.includes('Always and never') && voiceText(null) === '' && voiceText({}) === '';
    console.log(`${vOk ? '✓' : '✗'} brand voice for the art director`);
    if (!vOk) failures++;
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

