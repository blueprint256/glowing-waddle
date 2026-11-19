import sharp from 'sharp';
import type { BrandKit, BrandLogo, DesignDoc, DesignText, LogoAsset, PhotoSlot, SponsorSlot } from './types';
import { ROTARY_PACK } from './packs';
import { prepareLogo, logoAsset, findFocal, monoVersions } from './assets';

/**
 * Stand-in material for the engine's self-test and the admin's stress test: invented logos that
 * are clearly placeholders (never a real organisation's mark), and sample content of every length.
 * Each logo goes through prepareLogo like a real upload, so box removal and trimming are tested.
 */

export interface TestFiles {
  files: Map<string, Buffer>;
  kit: BrandKit;
  sponsors: SponsorSlot[];
}

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);

/** A wide club-style lockup: a simple mark, a name and a second line. Labelled as a placeholder. */
function clubLogo(textColor: string, markColor: string, bg?: string): Buffer {
  return svg(
    960,
    300,
    `${bg ? `<rect width="960" height="300" fill="${bg}"/>` : ''}
    <g transform="translate(150 150)">
      <circle r="118" fill="none" stroke="${markColor}" stroke-width="22"/>
      <path d="M-62 30 L0 -70 L62 30 Z" fill="${markColor}"/>
      <circle r="26" cy="30" fill="${textColor}"/>
    </g>
    <text x="300" y="150" font-family="DejaVu Sans" font-weight="700" font-size="104" fill="${textColor}" letter-spacing="2">CLUB</text>
    <text x="304" y="232" font-family="DejaVu Sans" font-size="54" fill="${textColor}">logo placeholder</text>`
  );
}

function campaignLogo(color: string, bg?: string): Buffer {
  return svg(
    520,
    300,
    `${bg ? `<rect width="520" height="300" fill="${bg}"/>` : ''}
    <rect x="10" y="10" width="500" height="280" rx="40" fill="none" stroke="${color}" stroke-width="16"/>
    <text x="260" y="140" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="86" fill="${color}">CAMPAIGN</text>
    <text x="260" y="225" text-anchor="middle" font-family="DejaVu Sans" font-size="54" fill="${color}">placeholder</text>`
  );
}

/** Invented sponsors of very different shapes, one as a JPEG with a white box (a typical upload). */
const SPONSORS: { name: string; file: () => Buffer; jpeg?: boolean }[] = [
  {
    name: 'Lakeview Clinic',
    file: () =>
      svg(600, 600, `<rect x="40" y="40" width="520" height="520" rx="120" fill="#0f7a5c"/><path d="M260 170h80v90h90v80h-90v90h-80v-90h-90v-80h90z" fill="#fff"/>`)
  },
  {
    name: 'Nile Water Co',
    file: () =>
      svg(1700, 260, `<path d="M40 180 q60 -80 120 0 t120 0" fill="none" stroke="#1d6fd6" stroke-width="26" stroke-linecap="round"/><text x="330" y="175" font-family="DejaVu Sans" font-weight="700" font-size="128" fill="#123a6b">NILE WATER CO</text>`)
  },
  {
    name: 'Acacia Bank',
    jpeg: true,
    file: () =>
      svg(900, 520, `<rect width="900" height="520" fill="#ffffff"/><rect x="120" y="110" width="660" height="300" fill="#8a1c1c"/><text x="450" y="300" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="120" fill="#ffffff">ACACIA</text>`)
  },
  {
    name: 'Sunrise FM',
    file: () =>
      svg(700, 700, `<circle cx="350" cy="350" r="300" fill="#f29d1a"/><text x="350" y="330" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="150" fill="#ffffff">SUN</text><text x="350" y="470" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="110" fill="#ffffff">FM</text>`)
  },
  {
    name: 'Kigezi Tea',
    file: () =>
      svg(1200, 400, `<ellipse cx="170" cy="200" rx="110" ry="150" fill="#3e8e2c"/><text x="320" y="245" font-family="DejaVu Serif" font-style="italic" font-size="140" fill="#2b4a1e">Kigezi Tea</text>`)
  },
  {
    name: 'Mbale Hardware',
    file: () => svg(1200, 360, `<text x="20" y="250" font-family="DejaVu Sans" font-weight="700" font-size="200" fill="#222">MBALE</text><rect x="840" y="80" width="300" height="200" fill="#e0b400"/>`)
  }
];

