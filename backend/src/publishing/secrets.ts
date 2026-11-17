import crypto from 'crypto';

/**
 * Encryption for stored platform tokens and app secrets (AES-256-GCM, key derived from ENCRYPTION_KEY).
 * Values look like "g1:<iv>:<tag>:<data>" so they can't be confused with plain text.
 */
function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || 'default-32-char-encryption-key!!';
  return crypto.createHash('sha256').update(`blueprint-publishing:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `g1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(value?: string | null): string {
  if (!value) return '';
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'g1') throw new Error('Unreadable secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
}

/** "abcd…wxyz" style hint so admins can recognise a saved secret without seeing it. */
export function maskSecret(plain: string): string {
  if (!plain) return '';
  return plain.length <= 8 ? '••••' : `${plain.slice(0, 3)}…${plain.slice(-3)}`;
}

/** PKCE (RFC 7636) verifier + S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
