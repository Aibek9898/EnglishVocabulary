/**
 * Merging two copies of the library (this device and the synced copy) without
 * losing work on either side. Pure functions, so they can be tested without a
 * browser.
 *
 * - Words are matched by pack + word (ids differ when two devices added the
 *   same pack on their own), or by id for the learner's own words.
 * - With the state from the last sync ("base") we know who changed what:
 *   a word changed on one side only takes that side; changed on both, the one
 *   practised most recently wins; deleted on one side and untouched on the
 *   other, it stays deleted.
 * - Reviews are a log: both sides' entries are kept.
 */
import { termKey } from './content';
import type { SavedPhrase } from './saved';
import type { Item, ReviewEntry, Settings } from './types';

export interface Snapshot {
  items: Item[];
  /** Without the local database id. */
  reviews: ReviewEntry[];
  settings: Partial<Settings>;
  saved: SavedPhrase[];
  removed: string[];
  coursePacks: string[];
}

/** What both sides looked like after the last sync. */
export interface SyncBase {
  items: Record<string, string>;
  saved: string[];
  removed: string[];
  settings: Partial<Settings>;
}

/** Settings that belong to one device: voices differ between a phone and a computer. */
export const LOCAL_SETTINGS: (keyof Settings)[] = ['voiceName'];

export const itemKey = (i: Pick<Item, 'id' | 'deck' | 'term'>) => (i.deck === 'own' ? `own:${i.id}` : `${i.deck}|${termKey(i.term)}`);
export const reviewKey = (r: Pick<ReviewEntry, 'itemId' | 'at' | 'exercise'>) => `${r.itemId}|${r.at}|${r.exercise}`;
const savedKey = (s: SavedPhrase) => termKey(s.text);

/** JSON with sorted keys, so equal data always gives the same text. Dates become ISO strings. */
export function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stable(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A short fingerprint of a string (cyrb53); only used to spot changes. */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The word's content and progress, ignoring its id. */
export const itemHash = (i: Item) => hash(stable({ ...i, id: undefined }));

const time = (d: unknown) => (d instanceof Date ? d.getTime() : typeof d === 'string' ? Date.parse(d) || 0 : typeof d === 'number' ? d : 0);

function lastPractice(reviews: ReviewEntry[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const r of reviews) if (r.at > (last.get(r.itemId) ?? 0)) last.set(r.itemId, r.at);
  return last;
}

/** When the word was last worked on, to settle a word changed on both devices. */
function activity(item: Item, last: Map<string, number>): number {
  return Math.max(item.createdAt || 0, time(item.card?.last_review), last.get(item.id) ?? 0, ...(item.mySentences ?? []).map((s) => s.at || 0));
}

function byKey(items: Item[], last: Map<string, number>, remap: Map<string, string>): Map<string, Item> {
  const map = new Map<string, Item>();
  for (const item of items) {
    const key = itemKey(item);
    const other = map.get(key);
    if (!other) {
      map.set(key, item);
      continue;
    }
    // The same pack word twice on one side: keep the one worked on most.
    const [keep, drop] = activity(item, last) > activity(other, last) ? [item, other] : [other, item];
    map.set(key, keep);
    remap.set(drop.id, keep.id);
  }
  return map;
}

/** Three-way merge of a list: kept when on both sides, or added on one side since the last sync. */
export function mergeList<T>(local: T[], remote: T[], base: string[] | undefined, key: (t: T) => string): T[] {
  const b = base ? new Set(base) : null;
  const l = new Map(local.map((x) => [key(x), x]));
  const r = new Map(remote.map((x) => [key(x), x]));
  const out = new Map<string, T>();
  for (const [k, x] of l) if (r.has(k) || !b?.has(k)) out.set(k, x);
  for (const [k, x] of r) if (!l.has(k) && !b?.has(k)) out.set(k, x);
  return [...out.values()];
}

export function withoutLocalSettings(settings: Partial<Settings>): Partial<Settings> {
  const out = { ...settings };
  for (const k of LOCAL_SETTINGS) delete out[k];
  return out;
}

function mergeSettings(local: Partial<Settings>, remote: Partial<Settings>, base: Partial<Settings> | undefined): Partial<Settings> {
  const l = withoutLocalSettings(local) as Record<string, unknown>;
  const r = withoutLocalSettings(remote) as Record<string, unknown>;
  const b = base as Record<string, unknown> | undefined;
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (l[k] === r[k] || r[k] === undefined) out[k] = l[k];
    else if (l[k] === undefined) out[k] = r[k];
    // No earlier sync: the synced copy wins. Otherwise the side that changed it.
    else out[k] = !b || l[k] === b[k] ? r[k] : l[k];
  }
  return out as Partial<Settings>;
}

