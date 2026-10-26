import { db, getSettings } from './db';
import { getRemoved, setRemoved } from './removed';
import { getSaved, setSaved, type SavedPhrase } from './saved';
import type { Item, ReviewEntry, Settings } from './types';

export interface Backup {
  app: 'english-vocabulary';
  version: 1;
  exportedAt: string;
  items: Item[];
  reviews: ReviewEntry[];
  settings: Settings;
  /** Library → Saved; missing in older backups. */
  saved?: SavedPhrase[];
  /** Words removed on purpose, so packs don't bring them back; missing in older backups. */
  removed?: string[];
}

export async function makeBackup(): Promise<Backup> {
  return {
    app: 'english-vocabulary',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: await db.items.toArray(),
    reviews: await db.reviews.toArray(),
    settings: await getSettings(),
    saved: await getSaved(),
    removed: await getRemoved(),
  };
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** JSON turns Dates into strings; FSRS needs them back as Dates. */
function reviveItem(item: Item): Item {
  const card = { ...item.card, due: new Date(item.card.due) };
  if (card.last_review) card.last_review = new Date(card.last_review);
  return { ...item, card };
}

export function isBackup(data: unknown): data is Backup {
  return !!data && typeof data === 'object' && (data as Backup).app === 'english-vocabulary' && Array.isArray((data as Backup).items);
}

/** Replaces everything on this device with the backup. */
export async function restoreBackup(backup: Backup) {
  await db.transaction('rw', db.items, db.reviews, db.kv, async () => {
    await db.items.clear();
    await db.reviews.clear();
    await db.items.bulkAdd(backup.items.map(reviveItem));
    await db.reviews.bulkAdd(backup.reviews.map(({ id: _id, ...r }) => r));
    await db.kv.put({ key: 'settings', value: backup.settings });
    if (Array.isArray(backup.saved)) await setSaved(backup.saved);
    if (Array.isArray(backup.removed)) await setRemoved(backup.removed);
  });
}