async function toPng(svgBuf: Buffer, jpeg = false): Promise<Buffer> {
  const img = sharp(svgBuf, { density: 144 });
  return jpeg ? img.flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer() : img.png().toBuffer();
}

export async function prepared(files: Map<string, Buffer>, id: string, raw: Buffer): Promise<LogoAsset> {
  return (await preparedWithVersions(files, id, raw)).main;
}

/** A logo file prepared as an upload is: the file itself, and for a one-colour logo its white or
 *  dark version. */
export async function preparedWithVersions(files: Map<string, Buffer>, id: string, raw: Buffer): Promise<{ main: LogoAsset; derived: LogoAsset[] }> {
  const p = await prepareLogo(raw);
  const url = `test://logo/${id}.png`;
  files.set(url, p.png);
  const derived: LogoAsset[] = [];
  for (const m of await monoVersions(p)) {
    const u = `test://logo/${id}-${m.variant}.png`;
    files.set(u, m.png);
    derived.push(logoAsset(`${id}-${m.variant}`, u, { ...p, edge: m.edge, onLight: m.variant === 'mono-dark', onDark: m.variant === 'mono-light' }, m.variant, true));
  }
  return { main: logoAsset(id, url, p), derived };
}

export async function buildTestKit(): Promise<TestFiles> {
  const files = new Map<string, Buffer>();
  // The club logo arrives as a JPEG with a white box; its reverse version as a transparent PNG.
  const clubColor = await prepared(files, 'club-color', await toPng(clubLogo('#17458f', '#f7a81b', '#ffffff'), true));
  clubColor.variant = 'color';
  const clubReverse = await prepared(files, 'club-reverse', await toPng(clubLogo('#ffffff', '#f7a81b')));
  clubReverse.variant = 'reverse';
  const campaign = await prepared(files, 'campaign', await toPng(campaignLogo('#c8102e')));
  campaign.variant = 'color';

  const primary: BrandLogo = {
    id: 'club',
    name: 'Club logo (placeholder)',
    role: 'primary',
    variants: [clubColor, clubReverse],
    clearSpace: ROTARY_PACK.logoDefaults.primary.clearSpace,
    minHeight: ROTARY_PACK.logoDefaults.primary.minHeight
  };
  const campaignLogoDef: BrandLogo = {
    id: 'campaign',
    name: 'Campaign logo (placeholder)',
    role: 'campaign',
    variants: [campaign],
    clearSpace: ROTARY_PACK.logoDefaults.campaign.clearSpace,
    minHeight: ROTARY_PACK.logoDefaults.campaign.minHeight,
    requiresPrimary: true
  };

  const sponsors: SponsorSlot[] = [];
  for (const s of SPONSORS) {
    const asset = await prepared(files, `sponsor-${sponsors.length + 1}`, await toPng(s.file(), s.jpeg));
    sponsors.push({ name: s.name, logo: asset });
  }

  const kit: BrandKit = {
    name: 'Test club (Rotary pack)',
    pack: 'rotary',
    colors: ROTARY_PACK.colors,
    fonts: ROTARY_PACK.fonts,
    logos: [primary, campaignLogoDef],
    rules: ROTARY_PACK.rules,
    notes: ROTARY_PACK.notes
  };
  return { files, kit, sponsors };
}

/** A local photo as a poster slot (focal point found like a real upload). */
export async function testPhoto(files: Map<string, Buffer>, name: string, buf: Buffer): Promise<PhotoSlot> {
  const f = await findFocal(buf);
  const url = `test://photo/${name}`;
  files.set(url, buf);
  return { url, width: f.width, height: f.height, focal: { x: f.x, y: f.y }, consent: true };
}

