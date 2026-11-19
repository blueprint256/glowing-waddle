import sharp from 'sharp';
import type { BrandKit, DesignDoc, DesignTemplate, MeasuredElement, RenderReport } from './types';
import { FORMATS } from './formats';
import { buildPage } from './page';
import { FONT_CONTENT_TYPE, fontFormatOf, readFontFile } from './fonts';
import { contrast, luminance, type RGB } from './color';
import { runChecks } from './checks';

/**
 * Renders a poster in headless Chromium: real typography, masks, blend modes and filters, the same
 * result every time. The page is sealed: it only receives the files the renderer serves
 * (design.local), every other request is refused.
 *
 * Chromium comes from DESIGN_CHROME_PATH, or the browser installed with `npx playwright install
 * chromium` (docs/DESIGN_ENGINE.md).
 */

// playwright-core is loaded lazily so the rest of the app runs without it.
type Browser = any;
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.isConnected()) return b;
    browserPromise = null;
  }
  browserPromise = (async () => {
    let pw: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      pw = require('playwright-core');
    } catch {
      throw new Error('The poster renderer needs playwright-core (npm install) and Chromium (npx playwright install chromium).');
    }
    const executablePath = process.env.DESIGN_CHROME_PATH || undefined;
    return pw.chromium.launch({
      executablePath,
      args: ['--disable-gpu', '--no-sandbox', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb']
    });
  })();
  return browserPromise;
}

/** Whether posters can be rendered on this server (opens the browser if it isn't open yet). */
export async function rendererStatus(): Promise<{ ok: boolean; error?: string }> {
  try {
    const b = await getBrowser();
    return { ok: b.isConnected() };
  } catch (error: any) {
    browserPromise = null;
    return { ok: false, error: String(error?.message || error).split('\n')[0].slice(0, 300) };
  }
}

export async function closeRenderer(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (b) await b.close().catch(() => undefined);
}

/** Loads a stored file's bytes (storage in the app; a local folder in the self-test). */
export type AssetLoader = (url: string) => Promise<Buffer>;

export interface RenderOptions {
  /** png (default), jpeg (social delivery) or pdf (print, text stays sharp). */
  type?: 'png' | 'jpeg' | 'pdf';
  /** Overrides the format's device scale (e.g. 1 for quick previews). */
  scale?: number;
  quality?: number;
  timeoutMs?: number;
}

export interface RenderResult {
  file: Buffer;
  contentType: string;
  report: RenderReport;
  /** The width × height of the delivered file in pixels (PDF: the page in CSS pixels). */
  pixels: { width: number; height: number };
}

function contentTypeOf(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF') return 'image/webp';
  if (buf.slice(0, 5).toString().includes('<svg') || buf.slice(0, 5).toString() === '<?xml') return 'image/svg+xml';
  const font = fontFormatOf(buf);
  if (font) return FONT_CONTENT_TYPE[font];
  return 'application/octet-stream';
}

interface Raw {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

/** Pixel lightness samples (WCAG luminance) inside a box of a raw screenshot. */
function sampleBox(raw: Raw, box: { x: number; y: number; w: number; h: number }): { lums: number[]; mean: RGB } {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(raw.width, Math.ceil(box.x + box.w));
  const y1 = Math.min(raw.height, Math.ceil(box.y + box.h));
  const lums: number[] = [];
  let r = 0;
  let g = 0;
  let b = 0;
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 2500)));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * raw.width + x) * raw.channels;
      const px: RGB = [raw.data[i], raw.data[i + 1], raw.data[i + 2]];
      lums.push(luminance(px));
      r += px[0];
      g += px[1];
      b += px[2];
    }
  }
  const n = Math.max(1, lums.length);
  return { lums: lums.sort((p, q) => p - q), mean: [r / n, g / n, b / n] };
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] : 0.5);

