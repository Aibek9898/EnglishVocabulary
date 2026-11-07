import { useMemo, useSyncExternalStore } from 'react';
import { hashRecoveryCode, newRecoveryCodes, newSecret, otpauthUri, verifyTotp } from './totp';

/**
 * Privacy gate for a static site. The site has no server, so this keeps
 * casual visitors out but is not real security: anyone who reads the code
 * can get past it. Only a salted PBKDF2 hash of the password is stored here.
 */
export const USERNAME = 'aibek';
const SALT = 'ec77c2548f7aacc2a00cb298011809c1';
const ITERATIONS = 600_000;
const HASH = '627ec133c350ff712cd48c0e6f7dacf50c1359ecdaae65edae30c024f244f816';

const KEY = 'vocab-session';
const REMEMBER_DAYS = 90;
/** With two-step sign-in on, a device is trusted for a shorter time. */
const TWO_STEP_DAYS = 30;

export const canVerify = typeof crypto !== 'undefined' && !!crypto.subtle;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

async function derive(password: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(SALT), iterations: ITERATIONS }, key, 256);
  return hex(bits);
}

export async function checkLogin(username: string, password: string): Promise<boolean> {
  if (username.trim().toLowerCase() !== USERNAME) {
    // Spend the same time on a wrong username so it can't be told apart.
    await derive(password);
    return false;
  }
  return (await derive(password)) === HASH;
}

interface Session {
  user: string;
  until: number;
}

function read(storage: Storage): Session | null {
  try {
    const s = JSON.parse(storage.getItem(KEY) ?? 'null') as Session | null;
    return s && s.until > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return !!(read(localStorage) ?? read(sessionStorage));
}

export function startSession(remember: boolean) {
  const days = getTwoFactor() ? TWO_STEP_DAYS : REMEMBER_DAYS;
  const session: Session = { user: USERNAME, until: Date.now() + days * 864e5 };
  (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session));
}

export function logout() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
  window.location.reload();
}

/* ============ two-step sign-in ============ */

/** Shown as the account's name in Google Authenticator. */
export const ISSUER = 'Vocab';
const TWO_KEY = 'vocab-2fa';

/**
 * Two-step sign-in for this device. Like the words, it lives only in this
 * browser: not in the site's code and not in backups.
 */
export interface TwoFactor {
  secret: string;
  since: number;
  device: string;
  /** Time step of the last code used, so a code works only once. */
  lastStep: number;
  /** SHA-256 of each recovery code not used yet. */
  recovery: string[];
}

function parseTwoFactor(raw: string | null): TwoFactor | null {
  try {
    const t = JSON.parse(raw ?? 'null') as TwoFactor | null;
    return t && typeof t.secret === 'string' && Array.isArray(t.recovery) ? t : null;
  } catch {
    return null;
  }
}

const readRaw = () => {
  try {
    return localStorage.getItem(TWO_KEY);
  } catch {
    return null;
  }
};

export const getTwoFactor = () => parseTwoFactor(readRaw());

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function saveTwoFactor(t: TwoFactor) {
  localStorage.setItem(TWO_KEY, JSON.stringify(t));
  notify();
}

export function turnOffTwoFactor() {
  localStorage.removeItem(TWO_KEY);
  notify();
}

export function useTwoFactor(): TwoFactor | null {
  const raw = useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, readRaw);
  return useMemo(() => parseTwoFactor(raw), [raw]);
}

/** A short name for this device, so each one gets its own line in the app. */
export function deviceName(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux|CrOS/.test(ua)) return 'computer';
  return 'this device';
}

export interface Setup {
  secret: string;
  account: string;
  device: string;
  uri: string;
}

export function startSetup(): Setup {
  const device = deviceName();
  const secret = newSecret();
  const account = `${USERNAME} on ${device}`;
  return { secret, account, device, uri: otpauthUri(secret, account, ISSUER) };
}

export type StepResult = { ok: true; recoveryLeft?: number } | { ok: false; reason: 'wrong' | 'used' };

/** Turns two-step sign-in on once the first code from the app matches. Returns the recovery codes to show once. */
export async function finishSetup(setup: Setup, code: string): Promise<{ ok: true; codes: string[] } | { ok: false; reason: 'wrong' | 'used' }> {
  const check = await verifyTotp(setup.secret, code);
  if (!check.ok) return check;
  const codes = newRecoveryCodes();
  saveTwoFactor({
    secret: setup.secret,
    since: Date.now(),
    device: setup.device,
    lastStep: check.step,
    recovery: await Promise.all(codes.map(hashRecoveryCode)),
  });
  return { ok: true, codes };
}

/** Checks a 6-digit code from the app, or a recovery code (which then stops working). */
export async function checkSecondStep(input: string): Promise<StepResult> {
  const t = getTwoFactor();
  if (!t) return { ok: true };
  if (/^\d{6}$/.test(input.replace(/\s/g, ''))) {
    const check = await verifyTotp(t.secret, input, { lastStep: t.lastStep });
    if (!check.ok) return check;
    saveTwoFactor({ ...t, lastStep: check.step });
    return { ok: true };
  }
  const hash = await hashRecoveryCode(input);
  if (!input.trim() || !t.recovery.includes(hash)) return { ok: false, reason: 'wrong' };
  const recovery = t.recovery.filter((h) => h !== hash);
  saveTwoFactor({ ...t, recovery });
  return { ok: true, recoveryLeft: recovery.length };
}

/** New recovery codes; the old ones stop working. */
export async function renewRecoveryCodes(): Promise<string[]> {
  const t = getTwoFactor();
  if (!t) return [];
  const codes = newRecoveryCodes();
  saveTwoFactor({ ...t, recovery: await Promise.all(codes.map(hashRecoveryCode)) });
  return codes;
}
