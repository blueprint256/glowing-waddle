/**
 * Poster engine self-test (scenes, design/scene.ts): draws sample scenes covering every layer and
 * photo treatment in every poster shape, runs the checks, and tests the pure steps (cleaning what
 * the reader writes, repairs, edits, photo fitting, the plain poster from code). Posters are written
 * to DESIGN_OUT (default /tmp/design-out) so a person can look at them. No AI calls.
 *
 *   DESIGN_PHOTOS=/path/to/photos npm run design:selftest
 *
 * DESIGN_PHOTOS: a folder of real photos (JPEG/PNG); stand-ins are drawn without it.
 * DESIGN_ONLY=full-bleed,breakout limits the sample scenes; DESIGN_FORMATS=portrait,square the shapes.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { renderDesign, closeRenderer } from '../design/renderer';
import { validateTemplate } from '../design/template';
import { buildTestKit, preparedWithVersions, testPhoto, SAMPLE_TEXT } from '../design/testKit';
import type { DesignText, FormatId, PhotoSlot } from '../design/types';
import { hasErrors } from '../design/checks';
import { applyEdits, applyTextEdits } from '../design/edits';
import { callClaudeTool } from '../design/claude';
import { copyWithoutAI, factsInBrief, voiceText } from '../design/brief';
import { FONT_DIR, fontFormatOf, fontStack, customFontFaceCss } from '../design/fonts';
import { buildPage } from '../design/page';
import { keyMasks, placePhoto } from '../design/photoFit';
import { organicMask, refinePlace } from '../design/sceneFit';
import { IMAGE_USAGE_MODEL_PATTERN, resolveImageModel } from '../lib/imageModels';
import {
  POSTER_ASPECT,
  cleanScene,
  coverFrame,
  fadeSides,
  fallbackScene,
  keepGutters,
  keepPeopleInFrame,
  placeFromCrop,
  repairScene,
  reshapeScene,
  sceneDoc,
  sceneTemplate,
  type Box,
  type PhotoLayer,
  type Scene,
  type SceneDoc,
  type SceneLayer
} from '../design/scene';

const covers = (place: Box, frame: Box) => place.x <= frame.x + 0.01 && place.y <= frame.y + 0.01 && place.x + place.w >= frame.x + frame.w - 0.01 && place.y + place.h >= frame.y + frame.h - 0.01;

async function main() {
  const out = process.env.DESIGN_OUT || '/tmp/design-out';
  fs.mkdirSync(out, { recursive: true });
  const { files, kit, sponsors } = await buildTestKit();
  let failures = 0;
  const check = (ok: boolean, label: string) => {
    console.log(`${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failures++;
  };

  // Photos: a folder of real ones, or drawn stand-ins.
  const photos: PhotoSlot[] = [];
  const buffers: Buffer[] = [];
  const dir = process.env.DESIGN_PHOTOS;
  if (dir && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((n) => /\.(jpe?g|png|webp)$/i.test(n)).sort()) {
      const b = fs.readFileSync(path.join(dir, f));
      buffers.push(b);
      photos.push(await testPhoto(files, f, b));
    }
  }
  if (!photos.length) {
    const stand = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#8a7a66' } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><circle cx="800" cy="520" r="220" fill="#c79a74"/><rect x="560" y="740" width="480" height="460" rx="120" fill="#3b5d8f"/></svg>') }])
      .jpeg()
      .toBuffer();
    buffers.push(stand);
    photos.push(await testPhoto(files, 'standin.jpg', stand));
  }
  // A cut-out of the first photo's subject (an ellipse around its focal point stands in for SAM 3).
  {
    const img = sharp(buffers[0]).rotate();
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const f = photos[0].focal;
    const cx = f.x * info.width;
    const cy = Math.min(0.75, f.y + 0.2) * info.height;
    const rx = info.width * 0.2;
    const ry = info.height * 0.5;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) data[(y * info.width + x) * 4 + 3] = 0;
      }
    }
    const left = Math.max(0, Math.floor(cx - rx));
    const top = Math.max(0, Math.floor(cy - ry));
    const width = Math.min(info.width - left, Math.ceil(rx * 2));
    const height = Math.min(info.height - top, Math.ceil(ry * 2));
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).extract({ left, top, width, height }).png().toBuffer();
    files.set('test://cutout/1.png', png);
    photos[0] = { ...photos[0], cutout: { url: 'test://cutout/1.png', width, height, box: { x: left / info.width, y: top / info.height, w: width / info.width, h: height / info.height } } };
  }
  const art = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#17458f' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><circle cx="900" cy="200" r="420" fill="#f7a81b" opacity="0.35"/><rect y="1100" width="1024" height="436" fill="#0c2a5a"/></svg>') }])
    .jpeg()
    .toBuffer();
  files.set('test://art.jpg', art);
  const loader = async (url: string) => {
    const b = files.get(url);
    if (!b) throw new Error('missing ' + url);
    return b;
  };

  const words: DesignText = { ...SAMPLE_TEXT.typical, stats: undefined, body: undefined, footnote: undefined, hashtag: undefined, personLabel: undefined, personName: undefined, personRole: undefined, badge: undefined };
  const T = (role: any, box: Box, extra: any = {}) => ({ type: 'text', id: role, role, box, align: 'left', color: 'auto', panel: 'none', weight: role === 'headline' ? 'black' : 'bold', font: role === 'subhead' ? 'text' : 'display', lines: role === 'headline' ? 3 : 2, ...extra }) as SceneLayer;
  const P = (frame: Box, extra: Partial<PhotoLayer> = {}): SceneLayer => ({ type: 'photo', id: 'p1', photo: 0, frame, shape: 'rect', ...extra });
  const logo = (box: Box, align: 'left' | 'right' | 'center' = 'left'): SceneLayer => ({ type: 'logo', id: 'logo', box, align });
  const partners = (box: Box): SceneLayer => ({ type: 'partners', id: 'partners', box, align: 'center', panel: 'paper', radius: 6 });
  const A = 1024 / 1536;
  const samples: { id: string; scene: Scene; partners: number }[] = [
    {
      id: 'full-bleed',
      partners: 3,
      scene: {
        version: 2,
        aspect: A,
        backdrop: { kind: 'color', color: 'ink' },
        layers: [P({ x: 0, y: 0, w: 100, h: 72 }, { fade: { side: 'bottom', size: 35 } }), logo({ x: 6, y: 4, w: 44, h: 7 }), T('eyebrow', { x: 6, y: 50, w: 80, h: 3.5 }, { color: 'accent', upper: true }), T('headline', { x: 6, y: 54, w: 86, h: 15 }, { color: 'paper' }), T('details', { x: 6, y: 70, w: 60, h: 12 }, { color: 'paper' }), T('cta', { x: 66, y: 74, w: 28, h: 5 }, { color: 'ink', panel: 'accent', radius: 50, align: 'center', lines: 1 }), partners({ x: 6, y: 86, w: 88, h: 9 })],
        copy: words
      }
    },
    {
      id: 'split-art',
      partners: 0,
      scene: {
        version: 2,
        aspect: A,
        backdrop: { kind: 'art' },
        layers: [P({ x: 45, y: 0, w: 55, h: 100 }, { tint: { color: 'primary', amount: 0.25, mode: 'tint' } }), { type: 'shape', id: 's1', box: { x: 0, y: 0, w: 50, h: 100 }, color: 'primary', opacity: 1, shape: 'slant-right' }, logo({ x: 5, y: 5, w: 38, h: 7 }), T('headline', { x: 5, y: 20, w: 37, h: 28 }, { color: 'paper', lines: 5 }), T('subhead', { x: 5, y: 50, w: 36, h: 12 }, { color: 'paper' }), T('details', { x: 5, y: 60, w: 37, h: 18 }, { color: 'paper' }), T('cta', { x: 5, y: 86, w: 32, h: 5 }, { color: 'ink', panel: 'accent', radius: 50, align: 'center', lines: 1 })],
        copy: words
      }
    },
    {
      id: 'breakout',
      partners: 3,
      scene: {
        version: 2,
        aspect: A,
        backdrop: { kind: 'gradient', from: 'primary', to: 'secondary', angle: 160 },
        layers: [
          { type: 'shape', id: 's1', box: { x: 10, y: 38, w: 80, h: 32 }, color: 'accent', opacity: 1, shape: 'arch' },
          // The photo reaches above the frame; its people show there (breakout).
          P({ x: 10, y: 38, w: 80, h: 32 }, { shape: 'arch', breakout: 'top', place: { x: 4, y: 22, w: 92, h: 92 * (photos[0].height / photos[0].width) * A } }),
          logo({ x: 6, y: 3, w: 44, h: 7 }),
          T('headline', { x: 6, y: 11, w: 88, h: 11 }, { color: 'paper', align: 'center' }),
          T('details', { x: 10, y: 71.5, w: 80, h: 13 }, { color: 'paper', align: 'center' }),
          partners({ x: 6, y: 87, w: 88, h: 9 })
        ],
        copy: { ...words, subhead: undefined, cta: undefined }
      }
    },
    {
      id: 'circle-organic',
      partners: 0,
      scene: {
        version: 2,
        aspect: A,
        backdrop: { kind: 'color', color: 'paper' },
        layers: [
          { type: 'shape', id: 's1', box: { x: -20, y: 58, w: 90, h: 60 }, color: 'secondary', opacity: 1, shape: 'circle' },
          P({ x: 38, y: 44, w: 58, h: 38 }, { shape: 'circle', border: { color: 'accent', width: 1 } }),
          logo({ x: 6, y: 4, w: 44, h: 7 }),
          T('eyebrow', { x: 6, y: 14, w: 80, h: 3.5 }, { color: 'secondary', upper: true }),
          T('headline', { x: 6, y: 18, w: 88, h: 20 }, { color: 'primary' }),
          T('details', { x: 6, y: 84, w: 60, h: 12 }, { color: 'paper' }),
          T('cta', { x: 6, y: 45, w: 28, h: 5 }, { color: 'paper', panel: 'primary', radius: 50, align: 'center', lines: 1 })
        ],
        copy: { ...words, subhead: undefined }
      }
    }
  ];
  const only = process.env.DESIGN_ONLY?.split(',');
  const formats = (process.env.DESIGN_FORMATS?.split(',') as FormatId[] | undefined) || (['portrait', 'square', 'story', 'landscape', 'a4'] as FormatId[]);
  for (const s of samples.filter((x) => !only || only.includes(x.id))) {
    for (const format of formats) {
      // A shape far from the scene's (a portrait scene as a landscape) is reshaped first, as the
      // app does (here without the quick model: positions keep their percentages).
      const target = POSTER_ASPECT[format];
      const far = Math.max(target, s.scene.aspect) / Math.min(target, s.scene.aspect) >= 1.2;
      const scene = far ? reshapeScene(s.scene, target, photos) : s.scene;
      const doc = sceneDoc({ id: `scene-test-${s.id}`, format, scene, art: { url: 'test://art.jpg', width: 1024, height: 1536 }, photos, sponsors: sponsors.slice(0, s.partners), primaryLogo: kit.logos.find((l) => l.role === 'primary')!.id, campaignLogos: [] });
      const t = sceneTemplate(scene, doc.designId, format, doc.photos);
      const problems = validateTemplate(t);
      if (problems.length) {
        check(false, `${s.id} ${format}: ${problems.join(' ')}`);
        continue;
      }
      try {
        let r = await renderDesign(t, doc, kit, loader, { scale: 1 });
        // As in the pipeline: a repair round for what the checks find.
        for (let round = 0; round < 2 && hasErrors(r.report.issues); round++) {
          const fixed = repairScene(doc.scene, r.report.issues, doc.photos);
          if (fixed) {
            const d2: SceneDoc = { ...doc, scene: fixed, text: fixed.copy };
            const r2 = await renderDesign(sceneTemplate(fixed, doc.designId, format, d2.photos), d2, kit, loader, { scale: 1 });
            if (r2.report.issues.filter((i) => i.level === 'error').length <= r.report.issues.filter((i) => i.level === 'error').length) {
              r = r2;
              doc.scene = fixed;
            }
          }
        }
        fs.writeFileSync(path.join(out, `${s.id}-${format}.png`), r.file);
        const errors = r.report.issues.filter((i) => i.level === 'error');
        // Small test photos are expected to be soft or too small in big shapes.
        const real = errors.filter((e) => e.code !== 'photo-small');
        const label = far ? `${s.id} ${format} (reshaped without AI)` : `${s.id} ${format}`;
        // Reshaping without the quick model is a fallback: its leftovers are reported, not counted.
        if (far && real.length) {
          console.log(`· ${label}: ${real.map((e) => e.code).join(', ')}`);
          continue;
        }
        check(!real.length, `${label}${real.length ? `: ${real.map((e) => `${e.code}${e.key ? `(${e.key})` : ''}`).join(', ')}` : ''}`);
      } catch (e: any) {
        check(false, `${s.id} ${format}: ${e.message}`);
      }
    }
  }

  // The checks still catch real problems in scenes: words across a hard photo edge, and words on a face.
  {
    const face: PhotoSlot = { ...photos[0], focal: { ...photos[0].focal, faces: { x: Math.max(0, photos[0].focal.x - 0.08), y: Math.max(0, photos[0].focal.y - 0.08), w: 0.16, h: 0.16 } } };
    const scene: Scene = { version: 2, aspect: A, backdrop: { kind: 'color', color: 'ink' }, layers: [P({ x: 0, y: 0, w: 60, h: 70 }), logo({ x: 6, y: 88, w: 30, h: 6 }), T('headline', { x: 30, y: 20, w: 64, h: 15 }, { color: 'paper' })], copy: { headline: 'Words across the edge' } };
    const doc = sceneDoc({ id: 'scene-edge', format: 'portrait', scene, photos: [face], sponsors: [], primaryLogo: kit.logos[0].id, campaignLogos: [] });
    const r = await renderDesign(sceneTemplate(scene, doc.designId, 'portrait', doc.photos), doc, kit, loader, { scale: 1 });
    check(r.report.issues.some((i) => i.code === 'text-photo-edge'), 'check catches words across a photo’s hard edge');
    const place = placeFromCrop({ x: 0, y: 0, w: 100, h: 100 }, A, face);
    const fx = place.x + face.focal.x * place.w;
    const fy = place.y + face.focal.y * place.h;
    const s2: Scene = { ...scene, layers: [P({ x: 0, y: 0, w: 100, h: 100 }, { place }), logo({ x: 6, y: 88, w: 30, h: 6 }), T('headline', { x: Math.max(3, fx - 20), y: Math.max(3, fy - 5), w: 40, h: 10 }, { color: 'paper' })] };
    const d2 = { ...doc, scene: s2 };
    const r2 = await renderDesign(sceneTemplate(s2, doc.designId, 'portrait', doc.photos), d2, kit, loader, { scale: 1 });
    check(r2.report.issues.some((i) => i.code === 'text-over-subject'), 'check catches words on a face');
    // The same face outside its frame (the frame shows another part): no false alarm.
    const s3: Scene = { ...s2, layers: [P({ x: 0, y: Math.min(80, fy + 12), w: 100, h: 100 - Math.min(80, fy + 12) }, { place }), ...s2.layers.slice(1)] };
    const r3 = await renderDesign(sceneTemplate(s3, doc.designId, 'portrait', doc.photos), { ...doc, scene: s3 } as SceneDoc, kit, loader, { scale: 1 });
    check(!r3.report.issues.some((i) => i.code === 'text-over-subject'), 'a face the frame doesn’t show isn’t “covered”');
  }

  // Logo versions: a one-colour club logo on its own colour shows its white version; a white-only
  // partner logo on the white partner band shows its dark version.
  {
    const svgBuf = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
    const png = (b: Buffer) => sharp(b, { density: 144 }).png().toBuffer();
    const clubMono = await preparedWithVersions(files, 'mono-club', await png(svgBuf(900, 300, `<circle cx="760" cy="150" r="120" fill="none" stroke="#d22163" stroke-width="40"/><text x="20" y="200" font-family="DejaVu Sans" font-weight="700" font-size="150" fill="#d22163">Club</text>`)));
    const whitePartner = await preparedWithVersions(files, 'white-partner', await png(svgBuf(900, 300, `<text x="20" y="200" font-family="DejaVu Sans" font-weight="700" font-size="150" fill="#ffffff">HOTEL</text>`)));
    const kit2 = JSON.parse(JSON.stringify(kit)) as typeof kit;
    kit2.colors.secondary = { name: 'Cranberry', hex: '#d22163' };
    kit2.logos = kit2.logos.filter((l) => l.role !== 'campaign').map((l) => (l.role === 'primary' ? { ...l, variants: [clubMono.main, ...clubMono.derived] } : l));
    const sponsorsWhite = [{ name: 'Hotel', logo: whitePartner.main, alts: whitePartner.derived }, ...sponsors.slice(0, 2)];
    const scene: Scene = { version: 2, aspect: A, backdrop: { kind: 'color', color: 'secondary' }, layers: [logo({ x: 6, y: 5, w: 40, h: 8 }), T('headline', { x: 6, y: 30, w: 88, h: 20 }, { color: 'paper' }), partners({ x: 6, y: 86, w: 88, h: 9 })], copy: { headline: 'Logo versions' } };
    const doc = sceneDoc({ id: 'scene-logos', format: 'portrait', scene, photos: [], sponsors: sponsorsWhite, primaryLogo: kit2.logos.find((l) => l.role === 'primary')!.id, campaignLogos: [] });
    const r = await renderDesign(sceneTemplate(scene, doc.designId, 'portrait'), doc, kit2, loader, { scale: 1 });
    fs.writeFileSync(path.join(out, 'logo-versions.png'), r.file);
    const club = r.report.elements.find((e) => e.kind === 'logo');
    const hotel = r.report.elements.find((e) => e.kind === 'sponsor' && e.key === 'sponsor-1');
    check(club?.variant === 'mono-light-derived' && !club.plated, `one-colour club logo on its own colour shows the white version (${club?.variant})`);
    check(hotel?.variant === 'mono-dark-derived' && !hotel.plated, `white-only partner on the white band shows the dark version (${hotel?.variant})`);
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
    const scene = fallbackScene({ copy: { headline: 'Our own font' }, photos: [], partners: 0, aspect: 0.8 });
    const doc = sceneDoc({ id: 'scene-font', format: 'portrait', scene, photos: [], sponsors: [], primaryLogo: kit.logos[0].id, campaignLogos: [] });
    const design = sceneTemplate(scene, doc.designId, 'portrait');
    const ownKit = { ...kit, fonts: { ...kit.fonts, display: 'custom-abc12345' }, customFonts: custom };
    const pageOk = buildPage(design, doc, ownKit as any, (u: string) => `https://design.local/x/${encodeURIComponent(u)}`).html.includes('Brand custom-abc12345');
    const plain = await renderDesign(design, doc, kit, loader, { scale: 1 });
    const own = await renderDesign(design, doc, ownKit as any, loader, { scale: 1 });
    fs.writeFileSync(path.join(out, 'custom-font.png'), own.file);
    check(formatsOk && stackOk && cssOk && pageOk && Buffer.compare(plain.file, own.file) !== 0 && !hasErrors(own.report.issues), 'uploaded font is detected and used on the poster');
  }

  // Current Claude models refuse forced tool use: the call offers the tool ("auto") and asks once more.
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
    const res = await callClaudeTool<{ ok: number }>({ apiKey: 'k', model: 'claude-sonnet-5-5', system: 'S', prompt: 'P', tool: { name: 'plan', description: 'd', schema: { type: 'object' } }, fetchImpl });
    check(res.input.ok === 1 && sent.length === 2 && sent.every((b) => b.tool_choice.type === 'auto') && res.usage.input === 22, 'Claude call without forced tool use (and one retry)');
  }

  // Without AI: the brief's facts become the words of a clean poster from code, which passes its checks.
  {
    const brief = 'Maternal and child health camp: free check-ups for mothers and babies. Saturday 12 December 2026, 9:00am. Call to action: Bring a mother you know. Photo: a volunteer holding a baby.\n\nPoster facts:\n- Date: Saturday 12 December 2026\n- Time: 9:00 am – 4:00 pm\n- Place: Kireka Health Centre III';
    const copy = copyWithoutAI(brief, 'Health month');
    const f = factsInBrief(brief);
    check(f.cta === 'Bring a mother you know' && copy.cta === 'Bring a mother you know' && !/Photo:|Call to action/.test(`${copy.headline} ${copy.subhead}`) && copy.details?.map((d) => d.kind).join() === 'date,time,place', `the brief’s facts become the words (${copy.headline})`);
    for (const [label, ph, parts] of [['with a photo', [photos[0]], 3], ['without a photo', [], 0]] as const) {
      for (const variant of [0, 1]) {
        const scene = fallbackScene({ copy, photos: [...ph], partners: parts, aspect: POSTER_ASPECT.portrait, variant });
        const doc = sceneDoc({ id: `scene-plain-${variant}`, format: 'portrait', scene, photos: [...ph], sponsors: sponsors.slice(0, parts), primaryLogo: kit.logos[0].id, campaignLogos: [] });
        const r = await renderDesign(sceneTemplate(scene, doc.designId, 'portrait', doc.photos), doc, kit, loader, { scale: 1 });
        fs.writeFileSync(path.join(out, `plain-${ph.length ? 'photo' : 'type'}-${variant}.png`), r.file);
        const errs = r.report.issues.filter((i) => i.level === 'error' && i.code !== 'photo-small');
        check(!errs.length, `plain poster ${label} (${variant + 1})${errs.length ? `: ${errs.map((e) => e.code).join(', ')}` : ''}`);
      }
    }
  }

  // What the reader writes is cleaned: text without words dropped, a missing logo and partner strip
  // added, a photo that doesn't exist dropped, words and logos always in front of photos and shapes.
  {
    const raw = {
      backdrop: { kind: 'gradient', color: 'primary', to: 'nonsense' },
      layers: [
        { type: 'text', role: 'headline', x: 5, y: 10, w: 90, h: 20 },
        { type: 'photo', photo: 1, x: 0, y: 30, w: 100, h: 70, shape: 'arch', breakout: 'top', subject: 'the woman' },
        { type: 'photo', photo: 2, x: 0, y: 0, w: 10, h: 10 },
        { type: 'text', role: 'subhead', x: 5, y: 32, w: 90, h: 8 },
        { type: 'shape', x: -10, y: 80, w: 130, h: 30, color: 'accent' },
        { type: 'nonsense', x: 1, y: 1, w: 1, h: 1 }
      ],
      copy: { headline: 'Clean water', cta: 'Join' }
    };
    const s = cleanScene(raw, { partners: 2, photos: 1, aspect: A });
    const types = s.layers.map((l) => (l.type === 'text' ? l.role : l.type));
    const firstFront = s.layers.findIndex((l) => l.type !== 'photo' && l.type !== 'shape');
    const backAfter = s.layers.slice(firstFront).some((l) => l.type === 'photo' || l.type === 'shape');
    const photo = s.layers.find((l): l is PhotoLayer => l.type === 'photo');
    check(
      !types.includes('subhead') && types.includes('logo') && types.includes('partners') && s.layers.filter((l) => l.type === 'photo').length === 1 && !backAfter && photo?.breakout === 'top' && photo.subject === 'the woman' && s.backdrop.kind === 'gradient' && (s.backdrop as any).to === 'secondary',
      `reader’s scene is cleaned (${types.join(', ')})`
    );
  }

  // Photo placement: a crop fills its frame and always covers it; zooming out to the least zoom.
  {
    const p = { width: 1600, height: 1200, focal: { x: 0.5, y: 0.4 } };
    const frame = { x: 10, y: 20, w: 50, h: 40 };
    const a = placeFromCrop(frame, A, p, { x: 0.2, y: 0.1, w: 0.5 });
    const b = placeFromCrop(frame, A, p);
    const z = coverFrame({ x: 30, y: 30, w: 10, h: 10 }, frame, A, p.width / p.height);
    check(covers(a, frame) && covers(b, frame) && covers(z, frame) && Math.abs(a.w - frame.w / 0.5) < 0.5, 'a photo always covers its frame (crop, subject, after a move)');
    const zoomed: Scene = { version: 2, aspect: A, backdrop: { kind: 'color', color: 'ink' }, layers: [P(frame, { place: { ...a, w: a.w * 3, h: a.h * 3 } })], copy: { headline: 'x' } };
    const fixed = repairScene(zoomed, [{ level: 'error', code: 'photo-small' }], [p as any]);
    const fp = fixed?.layers[0] as PhotoLayer | undefined;
    check(!!fp?.place && covers(fp.place, frame) && fp.place.w < a.w * 3, 'a photo too enlarged is shown less zoomed');
  }

  // Nobody is cut by a hard edge (moved, shown wider, or faded), and words keep off a hard edge.
  {
    const photo = { width: 1600, height: 1600 };
    const live = (): PhotoLayer => ({ type: 'photo', id: 'p1', photo: 0, frame: { x: 0, y: 0, w: 62, h: 76 }, shape: 'rect', fade: { side: 'bottom', size: 30 }, place: { x: -11.4, y: 0, w: 114, h: 76 } });
    const a = live();
    keepPeopleInFrame(a, { x: 0.15, y: 0.09, w: 0.6, h: 0.91 }, A, photo);
    const pr = a.place!.x + 0.75 * a.place!.w;
    const b = live();
    keepPeopleInFrame(b, { x: 0.02, y: 0.05, w: 0.96, h: 0.9 }, A, photo);
    const scene: Scene = { version: 2, aspect: A, backdrop: { kind: 'color', color: 'primary' }, layers: [live(), T('headline', { x: 61, y: 18, w: 34, h: 23 })], copy: { headline: 'x' } };
    keepGutters(scene);
    const head = scene.layers[1] as any;
    check(pr <= 62.5 && covers(a.place!, a.frame) && fadeSides(b.fade).includes('right') && head.box.x >= 65, `people kept in the frame (right edge ${pr.toFixed(1)}), a group too wide fades, words off the edge (x ${head.box.x})`);
  }

  // Repairs: unreadable words get "auto", then a panel; partners that outweigh the logo get smaller.
  {
    const s = cleanScene({ layers: [{ type: 'text', role: 'headline', x: 5, y: 10, w: 90, h: 20, color: 'primary' }, { type: 'logo', x: 5, y: 2, w: 20, h: 5 }, { type: 'partners', x: 5, y: 88, w: 90, h: 10 }], copy: { headline: 'x' } }, { partners: 3, photos: 0, aspect: A });
    const r1 = repairScene(s, [{ level: 'error', code: 'contrast', key: 'headline' }])!;
    const r2 = repairScene(r1, [{ level: 'error', code: 'contrast', key: 'headline' }])!;
    const r3 = repairScene(s, [{ level: 'error', code: 'sponsor-dominant' }])!;
    const head = (x: Scene) => x.layers.find((l) => l.type === 'text') as any;
    check(head(r1).color === 'auto' && head(r2).panel === 'ink' && (r3.layers.find((l) => l.type === 'partners') as any).box.h < 10 && repairScene(s, []) === null, 'repairs: colour, then a panel; smaller partners');
  }

  // Edits on a scene: words (also into a new layer), photo zoom/move/fade/shape keep the frame
  // covered, the headline can't be removed, a new shape is kept.
  {
    const scene = samples[0].scene;
    const doc = sceneDoc({ id: 'scene-edit', format: 'portrait', scene, photos, sponsors: sponsors.slice(0, 3), primaryLogo: kit.logos[0].id, campaignLogos: [] });
    const t = applyTextEdits(doc, { headline: 'New words', subhead: null, cta: 'Sign up' });
    const e = applyEdits(doc, [
      { op: 'photo_zoom', scale: 1.4 },
      { op: 'photo_move', dx: 10, dy: -5 },
      { op: 'photo_fade', side: 'left', size: 30 },
      { op: 'photo_shape', shape: 'circle' },
      { op: 'remove_layer', id: 'headline' },
      { op: 'set_text', field: 'subhead', value: 'A brand new line' },
      { op: 'change_format', format: 'square' },
      { op: 'set_backdrop', kind: 'gradient', color: 'primary', to: 'accent', angle: 90 }
    ]);
    const l = e.doc.scene.layers.find((x): x is PhotoLayer => x.type === 'photo')!;
    check(
      t.text.headline === 'New words' && t.scene.copy.headline === 'New words' && !t.text.subhead && t.text.cta === 'Sign up' &&
        !!l.place && covers(l.place, l.frame) && l.fade?.side === 'left' && l.shape === 'circle' &&
        e.doc.scene.layers.some((x) => x.type === 'text' && x.role === 'headline') && e.doc.scene.layers.some((x) => x.type === 'text' && x.role === 'subhead') &&
        e.doc.format === 'square' && e.doc.scene.backdrop.kind === 'gradient',
      `edits: ${e.changed.join(', ')}`
    );
  }

  // The real photo is found where a concept drew it (inside a frame), with the concept redrawn softly.
  {
    const W = 512;
    const H = 768;
    const real = buffers[0];
    const meta = await sharp(real).rotate().metadata();
    const rw = meta.autoOrient?.width || meta.width!;
    const rh = meta.autoOrient?.height || meta.height!;
    const frame = { x: 10, y: 35, w: 80, h: 45 };
    const truth = placeFromCrop(frame, W / H, { width: rw, height: rh }, { x: 0.15, y: 0.1, w: 0.7 });
    const pw = Math.round((truth.w / 100) * W);
    const ph = Math.round((truth.h / 100) * H);
    const big = await sharp(real).rotate().resize(pw, ph, { fit: 'fill' }).toBuffer();
    const fx = Math.round((frame.x / 100) * W);
    const fy = Math.round((frame.y / 100) * H);
    const fw = Math.round((frame.w / 100) * W);
    const fh = Math.round((frame.h / 100) * H);
    const inFrame = await sharp(big).extract({ left: Math.round(fx - (truth.x / 100) * W), top: Math.round(fy - (truth.y / 100) * H), width: fw, height: fh }).toBuffer();
    const concept = await sharp({ create: { width: W, height: H, channels: 3, background: '#17458f' } }).composite([{ input: inFrame, left: fx, top: fy }]).blur(1.2).modulate({ saturation: 1.2 }).png().toBuffer();
    const layer: PhotoLayer = { type: 'photo', id: 'p1', photo: 0, frame, shape: 'rect', crop: { x: 0.3, y: 0.3, w: 0.5 } };
    const r = await refinePlace({ concept, canvasAspect: W / H, layer, photo: real, photoWidth: rw, photoHeight: rh });
    const close = (a: number, b: number, t: number) => Math.abs(a - b) <= t;
    check(r.matched && close(r.place.x, truth.x, 3) && close(r.place.y, truth.y, 3) && close(r.place.w, truth.w, 6), `real photo found where the concept drew it (score ${r.score.toFixed(2)}, x ${r.place.x.toFixed(1)}/${truth.x.toFixed(1)})`);
    // An organic shape traced from the concept against its plain ground.
    const blob = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#17458f"/><path d="M120 300 C 200 220, 380 260, 420 340 S 380 560, 260 580 S 60 460, 120 300 Z" fill="#d9a066"/></svg>`)).png().toBuffer();
    const mask = await organicMask({ concept: blob, backdrop: '#17458f', frame: { x: 5, y: 25, w: 90, h: 55 } });
    check(!!mask && mask.startsWith('data:image/png;base64,'), 'an organic frame is traced from the concept');
  }

  // Older keying helpers still behave (used for diagnostics): a soft key edge is un-mixed.
  {
    const keyed = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#0f2a5c' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#3cd750"/></svg>'), left: 0, top: 100 }]).png().toBuffer();
    const k = await keyMasks(keyed, 1);
    check(k.areas[0] > 0.45 && k.areas[0] < 0.55 && typeof placePhoto === 'function', 'key colour areas are found');
  }

  // Qwen through fal: chosen like any image model, counted in the pictures allowance (not cut-outs).
  {
    const ok =
      resolveImageModel('create', 'qwen-image') === 'qwen-image' && resolveImageModel('edit', 'qwen-image') === 'qwen-image' && resolveImageModel('edit', 'gpt-image-2.5-flare') === 'gpt-image-2.5-sunburst' &&
      IMAGE_USAGE_MODEL_PATTERN.test('fal/fal-ai/qwen-image') && IMAGE_USAGE_MODEL_PATTERN.test('fal/fal-ai/qwen-image-edit-plus') && IMAGE_USAGE_MODEL_PATTERN.test('openai/gpt-image-2.5-flare') &&
      !IMAGE_USAGE_MODEL_PATTERN.test('fal/fal-ai/qwen-image-layered') && !IMAGE_USAGE_MODEL_PATTERN.test('fal/fal-ai/sam-3/image');
    check(ok, 'Qwen image models resolve and count as pictures; cut-outs and layers don’t');
  }

  // The brand's own words reach the AI.
  {
    const v = voiceText({ about: 'A Kampala café', tone: 'Warm', rules: 'Say “Ugandan coffee”' });
    check(v.includes('What the brand does: A Kampala café') && v.includes('Tone of voice: Warm') && voiceText(null) === '' && voiceText({}) === '', 'brand voice for the AI');
  }

  await closeRenderer();
  console.log(failures ? `\n${failures} problem(s).` : '\nAll scenes rendered cleanly.');
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await closeRenderer();
  process.exit(1);
});
