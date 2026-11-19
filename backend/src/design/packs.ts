import type { BrandColors, BrandFonts, BrandRule } from './types';

/**
 * Brand packs: a whole organisation's rules and look, set up once and shared by every member club.
 * A club using the Rotary pack only uploads its own club logo (made in Rotary's Brand Center) and
 * its photos; colours, fonts and rules come from the pack.
 *
 * Sources (checked November 2026): Rotary Brand Center (brandcenter.rotary.org): logo lockups, do's
 * and don'ts, typography, colours; Rotary "Visual identity at a glance" and district brand kits for
 * colour values; the End Polio Now logo guidelines.
 */

export interface LogoRuleDefaults {
  clearSpace: number;
  minHeight: number;
  requiresPrimary?: boolean;
}

export interface BrandPack {
  id: string;
  name: string;
  colors: BrandColors;
  fonts: BrandFonts;
  rules: BrandRule[];
  notes: string;
  logoDefaults: { primary: LogoRuleDefaults; campaign: LogoRuleDefaults };
  /** Extra colours designs may use as accents. */
  palette: { name: string; hex: string }[];
  /** Words the pack suggests above the sponsor logos. */
  sponsorsTitle: string;
}

const ROTARY_RULES: BrandRule[] = [
  {
    id: 'logo-integrity',
    hard: true,
    text: 'Logos are used exactly as supplied: never redrawn, recoloured, stretched, cropped, rotated or given effects.'
  },
  {
    id: 'club-logo',
    hard: true,
    text: 'The club, district or zone logo (made with the Brand Center template) is the main identifier, not the Rotary Masterbrand Signature on its own.'
  },
  {
    id: 'clear-space',
    hard: true,
    text: 'Keep clear space around the club logo equal to the height of the “R” in “Rotary”: no text, logos or graphics inside it.'
  },
  {
    id: 'one-partner-lockup',
    hard: true,
    text: 'A logo lockup can include only one partner, event or sponsor. Other sponsors appear separately, never added to the lockup.'
  },
  {
    id: 'partners-subordinate',
    hard: true,
    text: 'Partner and sponsor logos must not visually overpower the club logo.'
  },
  {
    id: 'end-polio-now',
    hard: true,
    text: 'The End Polio Now logo is only used together with the club logo, with clear space equal to the “P” in “POLIO” around it.'
  },
  {
    id: 'official-colours',
    hard: true,
    text: 'Logos appear only in their official colours (or the official reverse/white version on dark backgrounds).'
  },
  {
    id: 'people-of-action',
    hard: false,
    text: 'Photography shows real people taking action in their community: candid, warm, natural light, not posed group shots.'
  },
  {
    id: 'type',
    hard: false,
    text: 'Headlines in Open Sans (Rotary’s free alternative to Frutiger), body text in Georgia/Gelasio (alternative to Sentinel).'
  }
];

export const ROTARY_PACK: BrandPack = {
  id: 'rotary',
  name: 'Rotary',
  colors: {
    primary: { name: 'Rotary Royal Blue', hex: '#17458f' },
    secondary: { name: 'Azure', hex: '#0067c8' },
    accent: { name: 'Rotary Gold', hex: '#f7a81b' },
    ink: { name: 'Charcoal', hex: '#1f2430' },
    paper: { name: 'White', hex: '#ffffff' }
  },
  palette: [
    { name: 'Sky Blue', hex: '#01b4e7' },
    { name: 'Cranberry', hex: '#d91b5c' },
    { name: 'Turquoise', hex: '#00adbb' },
    { name: 'Violet', hex: '#872175' },
    { name: 'Orange', hex: '#ff7600' }
  ],
  fonts: { display: 'opensans', text: 'gelasio', accent: 'permanentmarker' },
  rules: ROTARY_RULES,
  notes:
    'Rotary’s voice is hopeful, active and specific: what the club did or will do, for whom, and how to join in. Lead with people and impact (“Every child. Every dose.”), not with Rotary itself. Use the club’s name as on its logo. For polio work, the End Polio Now logo may sit beside the club logo.',
  logoDefaults: {
    primary: { clearSpace: 0.3, minHeight: 0.06 },
    campaign: { clearSpace: 0.2, minHeight: 0.05, requiresPrimary: true }
  },
  sponsorsTitle: 'In partnership with'
};

export const ROTARACT_PACK: BrandPack = {
  ...ROTARY_PACK,
  id: 'rotaract',
  name: 'Rotaract',
  colors: {
    primary: { name: 'Cranberry', hex: '#d91b5c' },
    secondary: { name: 'Rotary Royal Blue', hex: '#17458f' },
    accent: { name: 'Rotary Gold', hex: '#f7a81b' },
    ink: { name: 'Charcoal', hex: '#1f2430' },
    paper: { name: 'White', hex: '#ffffff' }
  },
  notes:
    'Rotaract speaks for young leaders: energetic, direct and inclusive. Show members in action. The Rotaract club logo (Brand Center template) is the main identifier.'
};

export const BRAND_PACKS: BrandPack[] = [ROTARY_PACK, ROTARACT_PACK];

export function packById(id: string | null | undefined): BrandPack | undefined {
  return BRAND_PACKS.find((p) => p.id === id);
}
