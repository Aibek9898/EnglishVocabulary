import { db } from './db';
import { makeItem } from './srs';
import { termKey, toContent } from './content';
import type { Deck, ItemContent } from './types';

const files = import.meta.glob<{ default: Deck }>('../data/decks/*.json', { eager: true });

export const DECKS: Deck[] = Object.values(files)
  .map((m) => m.default)
  .map((d) => ({ ...d, items: d.items.map(toContent).filter((x): x is ItemContent => !!x) }))
  .sort((a, b) => a.title.localeCompare(b.title));

/** Adds the given items to the library, skipping terms that are already there. Returns how many were added. */
export async function addContents(contents: ItemContent[], deck: string): Promise<number> {
  const existing = new Set((await db.items.toArray()).map((i) => termKey(i.term)));
  const fresh = contents.filter((c) => {
    const key = termKey(c.term);
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  // Stagger createdAt so the original order is kept when picking new words.
  const base = Date.now();
  await db.items.bulkAdd(fresh.map((c, i) => ({ ...makeItem(c, deck), createdAt: base + i })));
  return fresh.length;
}

export async function addDeck(deck: Deck) {
  return addContents(deck.items, deck.id);
}

/** Bump when the pack files change, so libraries made from older packs get the fixes. */
export const PACKS_VERSION = 2;

/**
 * Brings pack items already in the library up to date with the current pack
 * files, keeping all progress. Items dropped from a pack are removed only if
 * they were never studied; new pack items are added to packs the learner has.
 */
export async function syncPacks() {
  const row = await db.kv.get('packsVersion');
  if (row?.value === PACKS_VERSION) return;
  const items = await db.items.toArray();
  const packs = new Map(DECKS.map((d) => [d.id, new Map(d.items.map((c) => [termKey(c.term), c]))]));
  const owned = new Set(items.map((i) => i.deck));
  await db.transaction('rw', db.items, db.kv, async () => {
    for (const item of items) {
      const pack = packs.get(item.deck);
      if (!pack) continue;
      const fresh = pack.get(termKey(item.term));
      if (fresh) {
        const { source: _source, ...content } = fresh;
        await db.items.update(item.id, content);
      } else if (item.level === 0 && item.card.reps === 0) {
        await db.items.delete(item.id);
      }
    }
    await db.kv.put({ key: 'packsVersion', value: PACKS_VERSION });
  });
  for (const d of DECKS) if (owned.has(d.id)) await addDeck(d);
}
