/**
 * Sync between devices through a private GitHub repository that belongs to the
 * learner. The site has no server, so each device talks to GitHub directly
 * with a key (fine-grained token) limited to that one repository.
 *
 * The repository holds one gzipped JSON file. Each upload replaces the
 * branch with a single new commit, so the repository stays small however
 * often it syncs.
 */
import { useSyncExternalStore } from 'react';
import { reviveItem } from './backup';
import { db, getSettings } from './db';
import { getRemoved } from './removed';
import { getSaved } from './saved';
import { baseOf, itemHash, LOCAL_SETTINGS, mergeSnapshots, reviewKey, snapshotHash, withoutLocalSettings, type Snapshot, type SyncBase } from './syncMerge';
import type { Item, ReviewEntry, Settings } from './types';

const API = 'https://api.github.com';
const FILE = 'vocab-sync.json.gz';
const CONFIG_KEY = 'sync';
const BASE_KEY = 'syncBase';
/** kv rows that travel with the words; everything else stays on the device. */
const SYNCED_KV = new Set(['settings', 'saved', 'removed', 'coursePacks']);

export const DEFAULT_REPO = 'vocab-sync';

export interface SyncConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  connectedAt: number;
  lastSync?: number;
}

export class SyncError extends Error {}
class Conflict extends Error {}

/* ============ status for the UI ============ */

export interface SyncStatus {
  state: 'off' | 'idle' | 'syncing' | 'error';
  lastSync?: number;
  error?: string;
}

let status: SyncStatus = { state: 'off' };
const listeners = new Set<() => void>();
function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const row = await db.kv.get(CONFIG_KEY);
  const c = row?.value as SyncConfig | undefined;
  return c && typeof c.token === 'string' ? c : null;
}

/* ============ GitHub ============ */

function friendly(res: Response, what: string): SyncError {
  if (res.status === 401) return new SyncError("GitHub doesn't accept the key any more (it may have expired). Make a new key and connect again.");
  if (res.status === 403)
    return new SyncError(
      res.headers.get('x-ratelimit-remaining') === '0'
        ? 'GitHub asked to slow down. Sync will try again in a while.'
        : "The key isn't allowed to change this repository. It needs Contents: Read and write.",
    );
  if (res.status === 404) return new SyncError(`GitHub can't find ${what}, or the key has no access to it.`);
  return new SyncError(`GitHub answered ${res.status}. Try again in a minute.`);
}

