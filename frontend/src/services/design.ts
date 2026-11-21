import api, { API_URL } from './api';
import type { PostAIDraft, PosterFormat, PosterText } from '../types';

/**
 * Designed posters and the brand kit (backend routes/design.routes.ts, docs/DESIGN_ENGINE.md).
 * A poster is made in the background: start a job, then follow its progress; the options arrive as
 * the post's drafts (kind "design").
 */

export type PosterJobStage = 'queued' | 'reading' | 'photo' | 'directing' | 'background' | 'rendering' | 'checking' | 'reviewing' | 'saving' | 'done';

export interface PosterJob {
  id: string;
  taskId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  stage: PosterJobStage;
  progress: number;
  draftIds: string[];
  message: string | null;
  error: string | null;
  createdAt: string;
}

export interface StartPosterBody {
  brief?: string;
  format?: PosterFormat;
  /** Photos to use (default: the post's "Include this" pictures). */
  photoUrls?: string[];
  /** No photo chosen: the image AI makes one first and the poster is designed around it. */
  aiPhoto?: boolean;
  partnerIds?: string[];
  /** Campaign logos to add (default: the ones marked "on every poster"). */
  campaignLogoIds?: string[];
  count?: number;
}

/** Typed straight into the poster: a field's new words (empty removes it), detail lines, badge. */
export interface PosterTextEdits extends Partial<Record<Exclude<keyof PosterText, 'details' | 'badge' | 'stats'>, string | null>> {
  details?: PosterText['details'];
  stats?: PosterText['stats'];
  badge?: PosterText['badge'] | null;
}

/** Changes from buttons, applied without AI. `layer` is a photo layer's id (default: the first photo). */
export type QuickOp =
  | { op: 'headline_size'; scale: number }
  | { op: 'swap_colours' }
  | { op: 'change_format'; format: PosterFormat }
  | { op: 'remove_sponsor'; name: string }
  | { op: 'photo_zoom'; layer?: string; scale: number }
  | { op: 'photo_move'; layer?: string; dx: number; dy: number }
  | { op: 'photo_fade'; layer?: string; side: 'left' | 'right' | 'top' | 'bottom' | 'edges' | 'none'; size?: number }
  | { op: 'photo_tint'; layer?: string; color: 'primary' | 'secondary' | 'accent' | 'ink' | 'paper' | 'none'; amount?: number; mode?: 'tint' | 'duotone' | 'darken' }
  | { op: 'photo_shape'; layer?: string; shape: PhotoFrameShape }
  | { op: 'photo_breakout'; layer?: string; on: boolean }
  | { op: 'swap_photo'; layer?: string; url: string };

export type PhotoFrameShape = 'rect' | 'rounded' | 'circle' | 'arch' | 'slant-left' | 'slant-right' | 'blob';

/** What the editor needs to know of a poster's scene (its layers). */
export interface SceneSummary {
  layers: { id: string; type: 'shape' | 'photo' | 'text' | 'logo' | 'partners'; role?: string; shape?: string; fade?: { side: string; size: number }; tint?: { color: string }; breakout?: string | null; photo?: number }[];
}

export interface PosterEditBody {
  text?: PosterTextEdits;
  request?: string;
  ops?: QuickOp[];
}

export interface PosterEditAnswer {
  draft: PostAIDraft | null;
  reply: string;
  refused: string | null;
}

// ---- Brand kit ------------------------------------------------------------------------------------

export type LogoVariantKind = 'color' | 'reverse' | 'mono-dark' | 'mono-light';

export interface LogoVariant {
  id: string;
  url: string;
  variant: LogoVariantKind;
  width: number;
  height: number;
  onLight: boolean;
  onDark: boolean;
  lowRes?: boolean;
  /** Made by the app from a one-colour upload (its white or dark version). */
  derived?: boolean;
}

export interface KitLogo {
  id: string;
  name: string;
  role: 'primary' | 'campaign';
  variants: LogoVariant[];
  clearSpace: number;
  minHeight: number;
  requiresPrimary?: boolean;
  always?: boolean;
}

export interface KitPartner {
  id: string;
  name: string;
  logo: LogoVariant;
  /** Its one-colour white or dark version, made by the app. */
  alts?: LogoVariant[];
}

export type ColorRole = 'primary' | 'secondary' | 'accent' | 'ink' | 'paper';
export type KitColors = Record<ColorRole, { name: string; hex: string }>;
export interface KitFonts {
  display: string;
  text: string;
  accent?: string;
}
export interface KitRule {
  id: string;
  text: string;
  hard: boolean;
}

/** A font the account uploaded (its id is "custom-…" and can be chosen like any other). */
export interface CustomFont {
  id: string;
  name: string;
  category: 'sans' | 'serif' | 'display' | 'condensed' | 'script';
  files: { url: string; style: 'normal' | 'italic'; weight: string; format: string }[];
}

