import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { BrandKit, BrandLogo, DesignDoc, DesignTemplate, LogoAsset } from './types';
import { FORMATS } from './formats';
import { customFontFaceCss, fontFaceCss, fontStack } from './fonts';
import { bestText, contrastHex, mix, rgbTriplet, withLightness, lightness } from './color';
import { normalizeParams } from './template';

/**
 * Builds the HTML page the renderer opens for one poster: fonts, the brand's colour and type
 * tokens, the engine's base styles, the design, the poster's content (as data, never as HTML) and
 * the engine runtime. The page may only run the runtime (by nonce) and load the renderer's files.
 */

const RUNTIME_DIR = path.resolve(__dirname, '../../assets/design-runtime');
let runtimeCache: { js: string; css: string } | null = null;

function runtime(): { js: string; css: string } {
  if (!runtimeCache || process.env.DESIGN_DEV === '1') {
    runtimeCache = {
      js: fs.readFileSync(path.join(RUNTIME_DIR, 'engine.js'), 'utf8'),
      css: fs.readFileSync(path.join(RUNTIME_DIR, 'base.css'), 'utf8')
    };
  }
  return runtimeCache;
}

/** Maps a stored file address to the address the page loads it from. */
export type AssetAddress = (url: string) => string;

const GRAIN_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)' opacity='0.9'/></svg>";

export function brandTokens(kit: BrandKit, swap = false): Record<string, string> {
  const c = kit.colors;
  const primary = swap ? c.secondary.hex : c.primary.hex;
  const secondary = swap ? c.primary.hex : c.secondary.hex;
  const accent = c.accent.hex;
  const ink = c.ink.hex;
  const paper = c.paper.hex;
  const deep = withLightness(primary, Math.max(0.16, Math.min(0.3, lightness(primary) * 0.62)));
  const tokens: Record<string, string> = {
    '--c-primary': primary,
    '--c-secondary': secondary,
    '--c-accent': accent,
    '--c-ink': ink,
    '--c-paper': paper,
    '--c-primary-deep': deep,
    '--c-primary-mid': mix(primary, deep, 0.45),
    '--c-primary-soft': mix(paper, primary, 0.1),
    '--c-primary-tint': mix(paper, primary, 0.22),
    '--c-secondary-soft': mix(paper, secondary, 0.12),
    '--c-accent-deep': withLightness(accent, Math.max(0.3, lightness(accent) * 0.7)),
    '--c-accent-soft': mix(paper, accent, 0.18),
    '--c-paper-warm': mix(paper, accent, 0.06),
    '--on-primary': bestText(primary, ink, paper),
    '--on-secondary': bestText(secondary, ink, paper),
    '--on-accent': bestText(accent, ink, paper),
    '--on-deep': bestText(deep, ink, paper),
    '--f-display': fontStack(kit.fonts.display, kit.customFonts),
    '--f-text': fontStack(kit.fonts.text, kit.customFonts),
    '--f-accent': fontStack(kit.fonts.accent || kit.fonts.display, kit.customFonts),
    '--grain-img': `url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")`
  };
  for (const [k, v] of Object.entries({ primary, secondary, accent, ink, paper, 'primary-deep': deep })) tokens[`--c-${k}-rgb`] = rgbTriplet(v);
  tokens['--shadow-soft'] = `0 0.35cqmin 1.4cqmin rgb(${rgbTriplet(ink)} / 0.2), 0 0.1cqmin 0.3cqmin rgb(${rgbTriplet(ink)} / 0.16)`;
  return tokens;
}