async function gh(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  try {
    return await fetch(API + path, {
      method: init.method ?? 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new SyncError("Can't reach GitHub. It will sync when you're online.");
  }
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw friendly(res, what);
  return (await res.json()) as T;
}

/** Checks the key and the repository, and refuses a public repository. */
export async function connect(token: string, repoName = DEFAULT_REPO): Promise<SyncConfig> {
  const key = token.trim();
  const repo = repoName.trim().replace(/^.*github\.com\//, '').replace(/^[^/]+\//, '') || DEFAULT_REPO;
  if (!key) throw new SyncError('Paste the key first.');
  if (/\s/.test(key)) throw new SyncError('The key has a space in it. Copy it again.');
  if (!/^(github_pat_|ghp_)/.test(key)) throw new SyncError('That doesn\'t look like a GitHub key. It starts with "github_pat_".');
  const user = await json<{ login: string }>(await gh(key, '/user'), 'your account');
  const info = await json<{ private: boolean; default_branch?: string; permissions?: { push?: boolean } }>(
    await gh(key, `/repos/${user.login}/${repo}`),
    `${user.login}/${repo}`,
  );
  if (!info.private) throw new SyncError(`${user.login}/${repo} is public, so anyone could read your words. Make it private on GitHub first.`);
  if (info.permissions && info.permissions.push === false) throw new SyncError("The key can read this repository but not change it. It needs Contents: Read and write.");
  return { token: key, owner: user.login, repo, branch: info.default_branch || 'main', connectedAt: Date.now() };
}

export async function saveSyncConfig(config: SyncConfig) {
  await db.kv.put({ key: CONFIG_KEY, value: config });
  setStatus({ state: 'idle', lastSync: config.lastSync, error: undefined });
}

/** Stops syncing on this device. The words stay here and on GitHub. */
export async function disconnect() {
  await db.kv.delete(CONFIG_KEY);
  await db.kv.delete(BASE_KEY);
  setStatus({ state: 'off', lastSync: undefined, error: undefined });
}

/** After a restore, the next sync combines instead of treating missing words as deleted. */
export async function forgetSyncBase() {
  await db.kv.delete(BASE_KEY);
}

/* ============ the file ============ */

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

interface SyncFile extends Snapshot {
  app: 'english-vocabulary';
  kind: 'sync';
  version: 1;
  savedAt: string;
}

function parseFile(text: string): Snapshot {
  const f = JSON.parse(text) as Partial<SyncFile>;
  if (f.app !== 'english-vocabulary' || f.kind !== 'sync' || !Array.isArray(f.items)) throw new SyncError("The file on GitHub isn't from this app.");
  return {
    items: f.items.map(reviveItem),
    reviews: Array.isArray(f.reviews) ? f.reviews : [],
    settings: f.settings ?? {},
    saved: Array.isArray(f.saved) ? f.saved : [],
    removed: Array.isArray(f.removed) ? f.removed : [],
    coursePacks: Array.isArray(f.coursePacks) ? f.coursePacks : [],
  };
}

interface Remote {
  /** The commit the file was read from; null for an empty repository. */
  commit: string | null;
  snapshot: Snapshot | null;
}

async function readRemote(c: SyncConfig): Promise<Remote> {
  const where = `${c.owner}/${c.repo}`;
  const ref = await gh(c.token, `/repos/${where}/git/ref/heads/${c.branch}`);
  // 409: the repository is still empty.
  if (ref.status === 409 || ref.status === 404) {
    if (ref.status === 404) await json(await gh(c.token, `/repos/${where}`), where);
    return { commit: null, snapshot: null };
  }
  const commit = (await json<{ object: { sha: string } }>(ref, where)).object.sha;
  const res = await gh(c.token, `/repos/${where}/contents/${FILE}?ref=${commit}`);
  if (res.status === 404) return { commit, snapshot: null };
  const meta = await json<{ sha: string; content?: string; encoding?: string }>(res, where);
  let b64 = meta.content;
  // Files over 1 MB come without content; the blob API has it.
  if (!b64 || meta.encoding !== 'base64') b64 = (await json<{ content: string }>(await gh(c.token, `/repos/${where}/git/blobs/${meta.sha}`), where)).content;
  return { commit, snapshot: parseFile(await gunzip(fromBase64(b64))) };
}

async function writeRemote(c: SyncConfig, snap: Snapshot, readFrom: string | null) {
  const where = `${c.owner}/${c.repo}`;
  const file: SyncFile = { app: 'english-vocabulary', kind: 'sync', version: 1, savedAt: new Date().toISOString(), ...snap };
  const content = toBase64(await gzip(JSON.stringify(file)));
  const message = `Sync from ${deviceLabel()}`;
  if (!readFrom) {
    // An empty repository: the contents API makes the first commit.
    const res = await gh(c.token, `/repos/${where}/contents/${FILE}`, { method: 'PUT', body: { message, content } });
    if (res.status === 409 || res.status === 422) throw new Conflict();
    await json(res, where);
    return;
  }
  const blob = await json<{ sha: string }>(await gh(c.token, `/repos/${where}/git/blobs`, { method: 'POST', body: { content, encoding: 'base64' } }), where);
  const tree = await json<{ sha: string }>(
    await gh(c.token, `/repos/${where}/git/trees`, { method: 'POST', body: { tree: [{ path: FILE, mode: '100644', type: 'blob', sha: blob.sha }] } }),
    where,
  );
  // No parent: the old copies drop out of the repository.
  const commit = await json<{ sha: string }>(await gh(c.token, `/repos/${where}/git/commits`, { method: 'POST', body: { message, tree: tree.sha, parents: [] } }), where);
  const now = await json<{ object: { sha: string } }>(await gh(c.token, `/repos/${where}/git/ref/heads/${c.branch}`), where);
  if (now.object.sha !== readFrom) throw new Conflict();
  await json(await gh(c.token, `/repos/${where}/git/refs/heads/${c.branch}`, { method: 'PATCH', body: { sha: commit.sha, force: true } }), where);
}

function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'a computer';
}

/* ============ this device ============ */

async function localSnapshot(): Promise<{ snap: Snapshot; reviews: ReviewEntry[]; settings: Settings }> {
  const settings = await getSettings();
  const reviews = await db.reviews.toArray();
  const course = (await db.kv.get('coursePacks'))?.value;
  return {
    reviews,
    settings,
    snap: {
      items: await db.items.toArray(),
      reviews: reviews.map(({ id: _id, ...r }) => r),
      settings: withoutLocalSettings(settings),
      saved: await getSaved(),
      removed: await getRemoved(),
      coursePacks: Array.isArray(course) ? course : [],
    },
  };
}

/** Writes the merged library to this device, touching only what differs. */
async function applyLocal(merged: Snapshot, current: { snap: Snapshot; reviews: ReviewEntry[]; settings: Settings }, remap: Map<string, string>) {
  const local = new Map(current.snap.items.map((i) => [i.id, i]));
  const keep = new Set(merged.items.map((i) => i.id));
  const put: Item[] = merged.items.filter((i) => {
    const l = local.get(i.id);
    return !l || itemHash(l) !== itemHash(i);
  });
  const drop = [...local.keys()].filter((id) => !keep.has(id));
  if (drop.length) await db.items.bulkDelete(drop);
  if (put.length) await db.items.bulkPut(put);

  const wanted = new Set(merged.reviews.map(reviewKey));
  const have = new Set<string>();
  for (const r of current.reviews) {
    const itemId = remap.get(r.itemId) ?? r.itemId;
    const key = reviewKey({ ...r, itemId });
    if (!wanted.has(key) || have.has(key)) {
      await db.reviews.delete(r.id!);
      continue;
    }
    have.add(key);
    if (itemId !== r.itemId) await db.reviews.update(r.id!, { itemId });
  }
  const add = merged.reviews.filter((r) => !have.has(reviewKey(r)));
  if (add.length) await db.reviews.bulkAdd(add);

  const local1 = Object.fromEntries(LOCAL_SETTINGS.map((k) => [k, current.settings[k]]));
  await db.kv.put({ key: 'settings', value: { ...current.settings, ...merged.settings, ...local1 } });
  await db.kv.put({ key: 'saved', value: merged.saved });
  await db.kv.put({ key: 'removed', value: merged.removed });
  await db.kv.put({ key: 'coursePacks', value: merged.coursePacks });
}

/* ============ syncing ============ */

let applying = false;
let running: Promise<SyncSummary | null> | null = null;

export interface SyncSummary {
  words: number;
  uploaded: boolean;
  changedHere: boolean;
}

/** What is on GitHub right now, to ask how to join a device that already has words. */
export async function peekRemote(c: SyncConfig): Promise<{ words: number } | null> {
  const r = await readRemote(c);
  return r.snapshot ? { words: r.snapshot.items.length } : null;
}

/**
 * Syncs now. `first: 'replace'` makes this device a copy of the synced words
 * (for joining a new device); otherwise both sides are combined.
 */
export function syncNow(opts: { first?: 'replace' | 'combine' } = {}): Promise<SyncSummary | null> {
  if (running) return running;
  const run = async (): Promise<SyncSummary | null> => {
    const config = await getSyncConfig();
    if (!config) {
      setStatus({ state: 'off' });
      return null;
    }
    setStatus({ state: 'syncing', error: undefined });
    try {
      for (let attempt = 0; ; attempt++) {
        const remote = await readRemote(config);
        let merged!: Snapshot;
        let changedHere = false;
        applying = true;
        try {
          await db.transaction('rw', db.items, db.reviews, db.kv, async () => {
            const current = await localSnapshot();
            const base = opts.first ? null : ((await db.kv.get(BASE_KEY))?.value as SyncBase | undefined) ?? null;
            let remap = new Map<string, string>();
            if (!remote.snapshot) merged = current.snap;
            else if (opts.first === 'replace') merged = remote.snapshot;
            else ({ merged, remap } = mergeSnapshots(current.snap, remote.snapshot, base));
            changedHere = snapshotHash(merged) !== snapshotHash(current.snap);
            if (changedHere) await applyLocal(merged, current, remap);
          });
        } finally {
          applying = false;
        }
        const upload = snapshotHash(merged) !== snapshotHash(remote.snapshot);
        if (upload) {
          try {
            await writeRemote(config, merged, remote.commit);
          } catch (e) {
            if (e instanceof Conflict && attempt < 3) continue;
            if (e instanceof Conflict) throw new SyncError('Another device was syncing at the same time. Try again.');
            throw e;
          }
        }
        // Only now is the synced copy known to match: the next merge starts from here.
        const lastSync = Date.now();
        await db.kv.put({ key: BASE_KEY, value: baseOf(merged) });
        await db.kv.put({ key: CONFIG_KEY, value: { ...config, lastSync } });
        dirty = false;
        setStatus({ state: 'idle', lastSync, error: undefined });
        return { words: merged.items.length, uploaded: upload, changedHere };
      }
    } catch (e) {
      const error = e instanceof SyncError ? e.message : 'Sync failed. It will try again later.';
      if (!(e instanceof SyncError)) console.error(e);
      setStatus({ state: 'error', error });
      throw e instanceof SyncError ? e : new SyncError(error);
    }
  };
  // One sync at a time, also across tabs.
  const locked = (): Promise<SyncSummary | null> =>
    typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('vocab-sync', () => run()).then((r) => r) : run();
  const p = locked().finally(() => {
    running = null;
  });
  running = p;
  return p;
}

/* ============ automatic syncing ============ */

let dirty = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
const AFTER_CHANGE = 20_000;
const ON_RETURN = 60_000;

const quiet = () => syncNow().catch(() => {});

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (document.visibilityState === 'visible' || dirty) quiet();
  }, ms);
}

