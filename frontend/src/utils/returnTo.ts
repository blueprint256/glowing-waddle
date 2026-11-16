/**
 * Remembers where to send the user after they sign in (used by the Claude connection consent screen).
 * Only same-site paths are accepted, and the value expires after 15 minutes.
 */
const KEY = 'blueprint:returnTo';
const MAX_AGE_MS = 15 * 60 * 1000;

function isSafePath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

export function setReturnTo(path: string): void {
  if (!isSafePath(path)) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    /* storage unavailable: the user can restart the connection from Claude */
  }
}

export function getReturnTo(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw);
    if (!isSafePath(path) || typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

export function clearReturnTo(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
