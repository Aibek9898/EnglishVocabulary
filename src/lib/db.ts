import Dexie, { liveQuery, type Table } from 'dexie';
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type Item, type ReviewEntry, type Settings } from './types';

interface KV {
  key: string;
  value: unknown;
}

class VocabDB extends Dexie {
  items!: Table<Item, string>;
  reviews!: Table<ReviewEntry, number>;
  kv!: Table<KV, string>;

  constructor() {
    super('english-vocabulary');
    this.version(1).stores({
      items: 'id, level, deck, createdAt, *tags',
      reviews: '++id, itemId, day, at',
      kv: 'key',
    });
  }
}

export const db = new VocabDB();

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
