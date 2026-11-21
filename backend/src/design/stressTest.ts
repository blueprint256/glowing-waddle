import sharp from 'sharp';
import { renderDesign } from './renderer';
import { buildTestKit, testBackground, testDoc, testPhoto, SAMPLE_TEXT } from './testKit';
import { roomierSettings, validateTemplate, withinLimits } from './template';
import { hasErrors } from './checks';
import type { DesignIssue, DesignTemplate, FormatId, PhotoSlot } from './types';

/**
 * The stress test every design passes before it can be used (docs/DESIGN_ENGINE.md): each of its
 * shapes with ordinary words and three partners, ordinary words and six partners, and short words
 * with none, using placeholder logos and a stand-in photo. As the pipeline does, a case that fails
 * gets one try with the design's roomier settings. Very long words are rendered too and shown, but
 * don't count: no design can hold everything.
 */

export interface StressCase {
  format: FormatId;
  name: 'typical-3' | 'typical-6' | 'short-0' | 'long-6';
  counted: boolean;
  passed: boolean;
  roomier: boolean;
  issues: DesignIssue[];
  /** A JPEG preview of the render (about 540 px wide). */
  preview: Buffer;
}

export interface StressResult {
  /** Problems with the design itself (it can't be rendered at all). */
  invalid: string[];
  cases: StressCase[];
  passed: number;
  failed: number;
  /** One line per failed case, for people and for the importer's next attempt. */
  problems: string[];
}

const CASES: { name: StressCase['name']; text: keyof typeof SAMPLE_TEXT; sponsors: number; counted: boolean }[] = [
  { name: 'typical-3', text: 'typical', sponsors: 3, counted: true },
  { name: 'typical-6', text: 'typical', sponsors: 6, counted: true },
  { name: 'short-0', text: 'short', sponsors: 0, counted: true },
  { name: 'long-6', text: 'long', sponsors: 6, counted: false }
];

/** A stand-in group photo (shapes, no real people): people across the middle third. */
async function standInPhoto(): Promise<Buffer> {
  const figures = Array.from({ length: 9 }, (_, i) => {
    const x = 120 + i * 170;
    const h = 330 + ((i * 37) % 70);
    const top = 800 - h;
    const vest = ['#d7e84a', '#c9db3c', '#e2ef6b'][i % 3];
    return `<circle cx="${x}" cy="${top + 52}" r="48" fill="#6b4632"/><rect x="${x - 62}" y="${top + 108}" width="124" height="${h - 108}" rx="44" fill="${vest}"/><rect x="${x - 50}" y="${top + 230}" width="100" height="${h - 230}" fill="#2f3d5c"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc6e8"/><stop offset="0.55" stop-color="#cfe2ee"/><stop offset="0.56" stop-color="#7a9a4e"/><stop offset="1" stop-color="#b9774a"/></linearGradient></defs><rect width="1600" height="1067" fill="url(#s)"/><rect x="0" y="380" width="1600" height="90" fill="#3f6b2e"/>${figures}<rect x="0" y="800" width="1600" height="267" fill="#b56f41"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/** The look of preview images: a calm teal brand that belongs to nobody. */
const NEUTRAL_PREVIEW = {
  colors: {
    primary: { name: 'Teal', hex: '#0f5e63' },
    secondary: { name: 'Deep teal', hex: '#0a3d40' },
    accent: { name: 'Sun', hex: '#f2b33d' },
    ink: { name: 'Ink', hex: '#1f2430' },
    paper: { name: 'Paper', hex: '#ffffff' }
  },
  fonts: { display: 'opensans', text: 'gelasio' }
};

export async function stressTest(
  template: DesignTemplate,
  options: { formats?: FormatId[]; photo?: Buffer; cases?: StressCase['name'][]; neutral?: boolean } = {}
): Promise<StressResult> {
  const invalid = validateTemplate(template);
  if (invalid.length) return { invalid, cases: [], passed: 0, failed: 0, problems: invalid };
  const built = await buildTestKit();
  const { files, sponsors } = built;
  // Previews shown to admins use a neutral brand (no club pack); the tests keep the strict club kit.
  const kit = options.neutral ? { ...built.kit, name: 'Your organisation', pack: null, colors: NEUTRAL_PREVIEW.colors, fonts: NEUTRAL_PREVIEW.fonts, rules: [] } : built.kit;
  const photo: PhotoSlot = await testPhoto(files, 'stand-in.jpg', options.photo || (await standInPhoto()));
  const background = template.background !== 'none' ? await testBackground(files) : null;
  const loader = async (url: string) => {
    const b = files.get(url);
    if (!b) throw new Error(`missing ${url}`);
    return b;
  };
  const cases: StressCase[] = [];
  for (const format of (options.formats || template.formats).filter((f) => template.formats.includes(f))) {
    for (const c of CASES.filter((x) => !options.cases || options.cases.includes(x.name))) {
      const words = c.text === 'long' ? SAMPLE_TEXT.long : withinLimits(SAMPLE_TEXT[c.text], template);
      const photos = template.photos.max > 0 ? [photo] : [];
      const doc = testDoc(template.id, format, words, photos, sponsors.slice(0, Math.min(c.sponsors, template.sponsors.max)));
      if (background && (template.background === 'required' || !photos.length)) doc.background = background;
      let issues: DesignIssue[] = [];
      let file: Buffer;
      let roomier = false;
      try {
        let r = await renderDesign(template, doc, kit, loader, { scale: 1 });
        if (c.counted && hasErrors(r.report.issues)) {
          const params = roomierSettings(template, doc.params);
          if (params) {
            const again = await renderDesign(template, { ...doc, params }, kit, loader, { scale: 1 });
            if (!hasErrors(again.report.issues)) {
              r = again;
              roomier = true;
            }
          }
        }
        issues = r.report.issues;
        file = r.file;
      } catch (error) {
        issues = [{ level: 'error', code: 'render-failed', message: `It couldn’t be laid out: ${(error as Error).message}` }];
        file = await sharp({ create: { width: 540, height: 540, channels: 3, background: '#eeeeee' } }).jpeg().toBuffer();
      }
      // The stand-in photo is small for paper: that says nothing about the layout.
      const errors = issues.filter((i) => i.level === 'error' && i.code !== 'photo-small');
      const preview = await sharp(file).resize({ width: 540 }).jpeg({ quality: 80 }).toBuffer();
      cases.push({ format, name: c.name, counted: c.counted, passed: !errors.length, roomier, issues, preview });
    }
  }
  const counted = cases.filter((c) => c.counted);
  const problems = counted
    .filter((c) => !c.passed)
    .map((c) => `${c.format}, ${c.name.replace('-', ' words, ')} partners: ${c.issues.filter((i) => i.level === 'error' && i.code !== 'photo-small').map((i) => i.message).join(' ')}`);
  return { invalid: [], cases, passed: counted.filter((c) => c.passed).length, failed: counted.filter((c) => !c.passed).length, problems };
}