export interface BrandKit {
  name: string;
  /** "rotary" or "rotaract" when the account said it is such a club; null for everyone else. */
  pack: string | null;
  colors: KitColors;
  fonts: KitFonts;
  customFonts: CustomFont[];
  logos: KitLogo[];
  partners: KitPartner[];
  rules: KitRule[];
  notes: string;
  /** The handle line and website posters show where the design has room. */
  contact: { social: string; web: string };
  /** What posters actually use, the pack's rules included. */
  effective: { colors: KitColors; fonts: KitFonts; rules: KitRule[] };
}

export interface CatalogDesign {
  id: string;
  name: string;
  description: string;
  tags: string[];
  formats: PosterFormat[];
  /** The words this design shows; max is a soft character limit. */
  fields: { name: keyof PosterText; required?: boolean; max?: number }[];
  photos: { min: number; max: number };
  sponsors: { min: number; max: number };
  background: 'none' | 'optional' | 'required';
}

export interface CatalogFont {
  id: string;
  family: string;
  category: string;
  note: string | null;
  faces: { path: string; style: string; weight: string; stretch: string | null }[];
}

export interface CatalogPack {
  id: string;
  name: string;
  colors: KitColors;
  fonts: KitFonts;
  rules: KitRule[];
  palette: { name: string; hex: string }[];
}

export interface DesignCatalog {
  designs: CatalogDesign[];
  packs: CatalogPack[];
  fonts: CatalogFont[];
  formats: { id: PosterFormat; label: string; width: number; height: number; print: boolean }[];
}

let catalogCache: Promise<DesignCatalog> | null = null;

export const designAPI = {
  start: (taskId: string, body: StartPosterBody) => api.post<{ job: PosterJob; message: string }>(`/design/tasks/${taskId}/posters`, body).then((r) => r.data.job),
  job: (jobId: string) => api.get<{ job: PosterJob }>(`/design/jobs/${jobId}`).then((r) => r.data.job),
  latestJob: (taskId: string) => api.get<{ job: PosterJob | null }>(`/design/tasks/${taskId}/jobs/latest`).then((r) => r.data.job),
  /** ref: "current" (the post's picture) or a draft id. */
  edit: (taskId: string, ref: string, body: PosterEditBody) => api.post<PosterEditAnswer>(`/design/tasks/${taskId}/posters/${encodeURIComponent(ref)}/edit`, body).then((r) => r.data),
  /** The poster in every other social shape its design has (files, not drafts). */
  sizes: (taskId: string, ref: string) =>
    api
      .post<{ sizes: { format: PosterFormat; url: string }[]; skipped: { format: PosterFormat; reason: string }[] }>(`/design/tasks/${taskId}/posters/${encodeURIComponent(ref)}/sizes`)
      .then((r) => r.data),
  print: (taskId: string, ref: string, size: 'a4' | 'a3') => api.post<{ url: string }>(`/design/tasks/${taskId}/posters/${encodeURIComponent(ref)}/print`, { size }).then((r) => r.data.url),

  catalog: (): Promise<DesignCatalog> => {
    if (!catalogCache) {
      const loading = api.get<DesignCatalog & { success: boolean }>('/design/catalog').then((r) => r.data);
      catalogCache = loading;
      loading.catch(() => {
        catalogCache = null;
      });
      return loading;
    }
    return catalogCache;
  },

  kit: (ownerId?: string) => api.get<{ kit: BrandKit }>('/design/brand-kit', { params: ownerId ? { ownerId } : undefined }).then((r) => r.data.kit),
  saveKit: (body: Partial<Pick<BrandKit, 'name' | 'colors' | 'fonts' | 'rules' | 'notes' | 'contact'>> & { pack?: string | null }, ownerId?: string) =>
    api.put<{ kit: BrandKit }>('/design/brand-kit', body, { params: ownerId ? { ownerId } : undefined }).then((r) => r.data.kit),
  addLogo: (file: File, fields: { role?: 'primary' | 'campaign'; name?: string; logoId?: string }, ownerId?: string) => {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
    return api.post<{ kit: BrandKit; warning: string | null }>('/design/brand-kit/logos', form, { params: ownerId ? { ownerId } : undefined }).then((r) => r.data);
  },
  updateLogo: (logoId: string, body: { name?: string; always?: boolean; clearSpace?: number; minHeight?: number; removeVariant?: string; variantId?: string; variant?: LogoVariantKind }, ownerId?: string) =>
    api.patch<{ kit: BrandKit }>(`/design/brand-kit/logos/${logoId}`, body, { params: ownerId ? { ownerId } : undefined }).then((r) => r.data.kit),
  removeLogo: (logoId: string, ownerId?: string) => api.delete<{ kit: BrandKit }>(`/design/brand-kit/logos/${logoId}`, { params: ownerId ? { ownerId } : undefined }).then((r) => r.data.kit),
  addFont: (file: File, fields: { name?: string; category?: string; fontId?: string }, ownerId?: string) => {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
    return api.post<{ kit: BrandKit; fontId: string; message: string }>('/design/brand-kit/fonts', form, { params: ownerId ? { ownerId } : undefined }).then((r) => r.data);
  },
  removeFont: (fontId: string, ownerId?: string) => api.delete<{ kit: BrandKit }>(`/design/brand-kit/fonts/${fontId}`, { params: ownerId ? { ownerId } : undefined }).then((r) => r.data.kit),
  addPartner: (file: File, name: string, ownerId?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    return api.post<{ kit: BrandKit; warning: string | null }>('/design/brand-kit/partners', form, { params: ownerId ? { ownerId } : undefined }).then((r) => r.data);
  },
  removePartner: (partnerId: string, ownerId?: string) => api.delete<{ kit: BrandKit }>(`/design/brand-kit/partners/${partnerId}`, { params: ownerId ? { ownerId } : undefined }).then((r) => r.data.kit)
};