function markDirty(table: string, key: unknown) {
  if (applying || (table === 'kv' && !SYNCED_KV.has(String(key)))) return;
  dirty = true;
  if (status.state !== 'off') schedule(AFTER_CHANGE);
}

/** Syncs on start, a little after each change, when the app comes back and when it's put away. */
export async function startAutoSync() {
  if (started) return;
  started = true;
  for (const [name, table] of [
    ['items', db.items],
    ['reviews', db.reviews],
    ['kv', db.kv],
  ] as const) {
    (table as typeof db.kv).hook('creating', (key) => markDirty(name, key));
    (table as typeof db.kv).hook('updating', (_mods, key) => markDirty(name, key));
    (table as typeof db.kv).hook('deleting', (key) => markDirty(name, key));
  }
  document.addEventListener('visibilitychange', () => {
    if (status.state === 'off') return;
    if (document.visibilityState === 'hidden') {
      if (dirty) quiet();
    } else if (!status.lastSync || Date.now() - status.lastSync > ON_RETURN || dirty) quiet();
  });
  window.addEventListener('online', () => {
    if (status.state !== 'off') quiet();
  });
  const config = await getSyncConfig();
  if (config) {
    setStatus({ state: 'idle', lastSync: config.lastSync });
    quiet();
  }
}