/** Duotone filters in the brand's colours (dark tone → light tone). */
function duotoneDefs(tokens: Record<string, string>): string {
  const table = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const filter = (id: string, dark: string, light: string) => {
    const vals = [0, 1, 2].map((i) => `${table(dark, i).toFixed(3)} ${table(light, i).toFixed(3)}`);
    return `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncR type="table" tableValues="${vals[0]}"/><feFuncG type="table" tableValues="${vals[1]}"/><feFuncB type="table" tableValues="${vals[2]}"/></feComponentTransfer></filter>`;
  };
  const deep = tokens['--c-primary-deep'];
  const light = mix(tokens['--c-paper'], tokens['--c-primary'], 0.08);
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${filter('d-duo', deep, light)}${filter('d-duo-accent', deep, tokens['--c-accent'])}</defs></svg>`;
}

/** One version of a logo as the runtime needs it. */
function versionData(v: LogoAsset, address: (url: string) => string) {
  return { variant: v.variant, src: address(v.url), width: v.width, height: v.height, ink: v.ink, lightness: v.lightness, onLight: v.onLight, onDark: v.onDark, edge: v.edge || null, derived: !!v.derived };
}

function logoData(logo: BrandLogo, address: AssetAddress) {
  const main = logo.variants[0];
  return {
    id: logo.id,
    clearSpace: logo.clearSpace,
    ink: main?.ink ?? 0.5,
    aspect: main ? main.width / Math.max(1, main.height) : 2,
    variants: logo.variants.map((v: LogoAsset) => versionData(v, address))
  };
}

const escapeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escapeAttr = (s: string) => s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]!);

export interface PageResult {
  html: string;
  nonce: string;
}

export function buildPage(template: DesignTemplate, doc: DesignDoc, kit: BrandKit, address: AssetAddress): PageResult {
  const format = FORMATS[doc.format];
  const params = normalizeParams(template.params, doc.params);
  const tokens = brandTokens(kit, !!doc.tweaks?.colorSwap);
  const nonce = crypto.randomBytes(12).toString('base64');
  const rt = runtime();

  const primary = kit.logos.find((l) => l.id === doc.logos.primary) || kit.logos.find((l) => l.role === 'primary');
  const campaign = (doc.logos.campaign || []).map((id) => kit.logos.find((l) => l.id === id)).filter((l): l is BrandLogo => !!l);

  const data = {
    format: doc.format,
    params,
    tweaks: doc.tweaks || {},
    text: doc.text,
    photos: doc.photos.map((p) => ({
      src: address(p.url),
      width: p.width,
      height: p.height,
      focal: p.focal,
      cutout: p.cutout ? { src: address(p.cutout.url), width: p.cutout.width, height: p.cutout.height, edges: p.cutout.edges || null } : null
    })),
    background: doc.background ? { src: address(doc.background.url), width: doc.background.width, height: doc.background.height } : null,
    logos: { primary: primary ? logoData(primary, address) : null, campaign: campaign.map((l) => logoData(l, address)) },
    sponsors: doc.sponsors.map((s) => ({ name: s.name, ...versionData(s.logo, address), variants: [s.logo, ...(s.alts || [])].map((v) => versionData(v, address)) }))
  };

  // Settings reach the design as CSS variables (numbers) and data attributes (choices, colours).
  const paramVars: string[] = [];
  const paramAttrs: string[] = [];
  for (const p of template.params) {
    const v = params[p.key];
    if (p.type === 'number') paramVars.push(`--p-${p.key}:${v}`);
    else if (p.type === 'color') paramVars.push(`--p-${p.key}:var(--c-${v})`, `--p-${p.key}-on:var(--on-${v === 'ink' || v === 'paper' ? 'primary' : v})`);
    paramAttrs.push(`data-p-${p.key}="${escapeAttr(String(v))}"`);
  }
  // Readable pairings of the design's colour settings: --p-a-on-b is colour a when it reads on
  // colour b (4.5:1), otherwise the better of the text colours. Also on paper and on the deep tone.
  const colorParams = template.params.filter((p) => p.type === 'color');
  const roleHex = (role: string) => tokens[`--c-${role}`] || tokens['--c-primary'];
  const grounds: [string, string][] = [
    ...colorParams.map((p) => [p.key, roleHex(String(params[p.key]))] as [string, string]),
    ['paper', tokens['--c-paper']],
    ['deep', tokens['--c-primary-deep']]
  ];
  for (const fg of colorParams) {
    const fgHex = roleHex(String(params[fg.key]));
    for (const [gKey, gHex] of grounds) {
      if (gKey === fg.key) continue;
      tokens[`--p-${fg.key}-on-${gKey}`] = contrastHex(fgHex, gHex) >= 4.5 ? fgHex : bestText(gHex, tokens['--c-ink'], tokens['--c-paper']);
    }
  }

  // Clear space of the logos as a share of their height, for designs that pad around them.
  tokens['--clear-primary'] = String(primary?.clearSpace ?? 0.25);
  tokens['--clear-campaign'] = String(campaign[0]?.clearSpace ?? 0.2);
  const tokenCss = `#poster{${Object.entries(tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')};${paramVars.join(';')}}`;

  const fontIds = [kit.fonts.display, kit.fonts.text, kit.fonts.accent || ''];
  const fonts = [fontFaceCss(fontIds), customFontFaceCss(fontIds, kit.customFonts || [], address)].filter(Boolean).join('\n');
  const csp = `default-src 'none'; img-src https://design.local data:; font-src https://design.local; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${fonts}</style>
<style>${rt.css}</style>
<style>${tokenCss}</style>
<style>${template.css}</style>
</head><body>
${duotoneDefs(tokens)}
<div id="poster" data-design="${escapeAttr(template.id)}" data-format="${doc.format}" ${paramAttrs.join(' ')} style="width:${format.width}px;height:${format.height}px">
${template.html}
</div>
<script type="application/json" id="d-data">${escapeJson(data)}</script>
<script nonce="${nonce}">${rt.js}</script>
</body></html>`;
  return { html, nonce };
}