/** Loads the bundled fonts into the page (once), so the brand kit can show each one. */
const loadedFonts = new Set<string>();
export function loadCatalogFonts(fonts: CatalogFont[]) {
  for (const f of fonts) {
    if (loadedFonts.has(f.id) || typeof FontFace === 'undefined') continue;
    loadedFonts.add(f.id);
    for (const face of f.faces) {
      const descriptors: FontFaceDescriptors = { style: face.style, weight: face.weight };
      if (face.stretch) descriptors.stretch = face.stretch;
      const ff = new FontFace(`kit-${f.id}`, `url(${API_URL}${face.path})`, descriptors);
      ff.load()
        .then((loaded) => document.fonts.add(loaded))
        .catch(() => undefined);
    }
  }
}
/** Shows uploaded fonts on screen (fetched signed-in, so they never need to be public). */
export function loadCustomFonts(fonts: CustomFont[]) {
  for (const f of fonts) {
    if (loadedFonts.has(f.id) || typeof FontFace === 'undefined') continue;
    loadedFonts.add(f.id);
    f.files.forEach((file, i) => {
      api
        .get<ArrayBuffer>(`/design/brand-kit/fonts/${f.id}/files/${i}`, { responseType: 'arraybuffer' })
        .then((r) => new FontFace(`kit-${f.id}`, r.data, { style: file.style, weight: file.weight }).load())
        .then((loaded) => document.fonts.add(loaded))
        .catch(() => undefined);
    });
  }
}

/** The catalogue's fonts plus the account's own, as one list for pickers. */
export function fontChoices(catalog: CatalogFont[], custom: CustomFont[] = []): CatalogFont[] {
  return [...custom.map((c) => ({ id: c.id, family: c.name, category: c.category, note: 'Your font', faces: [] }) as CatalogFont), ...catalog];
}

export const kitFontFamily = (id: string | undefined, fonts: CatalogFont[]) => {
  const f = fonts.find((x) => x.id === id);
  return f ? `"kit-${f.id}", ${f.category === 'serif' ? 'Georgia, serif' : f.category === 'script' ? 'cursive' : 'system-ui, sans-serif'}` : 'inherit';
};

export const POSTER_FORMATS: { value: PosterFormat; label: string; hint: string; ratio: string; print?: boolean }[] = [
  { value: 'portrait', label: 'Portrait', hint: '4:5 · Instagram, Facebook', ratio: '4 / 5' },
  { value: 'square', label: 'Square', hint: '1:1 · every platform', ratio: '1 / 1' },
  { value: 'story', label: 'Story', hint: '9:16 · Status, Stories', ratio: '9 / 16' },
  { value: 'landscape', label: 'Landscape', hint: '3:2 · LinkedIn, X', ratio: '3 / 2' },
  { value: 'a4', label: 'A4 poster', hint: 'Print · notice boards', ratio: '1 / 1.414', print: true }
];

export const STAGE_TEXT: Record<PosterJobStage, string> = {
  queued: 'Waiting to start',
  reading: 'Looking at your photos',
  photo: 'Creating a photo',
  directing: 'Planning the layouts',
  background: 'Painting a background',
  rendering: 'Setting the type',
  checking: 'Checking every detail',
  reviewing: 'Choosing the best ones',
  saving: 'Saving your options',
  done: 'Done'
};


// ---- Design library (system admins) --------------------------------------------------------------

export type AdminDesignStatus = 'builtin' | 'importing' | 'failed' | 'draft' | 'live' | 'retired';

export interface PosterEngineStatus {
  ready: boolean;
  anthropic: boolean;
  openai: boolean;
  fal: boolean;
  renderer: { ok: boolean; error?: string };
  /** How people are cut out of photos ("server model", "SAM 3 / BiRefNet on fal.ai"), or false. */
  cutouts: string | false;
  models: { concept: string; scene_reader: string; review: string; quick_edits: string };
  problems: string[];
}

export const adminDesignAPI = {
  status: () => api.get<PosterEngineStatus & { success: boolean }>('/design/admin/status').then((r) => r.data)
};
