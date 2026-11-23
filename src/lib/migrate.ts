/**
 * Moving the words from before accounts into an account. Before accounts,
 * everything lived in one database in this browser ('english-vocabulary').
 * With accounts each one has its own; the old one is left as it was and only
 * marked as moved, so nothing is lost if something goes wrong.
 */
import Dexie from 'dexie';
import { db, LEGACY_DB, openDb } from './db';
import { forgetSyncBase } from './sync';

/** kv rows that belong to the old way of syncing or to the old database itself. */
const SKIP_KV = new Set(['sync', 'syncBase', 'cloudSync', 'movedTo', 'booksDeleted']);

export interface LegacyData {
  words: number;
  reviews: number;
  books: string[];
}

/** What this browser still has from before accounts, unless it was moved already. */
export async function findLegacy(): Promise<LegacyData | null> {
  if (db.name === LEGACY_DB || !(await Dexie.exists(LEGACY_DB))) return null;
  const old = openDb(LEGACY_DB);
  try {
    if ((await old.kv.get('movedTo'))?.value) return null;
    const words = await old.items.count();
    const books = (await old.books.toArray()).map((b) => b.title);
    if (!words && !books.length) return null;
    return { words, reviews: await old.reviews.count(), books };
  } catch (e) {
    console.error(e);
    return null;
  } finally {
    old.close();
  }
}

/**
 * Copies the old words, progress, settings and books into the account's
 * database here. Sync then combines them with whatever the account already
 * has in the cloud.
 */
export async function moveLegacy(userId: string): Promise<LegacyData> {
  const old = openDb(LEGACY_DB);
  try {
    const items = await old.items.toArray();
    const reviews = await old.reviews.toArray();
    const kv = (await old.kv.toArray()).filter((r) => !SKIP_KV.has(r.key));
    const books = await old.books.toArray();
    await db.transaction('rw', [db.items, db.reviews, db.kv, db.books], async () => {
      await db.items.clear();
      await db.reviews.clear();
      await db.items.bulkPut(items);
      await db.reviews.bulkAdd(reviews.map(({ id: _id, ...r }) => r));
      await db.kv.bulkPut(kv);
      await db.books.bulkPut(books);
    });
    // Combine with the cloud instead of treating what's missing here as deleted.
    await forgetSyncBase();
    await old.kv.put({ key: 'movedTo', value: { userId, at: Date.now() } });
    return { words: items.length, reviews: reviews.length, books: books.map((b) => b.title) };
  } finally {
    old.close();
  }
}
