/**
 * Accounts and the cloud database (Supabase). Turned on when the site is built
 * with VITE_SUPABASE_URL and VITE_SUPABASE_KEY (the public "anon" or
 * "publishable" key: it only lets a signed-in person reach their own rows).
 * Without them the site works as before: one learner, words in this browser.
 *
 * Signing up is closed. The admin makes accounts in Settings → Users, which
 * calls the `admin-users` Edge Function; only that function holds the
 * service key.
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined)?.trim();

export const cloudEnabled = !!(URL_ && KEY);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!cloudEnabled) throw new Error('Accounts are not set up for this site.');
  client ??= createClient(URL_!, KEY!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'vocab-auth' },
  });
  return client;
}

/* ============ who is signed in ============ */

export interface Account {
  id: string;
  email: string;
  name?: string;
}

let session: Session | null = null;
let ready = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function accountOf(s: Session | null): Account | null {
  if (!s) return null;
  const meta = (s.user.user_metadata ?? {}) as { name?: string };
  return { id: s.user.id, email: s.user.email ?? '', name: meta.name || undefined };
}

let cached: { s: Session | null; a: Account | null } = { s: null, a: null };
function current(): Account | null {
  if (cached.s !== session) cached = { s: session, a: accountOf(session) };
  return cached.a;
}

/**
 * Reads the saved session. Works offline: an expired session still opens this
 * device's words, and Supabase refreshes it when the network is back.
 */
let starting: Promise<Account | null> | null = null;
export function initAuth(): Promise<Account | null> {
  starting ??= startAuth();
  return starting;
}

async function startAuth(): Promise<Account | null> {
  if (!cloudEnabled) return null;
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  session = data.session;
  ready = true;
  sb.auth.onAuthStateChange((_event, s) => {
    const before = session?.user.id;
    session = s;
    // Signed out in another tab, or the account was deleted: start clean.
    if (before && !s) window.location.reload();
    else emit();
  });
  emit();
  return current();
}

export function useAccount(): Account | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current,
  );
}

export const authReady = () => ready;

export function currentAccount(): Account | null {
  return current();
}

export class AuthError extends Error {}

export async function signIn(email: string, password: string): Promise<Account> {
  const { data, error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session) {
    if (error && /fetch|network/i.test(error.message)) throw new AuthError("Can't reach the server. Check the internet and try again.");
    throw new AuthError('Wrong email or password.');
  }
  session = data.session;
  emit();
  return current()!;
}

/** Signs out and reloads, so nothing of this account stays open in memory. */
export async function signOut() {
  await supabase()
    .auth.signOut({ scope: 'local' })
    .catch(() => {});
  window.location.replace(window.location.pathname);
}

export async function changePassword(password: string) {
  const { error } = await supabase().auth.updateUser({ password });
  if (error) throw new AuthError(error.message.includes('different') ? 'The new password must be different from the old one.' : "Couldn't change the password. Try again.");
}

/** Is this account the admin? Read from its profile row (only its own is visible). */
export async function isAdmin(): Promise<boolean> {
  const a = current();
  if (!a) return false;
  const { data } = await supabase().from('profiles').select('is_admin').eq('id', a.id).maybeSingle();
  return !!(data as { is_admin?: boolean } | null)?.is_admin;
}

/* ============ admin: accounts of other people ============ */

export interface UserRow {
  id: string;
  email: string;
  name?: string;
  isAdmin: boolean;
  createdAt: string;
  lastSignIn?: string;
}

async function admin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().functions.invoke('admin-users', { body });
  if (error) {
    let message = "The server didn't answer. Try again in a minute.";
    try {
      const res = (error as { context?: Response }).context;
      const j = res ? ((await res.json()) as { error?: string }) : null;
      if (j?.error) message = j.error;
    } catch {
      /* keep the general message */
    }
    throw new AuthError(message);
  }
  return data as T;
}

export const listUsers = () => admin<{ users: UserRow[] }>({ action: 'list' }).then((r) => r.users);
export const createUser = (email: string, password: string, name: string) => admin<{ user: UserRow }>({ action: 'create', email, password, name }).then((r) => r.user);
export const resetPassword = (id: string, password: string) => admin<{ ok: true }>({ action: 'password', id, password });
export const deleteUser = (id: string) => admin<{ ok: true }>({ action: 'delete', id });

/** A password that is easy to dictate: three words of letters and a number. */
export function newPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const pick = (n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => letters[x % letters.length]).join('');
  const num = crypto.getRandomValues(new Uint32Array(1))[0] % 90 + 10;
  return `${pick(4)}-${pick(4)}-${pick(4)}-${num}`;
}
