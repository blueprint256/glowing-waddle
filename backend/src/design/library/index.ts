import type { DesignTemplate } from '../types';
import { heroPhoto } from './heroPhoto';
import { splitPanel } from './splitPanel';
import { artLed } from './artLed';
import { spotlight } from './spotlight';
import { observance } from './observance';
import { boldEvent } from './boldEvent';

/** The built-in designs. Imported designs (admin library) are stored in the database. */
export const BUILTIN_DESIGNS: DesignTemplate[] = [heroPhoto, splitPanel, artLed, spotlight, observance, boldEvent].map((d) => ({ ...d, source: 'builtin' as const }));

export function builtinDesign(id: string): DesignTemplate | undefined {
  return BUILTIN_DESIGNS.find((d) => d.id === id);
}
