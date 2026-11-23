import Dexie, { liveQuery, type Table } from 'dexie';
import { useEffect, useState } from 'react';
import type { Book } from './books';
import { DEFAULT_SETTINGS, type Item, type ReviewEntry, type Settings } from './types';

interface KV {
  key: string;
  value: unknown;
}

class VocabDB extends Dexie {
  items!: Table<Item, string>;
  reviews!: Table<ReviewEntry, number>;
  kv!: Table<KV, string>;
  /** Books for Reading: kept only in this browser, never in backups or sync. */
  books!: Table<Book, string>;

  constructor(name = LEGACY_DB) {
    super(name);
    this.version(1).stores({
      items: 'id, level, deck, createdAt, *tags',
      reviews: '++id, itemId, day, at',
      kv: 'key',
    });
    this.version(2).stores({ books: 'id, openedAt' });
  }
}

/** The database from before accounts (and the only one when accounts are off). */
export const LEGACY_DB = 'english-vocabulary';

/**
 * This browser's copy of the words. With accounts, each account has its own
 * database here, opened by openAccountDb() before anything reads it.
 */
// eslint-disable-next-line import/no-mutable-exports
export let db = new VocabDB();

export function openAccountDb(userId: string) {
  const name = `${LEGACY_DB}-${userId}`;
  if (db.name === name) return;
  db.close();
  db = new VocabDB(name);
}

export function openDb(name: string) {
  return new VocabDB(name);
}

export type { VocabDB };

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>) {
  const current = await getSettings();
  await db.kv.put({ key: 'settings', value: { ...current, ...patch } });
}

/** Re-runs the query whenever the tables it reads change. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: console.error });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function useSettings(): Settings {
  return useLive(getSettings, [], DEFAULT_SETTINGS);
}

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
