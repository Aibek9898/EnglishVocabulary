/**
 * Privacy gate for a static site. The site has no server, so this keeps
 * casual visitors out but is not real security: anyone who reads the code
 * can get past it. Only a salted PBKDF2 hash of the password is stored here.
 */
const USERNAME = 'aibek';
const SALT = 'd37e982ff94382e65797a43cc2c4fe4b';
const ITERATIONS = 600_000;
const HASH = '27e4dbe0d34af7bd2831f9668afaf64510f3767824580648a4f990c0a9132378';

const KEY = 'vocab-session';
const REMEMBER_DAYS = 90;

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
  const session: Session = { user: USERNAME, until: Date.now() + REMEMBER_DAYS * 864e5 };
  (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session));
}

export function logout() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
  window.location.reload();
}
