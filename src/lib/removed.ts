import { termKey } from './content';
import { db } from './db';
import type { Item } from './types';

/**
 * Words the learner removed because they don't want to learn them. Packs never
 * add these back on their own; adding the word yourself (or a whole pack again
 * from Library → Packs) brings it back.
 */
export async function getRemoved(): Promise<string[]> {
  const row = await db.kv.get('removed');
  return Array.isArray(row?.value) ? row.value : [];
}

export async function setRemoved(keys: Iterable<string>) {
  await db.kv.put({ key: 'removed', value: [...new Set(keys)] });
}

/** Deletes a word with its progress and keeps packs from adding it again. */
export async function removeItem(item: Pick<Item, 'id' | 'term'>) {
  await db.transaction('rw', db.items, db.kv, async () => {
    await db.items.delete(item.id);
    await setRemoved([...(await getRemoved()), termKey(item.term)]);
  });
}
