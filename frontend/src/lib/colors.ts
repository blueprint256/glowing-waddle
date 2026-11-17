/**
 * A steady colour per campaign (calendar cards, chips), picked from its id so it never changes.
 * Colours: --cp-1 … --cp-8 in styles/tokens.css.
 */
export function campaignColor(campaignId: unknown): string {
  const key = String((campaignId && typeof campaignId === 'object' ? (campaignId as any)._id || (campaignId as any).id : campaignId) || '');
  if (!key) return 'var(--border-strong)';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `var(--cp-${(h % 8) + 1})`;
}
