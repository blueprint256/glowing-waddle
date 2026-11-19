/**
 * The poster engine's data shapes (docs/DESIGN_ENGINE.md).
 *
 * A poster is never a flat AI picture. It is a DesignDoc: which design from the library it uses, the
 * design's settings, and the content of each slot (words, photos, logos, sponsors, the optional AI
 * background). The renderer turns a DesignDoc into pixels (or a print PDF) the same way every time,
 * so an edit changes only what was asked and logos, words and photos come out exactly right.
 */

/** Poster shapes. Sizes are design pixels (the canvas); output can be rendered at a higher scale. */
export type FormatId = 'square' | 'portrait' | 'story' | 'landscape' | 'a4' | 'a3';

export interface FormatInfo {
  id: FormatId;
  label: string;
  width: number;
  height: number;
  /** Device scale used for the delivered file (print is rendered at 300 dpi). */
  scale: number;
  print?: boolean;
}

/** One line of practical detail on a poster (when, where, how to join). */
export interface DetailLine {
  kind: 'date' | 'time' | 'place' | 'phone' | 'web' | 'info';
  text: string;
}

/** A round or square badge, e.g. a date: "SAT" / "14" / "DEC". */
export interface BadgeContent {
  top?: string;
  main: string;
  bottom?: string;
}

/** The words on a poster. Each design shows the fields it supports (DesignTemplate.fields). */
export interface DesignText {
  eyebrow?: string;
  headline: string;
  subhead?: string;
  body?: string;
  details?: DetailLine[];
  cta?: string;
  footnote?: string;
  hashtag?: string;
  badge?: BadgeContent;
  /** Shown above the sponsor logos, e.g. "In partnership with". */
  sponsorsTitle?: string;
  /** A featured person (speaker, guest, honoree): the tab above the card, their name and role. */
  personLabel?: string;
  personName?: string;
  personRole?: string;
  /** The account's handle line, e.g. "Rotaract D9213", and website. */
  social?: string;
  web?: string;
  /** Impact figures for a report-back poster, e.g. { value: "312", label: "children vaccinated" }.
   *  Only ever figures the club gave: never invented. */
  stats?: StatLine[];
}

export interface StatLine {
  value: string;
  label: string;
}

/** Where to keep a photo's subject in view (0..1 from the left/top), and its face area if known. */
export interface FocalPoint {
  x: number;
  y: number;
  /** The subject's box (0..1), used so crops never cut through a face or a person. */
  box?: { x: number; y: number; w: number; h: number };
  /** How many people (from the art director). */
  people?: number;
  /** The box around all the faces (0..1): words must stay off it, crops must keep it. */
  faces?: { x: number; y: number; w: number; h: number };
}

/** Sides where the photo's own frame cut the subject (a straight edge the design should soften). */
export interface CutEdges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

export interface PhotoSlot {
  /** Storage address (or an asset key in tests). */
  url: string;
  width: number;
  height: number;
  focal: FocalPoint;
  /** Who's in it, from the Library's reading (helps the art director pick and caption). */
  description?: string;
  /** Consent recorded for photos of people (required for photos with children). */
  consent?: boolean;
  /** The subject cut out of its background (transparent PNG, trimmed to the person). */
  cutout?: { url: string; width: number; height: number; edges?: CutEdges } | null;
}

export type LogoVariant = 'color' | 'reverse' | 'mono-dark' | 'mono-light';

/** A logo file as prepared by assets.ts: trimmed, with its real (visible) shape. */
export interface LogoAsset {
  id: string;
  url: string;
  variant: LogoVariant;
  /** Visible content size after trimming (pixels of the stored file). */
  width: number;
  height: number;
  /** Share of the trimmed box covered by ink (0..1): dense logos look bigger at the same size. */
  ink: number;
  /** Mean lightness of the ink (0 dark .. 1 light). */
  lightness: number;
  /** Reads on light backgrounds (has dark or coloured ink, isn't mostly white). */
  onLight: boolean;
  /** Reads on dark backgrounds (no significant dark ink). */
  onDark: boolean;
  /** Luminance of the ink along the outline (16 quantiles): the engine picks the version that
   *  reaches 3:1 against what's actually behind it. Older files without it use onLight/onDark. */
  edge?: number[];
  /** Made from the uploaded file (the one-colour white or dark version), not supplied. */
  derived?: boolean;
}