export const SAMPLE_TEXT: Record<'typical' | 'short' | 'long', DesignText> = {
  typical: {
    eyebrow: 'National Immunisation Days',
    headline: 'Every child.\nEvery dose.',
    subhead: 'Join Rotary volunteers as we help health workers reach every child under five in Kampala with the polio vaccine.',
    details: [
      { kind: 'date', text: 'Sat 14 – Sun 15 December' },
      { kind: 'time', text: '8:00 am – 5:00 pm' },
      { kind: 'place', text: 'Kawempe Health Centre IV' }
    ],
    cta: 'Volunteer with us',
    badge: { top: 'Sat', main: '14', bottom: 'Dec' },
    sponsorsTitle: 'In partnership with',
    stats: [
      { value: '312', label: 'children vaccinated' },
      { value: '48', label: 'volunteers' },
      { value: '5', label: 'health centres' }
    ]
  },
  short: {
    headline: 'End polio now',
    details: [{ kind: 'date', text: '14 December' }],
    badge: { main: '14', bottom: 'Dec' }
  },
  long: {
    eyebrow: 'Rotary Club of Kampala North · Community Health Week',
    headline: 'Together we can protect every single child in our community from polio, for good',
    subhead:
      'From 14 to 15 December our members, partners and hundreds of community volunteers will work with Ministry of Health teams across five divisions to make sure no child under five is missed by the national campaign.',
    details: [
      { kind: 'date', text: 'Saturday 14 – Sunday 15 December 2026' },
      { kind: 'time', text: '8:00 am – 5:00 pm both days' },
      { kind: 'place', text: 'Kawempe, Rubaga, Makindye, Nakawa and Central divisions' },
      { kind: 'phone', text: '+256 700 000 000' }
    ],
    cta: 'Register as a volunteer today',
    badge: { top: 'Sat', main: '14', bottom: 'Dec' },
    sponsorsTitle: 'With thanks to our partners'
  }
};

export function testDoc(designId: string, format: DesignDoc['format'], text: DesignText, photos: PhotoSlot[], sponsors: SponsorSlot[], campaign = true): DesignDoc {
  return {
    version: 1,
    designId,
    designVersion: 1,
    format,
    params: {},
    text,
    photos,
    logos: { primary: 'club', campaign: campaign ? ['campaign'] : [] },
    sponsors,
    background: null
  };
}

/** A stand-in for an AI background (abstract sunrise over hills), sized like the real one. */
export async function testBackground(files: Map<string, Buffer>): Promise<import('./types').BackgroundSlot> {
  const art = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6c88a"/><stop offset="0.55" stop-color="#f3a86b"/><stop offset="1" stop-color="#e98a5c"/></linearGradient>
      <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff3c9"/><stop offset="1" stop-color="#ffd27a"/></radialGradient>
    </defs>
    <rect width="1536" height="1024" fill="url(#sky)"/>
    <circle cx="980" cy="430" r="170" fill="url(#sun)"/>
    <path d="M0 640 C 260 520 520 600 760 560 S 1240 470 1536 560 L1536 1024 L0 1024 Z" fill="#c9714f"/>
    <path d="M0 720 C 300 640 560 720 820 680 S 1300 610 1536 690 L1536 1024 L0 1024 Z" fill="#8e4f45"/>
    <path d="M0 820 C 340 760 640 830 960 790 S 1360 740 1536 800 L1536 1024 L0 1024 Z" fill="#5a3a44"/>
    <g fill="#5a3a44"><path d="M420 300 q22 -16 44 0 q22 -16 44 0" fill="none" stroke="#5a3a44" stroke-width="7" stroke-linecap="round"/><path d="M540 250 q16 -12 32 0 q16 -12 32 0" fill="none" stroke="#5a3a44" stroke-width="6" stroke-linecap="round"/></g>
  </svg>`;
  const buf = await sharp(Buffer.from(art)).jpeg({ quality: 90 }).toBuffer();
  const url = 'test://bg/sunrise.jpg';
  files.set(url, buf);
  return { url, width: 1536, height: 1024, prompt: 'stand-in' };
}
