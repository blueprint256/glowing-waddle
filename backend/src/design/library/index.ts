import type { DesignTemplate } from '../types';
import { heroPhoto } from './heroPhoto';

/** The built-in designs. Imported designs (admin library) are stored in the database. */
export const BUILTIN_DESIGNS: DesignTemplate[] = [heroPhoto].map((d) => ({ ...d, source: 'builtin' as const }));

export function builtinDesign(id: string): DesignTemplate | undefined {
  return BUILTIN_DESIGNS.find((d) => d.id === id);
}