/** A brand's logo with its variants and placement rules. */
export interface BrandLogo {
  id: string;
  name: string;
  /** primary: the club/company logo; campaign: e.g. End Polio Now; partner: a sponsor. */
  role: 'primary' | 'campaign' | 'partner';
  variants: LogoAsset[];
  /** Clear space around the logo as a share of its height (Rotary: the height of the R). */
  clearSpace: number;
  /** Smallest allowed height as a share of the poster's short side. */
  minHeight: number;
  /** campaign logos: only allowed when the primary logo is on the poster too. */
  requiresPrimary?: boolean;
}

export interface SponsorSlot {
  name: string;
  logo: LogoAsset;
  /** Other versions of the partner's logo (its one-colour white or dark version). */
  alts?: LogoAsset[];
}

/** The optional AI-made background or illustration (never text, never logos). */
export interface BackgroundSlot {
  url: string;
  width: number;
  height: number;
  /** The brief it was made from (kept so a new one can be asked for). */
  prompt?: string;
}

/** A colour with its role in the brand. */
export interface BrandColor {
  name: string;
  hex: string;
}

export interface BrandColors {
  primary: BrandColor;
  secondary: BrandColor;
  accent: BrandColor;
  /** Dark text colour and light page colour. */
  ink: BrandColor;
  paper: BrandColor;
  extra?: BrandColor[];
}

/** An uploaded font family (served to the renderer like any other file of the poster). */
export interface CustomFont {
  id: string;
  name: string;
  category: 'sans' | 'serif' | 'display' | 'condensed' | 'script';
  files: { url: string; style: 'normal' | 'italic'; weight: string; format: 'truetype' | 'opentype' | 'woff' | 'woff2' }[];
}

export interface BrandFonts {
  /** Headlines (a family id from fonts.ts). */
  display: string;
  /** Body text, details, small print. */
  text: string;
  /** Optional hand-written or expressive accent. */
  accent?: string;
}

/**
 * A rule the app enforces in code. `hard` rules can't be overridden in the app (the user is told why
 * and offered the allowed alternative); everything else is a default the user may change.
 */
export interface BrandRule {
  id: string;
  text: string;
  hard: boolean;
}

export interface BrandKit {
  name: string;
  /** A brand pack the kit follows, e.g. "rotary" (adds the pack's rules and defaults). */
  pack?: string | null;
  colors: BrandColors;
  fonts: BrandFonts;
  /** Fonts the account uploaded; fonts.display/text/accent may name them by id. */
  customFonts?: CustomFont[];
  logos: BrandLogo[];
  rules: BrandRule[];
  /** Free-text guidance for the art director (tone, photography, do's and don'ts). */
  notes?: string;
  /** Put on posters whose design has a contact line: the social handle and the website. */
  contact?: { social?: string; web?: string };
}

/** A design's setting the art director may choose (inside the design's limits). */
export type DesignParam =
  /** roomy: which end gives the words more room or keeps them off faces (used when a poster fails its checks). */
  | { key: string; label: string; type: 'number'; min: number; max: number; default: number; step?: number; roomy?: 'min' | 'max' }
  | { key: string; label: string; type: 'choice'; options: string[]; default: string }
  | { key: string; label: string; type: 'color'; default: 'primary' | 'secondary' | 'accent' | 'ink' | 'paper' }
  | { key: string; label: string; type: 'toggle'; default: boolean };

export type TextField = keyof DesignText;

/**
 * A design in the library: a parametric layout written as HTML and CSS against the engine's runtime
 * (assets/design-runtime/engine.js). No scripts and no outside addresses are allowed in it
 * (template.ts checks). Built-in designs live in design/library; imported ones in the database.
 */
