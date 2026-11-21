/** Escape user input before using it in a RegExp (search boxes, connector search). */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" matcher for a search string; null when the input is unusable. */
export function searchRegex(value: unknown): RegExp | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return new RegExp(escapeRegex(value.trim().slice(0, 200)), 'i');
}
