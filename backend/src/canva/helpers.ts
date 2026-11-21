/** Pure Canva helpers (no database), shared by the client and tests. */

/** Fit a picture into Canva's custom-size limits (40–8000 px per side) keeping its shape. */
export function canvaDesignSize(width = 1080, height = 1080): { width: number; height: number } {
  let w = Math.max(1, width);
  let h = Math.max(1, height);
  const down = Math.min(1, 8000 / w, 8000 / h);
  w *= down;
  h *= down;
  const up = Math.max(1, 40 / w, 40 / h);
  return { width: Math.round(Math.min(8000, w * up)), height: Math.round(Math.min(8000, h * up)) };
}

/** Read correlation_state from Canva's return token (we only use it to find our own record). */
export function correlationFromJwt(jwt: string): { correlationState?: string; designId?: string } {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] || '', 'base64url').toString('utf8'));
    return { correlationState: payload.correlation_state, designId: payload.design_id };
  } catch {
    return {};
  }
}