function parseCssColor(c: string | undefined): RGB | null {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(c || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Contrast of each text element against the worst part of what's behind it: for light text the
 * brightest tenth of the background, for dark text the darkest tenth.
 */
function textContrasts(raw: Raw, elements: MeasuredElement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const el of elements) {
    if (el.kind !== 'text') continue;
    const col = parseCssColor(el.color);
    if (!col) continue;
    const { lums } = sampleBox(raw, el.inner || el.box);
    if (!lums.length) continue;
    const lt = luminance(col);
    const worst = lt > 0.5 ? pct(lums, 0.9) : pct(lums, 0.1);
    const ratio = (Math.max(lt, worst) + 0.05) / (Math.min(lt, worst) + 0.05);
    out.set(el.key, Math.round(ratio * 100) / 100);
  }
  return out;
}

export async function renderDesign(template: DesignTemplate, doc: DesignDoc, kit: BrandKit, loadAsset: AssetLoader, options: RenderOptions = {}): Promise<RenderResult> {
  const started = Date.now();
  const format = FORMATS[doc.format];
  const scale = options.scale ?? format.scale;
  const assets = new Map<string, string>();
  const address = (url: string) => {
    if (!assets.has(url)) assets.set(url, `https://design.local/a/${assets.size + 1}`);
    return assets.get(url)!;
  };
  const { html } = buildPage(template, doc, kit, address);
  const byAddress = new Map(Array.from(assets.entries()).map(([url, addr]) => [addr, url]));
  const loaded = new Map<string, Promise<Buffer>>();
  const load = (url: string) => {
    if (!loaded.has(url)) loaded.set(url, loadAsset(url));
    return loaded.get(url)!;
  };
  // Start loading every file while the browser opens.
  byAddress.forEach((url) => void load(url).catch(() => undefined));

  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: format.width, height: format.height }, deviceScaleFactor: scale, javaScriptEnabled: true });
  try {
    const page = await context.newPage();
    await page.route('**/*', async (route: any) => {
      const url: string = route.request().url();
      try {
        if (url === 'https://design.local/doc') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
        if (url.startsWith('https://design.local/fonts/')) {
          const buf = readFontFile(decodeURI(url.slice('https://design.local/fonts/'.length)));
          return buf ? route.fulfill({ status: 200, contentType: 'font/ttf', body: buf }) : route.abort();
        }
        const original = byAddress.get(url);
        if (original) {
          const buf = await load(original);
          return route.fulfill({ status: 200, contentType: contentTypeOf(buf), body: buf });
        }
        return route.abort();
      } catch {
        return route.abort();
      }
    });
    await page.goto('https://design.local/doc', { waitUntil: 'load', timeout: options.timeoutMs ?? 30000 });
    await page.waitForSelector('html[data-ready="1"]', { timeout: options.timeoutMs ?? 30000 });
    const pageError = await page.evaluate(() => document.documentElement.getAttribute('data-error'));
    if (pageError) throw new Error(`The design couldn’t be laid out: ${pageError}`);

    // 1) Photograph what's behind the words and logos.
    await page.evaluate(() => (window as any).__design.sampling(true));
    const behindPng: Buffer = await page.locator('#poster').screenshot({ type: 'png', scale: 'css', animations: 'disabled' });
    const behind = await sharp(behindPng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const raw: Raw = { data: behind.data, width: behind.info.width, height: behind.info.height, channels: behind.info.channels };

    // 2) Choose light or dark text, and the logo variant, from what's actually behind them.
    const autoTones: { key: string; box: MeasuredElement['box'] }[] = await page.evaluate(() => (window as any).__design.autoToneKeys());
    if (autoTones.length) {
      const map: Record<string, string> = {};
      const ink = parseCssColor(await page.evaluate(() => getComputedStyle(document.getElementById('poster')!).getPropertyValue('--c-ink'))) || [20, 20, 20];
      const paper = parseCssColor(await page.evaluate(() => getComputedStyle(document.getElementById('poster')!).getPropertyValue('--c-paper'))) || [255, 255, 255];
      for (const t of autoTones) {
        const { lums } = sampleBox(raw, t.box);
        // Dark text is only as readable as the darkest part behind it; light text, the brightest.
        const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const inkRatio = ratio(luminance(ink), pct(lums, 0.1));
        const paperRatio = ratio(luminance(paper), pct(lums, 0.9));
        map[t.key] = paperRatio >= inkRatio ? 'light' : 'dark';
      }
      await page.evaluate((m: Record<string, string>) => (window as any).__design.setTones(m), map);
    }
    // Every logo and partner logo: its version chosen again for what's actually behind it (the
    // 10th and 90th percentiles, so a busy photo has to be readable at both ends).
    const grounds: { key: string; box: MeasuredElement['box'] }[] = await page.evaluate(() => (window as any).__design.logoGrounds());
    const groundMap: Record<string, { lo: number; hi: number }> = {};
    for (const g of grounds) {
      const { lums } = sampleBox(raw, g.box);
      if (lums.length) groundMap[g.key] = { lo: pct(lums, 0.1), hi: pct(lums, 0.9) };
    }
    await page.evaluate((m: Record<string, { lo: number; hi: number }>) => (window as any).__design.setLogoGrounds(m), groundMap);
    await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => null))));
    // The choices above can move things (a logo plate adds height, a block shifts): photograph what's
    // behind the words again, as they finally sit, for the contrast check.
    const settledPng: Buffer = await page.locator('#poster').screenshot({ type: 'png', scale: 'css', animations: 'disabled' });
    const settled = await sharp(settledPng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const settledRaw: Raw = { data: settled.data, width: settled.info.width, height: settled.info.height, channels: settled.info.channels };
    await page.evaluate(() => (window as any).__design.sampling(false));

    // 3) Measure everything and run the checks.
    const elements: MeasuredElement[] = await page.evaluate(() => (window as any).__design.report());
    const contrasts = textContrasts(settledRaw, elements);
    const report: RenderReport = {
      format: doc.format,
      width: format.width,
      height: format.height,
      elements,
      issues: [],
      minContrast: contrasts.size ? Math.min(...contrasts.values()) : undefined,
      ms: 0
    };
    report.issues = runChecks({ template, doc, kit, report, contrasts });

    // 4) The file.
    let file: Buffer;
    let contentType: string;
    let pixels = { width: Math.round(format.width * scale), height: Math.round(format.height * scale) };
    if (options.type === 'pdf') {
      file = await page.pdf({ width: `${format.width}px`, height: `${format.height}px`, printBackground: true, pageRanges: '1', preferCSSPageSize: false });
      contentType = 'application/pdf';
      pixels = { width: format.width, height: format.height };
    } else if (options.type === 'jpeg') {
      file = await page.locator('#poster').screenshot({ type: 'jpeg', quality: options.quality ?? 92, animations: 'disabled' });
      contentType = 'image/jpeg';
    } else {
      file = await page.locator('#poster').screenshot({ type: 'png', animations: 'disabled' });
      contentType = 'image/png';
    }
    report.ms = Date.now() - started;
    return { file, contentType, report, pixels };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export { contrast };
