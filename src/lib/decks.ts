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