export interface MergeResult {
  merged: Snapshot;
  /** Local item ids that now go by another id (the same word on the other device). */
  remap: Map<string, string>;
}

export function mergeSnapshots(local: Snapshot, remote: Snapshot, base: SyncBase | null): MergeResult {
  const remap = new Map<string, string>();
  const lastL = lastPractice(local.reviews);
  const lastR = lastPractice(remote.reviews);
  const remoteRemap = new Map<string, string>();
  const L = byKey(local.items, lastL, remap);
  const R = byKey(remote.items, lastR, remoteRemap);
  const baseItems = base?.items ?? {};

  const items: Item[] = [];
  for (const key of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(key);
    const r = R.get(key);
    const b = baseItems[key];
    if (l && r) {
      const hl = itemHash(l);
      const hr = itemHash(r);
      let win: Item;
      if (hl === hr || hl === b) win = r;
      else if (hr === b) win = l;
      else win = activity(l, lastL) > activity(r, lastR) ? l : r;
      // One id for the word on every device: the synced one.
      if (l.id !== r.id) remap.set(l.id, r.id);
      for (const [from, to] of remap) if (to === l.id) remap.set(from, r.id);
      items.push(win.id === r.id ? win : { ...win, id: r.id });
    } else if (l) {
      // Untouched here and gone from the synced copy: it was deleted on the other device.
      if (b === undefined || itemHash(l) !== b) items.push(l);
    } else if (r) {
      if (b === undefined || itemHash(r) !== b) items.push(r);
    }
  }

  const reviews = new Map<string, ReviewEntry>();
  const strip = ({ id: _id, ...rest }: ReviewEntry): ReviewEntry => rest;
  for (const r of remote.reviews) {
    const x = { ...strip(r), itemId: remoteRemap.get(r.itemId) ?? r.itemId };
    reviews.set(reviewKey(x), x);
  }
  for (const r of local.reviews) {
    const x = { ...strip(r), itemId: remap.get(r.itemId) ?? r.itemId };
    const k = reviewKey(x);
    if (!reviews.has(k)) reviews.set(k, x);
  }

  // A pack word removed on one device stays out, even if another device still had it.
  const removed = mergeList(local.removed, remote.removed, base?.removed, (k) => k).sort();
  const gone = new Set(removed);
  const kept = items.filter((i) => i.deck === 'own' || !gone.has(termKey(i.term)));

  return {
    remap,
    merged: {
      items: kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      reviews: [...reviews.values()].sort((a, b) => a.at - b.at || (reviewKey(a) < reviewKey(b) ? -1 : 1)),
      settings: mergeSettings(local.settings, remote.settings, base?.settings),
      saved: mergeList(local.saved, remote.saved, base?.saved, savedKey).sort((a, b) => a.at - b.at),
      removed,
      coursePacks: [...new Set([...local.coursePacks, ...remote.coursePacks])].sort(),
    },
  };
}

export function baseOf(snap: Snapshot): SyncBase {
  return {
    items: Object.fromEntries(snap.items.map((i) => [itemKey(i), itemHash(i)])),
    saved: snap.saved.map(savedKey),
    removed: [...snap.removed],
    settings: withoutLocalSettings(snap.settings),
  };
}

/** Fingerprint of a whole snapshot, to skip uploads when nothing changed. */
export function snapshotHash(snap: Snapshot | null): string {
  if (!snap) return '';
  return hash(
    stable({
      items: [...snap.items].sort((a, b) => (a.id < b.id ? -1 : 1)),
      reviews: snap.reviews.map(({ id: _id, ...r }) => r).sort((a, b) => a.at - b.at || (reviewKey(a) < reviewKey(b) ? -1 : 1)),
      settings: withoutLocalSettings(snap.settings),
      saved: [...snap.saved].sort((a, b) => a.at - b.at),
      removed: [...snap.removed].sort(),
      coursePacks: [...snap.coursePacks].sort(),
    }),
  );
}
