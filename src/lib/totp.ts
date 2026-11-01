/**
 * One-time sign-in codes (TOTP, RFC 6238): the 6-digit codes that Google
 * Authenticator and similar apps show, a new one every 30 seconds.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PERIOD = 30;
export const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`Not a base32 letter: ${ch}`);
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

/** A new random secret: 20 bytes, written as 32 base32 letters. */
export function newSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** The code for one counter value (HOTP, RFC 4226). */
export async function hotp(secret: string, counter: number, digits = DIGITS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 255;
    c = Math.floor(c / 256);
  }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const at = mac[mac.length - 1] & 15;
  const num = ((mac[at] & 127) << 24) | (mac[at + 1] << 16) | (mac[at + 2] << 8) | mac[at + 3];
  return String(num % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (time: number) => Math.floor(time / 1000 / PERIOD);

/** The code an authenticator app shows at this moment. */
export function totp(secret: string, time = Date.now(), digits = DIGITS): Promise<string> {
  return hotp(secret, stepAt(time), digits);
}

export type CodeCheck = { ok: true; step: number } | { ok: false; reason: 'wrong' | 'used' };

/**
 * Checks a code, allowing the one before and after (phone clocks drift).
 * A code at or before `lastStep` was already used and is refused.
 */
export async function verifyTotp(secret: string, code: string, { now = Date.now(), lastStep = -1 } = {}): Promise<CodeCheck> {
  const clean = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(clean)) return { ok: false, reason: 'wrong' };
  const current = stepAt(now);
  for (const step of [current, current - 1, current + 1]) {
    if ((await hotp(secret, step)) !== clean) continue;
    return step <= lastStep ? { ok: false, reason: 'used' } : { ok: true, step };
  }
  return { ok: false, reason: 'wrong' };
}

/** The link an authenticator app understands; also what the QR code holds. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}

/** Groups of four, easier to type into an app by hand. */
export const groupKey = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

const CODE_LETTERS = 'abcdefghjkmnpqrstuvwxyz23456789';

/** One-use recovery codes like "k7mqp-3vx9h" (about 50 random bits each). */
export function newRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint32Array(10));
    const s = [...bytes].map((n) => CODE_LETTERS[n % CODE_LETTERS.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const cleanRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Recovery codes are stored hashed, so the list on the device can't be read back. */
export async function hashRecoveryCode(code: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cleanRecoveryCode(code)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