export interface DesignTemplate {
  id: string;
  version: number;
  name: string;
  description: string;
  /** For the art director's choice, e.g. "photo-led", "event", "many sponsors". */
  tags: string[];
  formats: FormatId[];
  /** Text fields the design shows; `max` is a soft character limit the art director keeps to. */
  fields: { name: TextField; required?: boolean; max?: number }[];
  /** Whether the design shows the first photo's subject cut out: required (skipped without one),
   *  preferred (it has a look for photos without one), or not used. */
  cutout?: 'required' | 'preferred';
  photos: { min: number; max: number };
  sponsors: { min: number; max: number };
  /** "none": no AI background; "optional"/"required": the design has an area for one. */
  background: 'none' | 'optional' | 'required';
  /** What kind of background art fits this design (given to the image model). */
  backgroundBrief?: string;
  /** The background area's shape (width / height of the poster share it covers). */
  backgroundArea?: { w: number; h: number };
  params: DesignParam[];
  html: string;
  css: string;
  /** Where it came from: built-in, or imported by an admin from a reference. */
  source?: 'builtin' | 'imported';
}

/** One poster option: everything needed to render it again, exactly. */
export interface DesignDoc {
  version: 1;
  designId: string;
  designVersion: number;
  format: FormatId;
  params: Record<string, number | string | boolean>;
  text: DesignText;
  photos: PhotoSlot[];
  /** Which brand logos appear: the primary is always included; campaign logos are optional. */
  logos: { primary: string; campaign?: string[] };
  sponsors: SponsorSlot[];
  background?: BackgroundSlot | null;
  /** Small per-element nudges a user asked for (bigger headline, hide the footnote). */
  tweaks?: DesignTweaks;
}

export interface DesignTweaks {
  /** Headline size multiplier (0.75 .. 1.3). */
  headlineScale?: number;
  /** Fields to hide although they have text. */
  hide?: TextField[];
  /** Photo crop override per photo (focal point). */
  focus?: Record<number, { x: number; y: number }>;
  /** Swap which brand colour plays which role for this poster. */
  colorSwap?: boolean;
}

/** An element the renderer measured, for the code checks. */
export interface MeasuredElement {
  key: string;
  kind: 'text' | 'logo' | 'sponsor' | 'badge' | 'photo' | 'panel' | 'cutout';
  field?: string;
  box: { x: number; y: number; w: number; h: number };
  /** Text only. */
  fontSize?: number;
  color?: string;
  overflow?: boolean;
  lines?: number;
  /** Text: share of it lying on a cut-out person (0..1). */
  overPerson?: number;
  /** Text on its own coloured shape: the shape's inner area, where contrast is judged. */
  inner?: { x: number; y: number; w: number; h: number };
  /** Photos: how much the file is enlarged on the poster (poster px per photo px, before print scale). */
  upscale?: number;
  /** Logos: the version shown (e.g. "color", "mono-light-derived"), and its plate if it needed one. */
  variant?: string;
  plated?: 'light' | 'dark';
  /** Text: share of it lying on a photo when the rest lies off it (it crosses the photo's edge). */
  photoEdge?: number;
  /** Text: share of it that something else (photo, shape, block) sits on top of (0..1). */
  covered?: number;
  /** The share of it the design allows a cut-out person to cover (data-person-ok). */
  personOk?: number;
  /** Text: lies on a photo's subject (its face, from the focal point). */
  overSubject?: boolean;
  /** Logos: clear space (px) to keep free around it. */
  clearSpace?: number;
  /** Logos/sponsors: which logo. */
  logoId?: string;
  /** Logos/sponsors: visible area in px² (ink-weighted). */
  visualArea?: number;
  /** Why an element was flagged (for people tuning designs). */
  why?: string;
}

export type IssueLevel = 'error' | 'warning';

export interface DesignIssue {
  level: IssueLevel;
  code: string;
  message: string;
  key?: string;
}

export interface RenderReport {
  format: FormatId;
  width: number;
  height: number;
  elements: MeasuredElement[];
  issues: DesignIssue[];
  /** Lowest text contrast found (WCAG ratio). */
  minContrast?: number;
  ms: number;
}
