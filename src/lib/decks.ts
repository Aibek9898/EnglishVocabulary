import { db } from './db';
import { makeItem } from './srs';
import { termKey, toContent } from './content';
import { packUpdate } from './edit';
import { getRemoved, setRemoved } from './removed';
import type { Deck, Item, ItemContent } from './types';

const files = import.meta.glob<{ default: Deck }>('../data/decks/*.json', { eager: true });

/** Course packs first, in file order (course-1-…, course-2-…), then the ready-made packs by title. */
export const DECKS: Deck[] = Object.values(files)
  .map((m) => m.default)
  .map((d) => ({ ...d, items: d.items.map(toContent).filter((x): x is ItemContent => !!x) }))
  .sort((a, b) => (a.course === b.course ? (a.course ? a.id.localeCompare(b.id) : a.title.localeCompare(b.title)) : a.course ? -1 : 1));

export const COURSE_DECKS = new Set(DECKS.filter((d) => d.course).map((d) => d.id));

/**
 * Adds the given items to the library, skipping terms that are already there. Returns how many were added.
 * With `first`, the new words go after the course words still waiting and before all other new words.
 * Words the learner removed stay out of packs, unless `restore` is set; adding your own word always brings it back.
 */
export async function addContents(contents: ItemContent[], deck: string, { first = false, restore = false } = {}): Promise<number> {
  const items = await db.items.toArray();
  const existing = new Set(items.map((i) => termKey(i.term)));
  const removed = new Set(await getRemoved());
  const explicit = restore || deck === 'own';
  const fresh = contents.filter((c) => {
    const key = termKey(c.term);
    if (existing.has(key) || (!explicit && removed.has(key))) return false;
    existing.add(key);
    return true;
  });
  const back = fresh.map((c) => termKey(c.term)).filter((k) => removed.has(k));
  if (back.length) await setRemoved([...removed].filter((k) => !back.includes(k)));
  // New words are picked by createdAt, so staggering it keeps the original order.
  const now = Date.now();
  let times = fresh.map((_, i) => now + i);
  const waiting = items.filter((i) => i.level === 0);
  const later = waiting.filter((i) => !COURSE_DECKS.has(i.deck)).map((i) => i.createdAt);
  if (first && later.length) {
    const hi = Math.min(...later);
    const ahead = waiting.filter((i) => COURSE_DECKS.has(i.deck) && i.createdAt < hi).map((i) => i.createdAt);
    const lo = ahead.length ? Math.max(...ahead) : hi - fresh.length - 1;
    const step = (hi - lo) / (fresh.length + 1);
    times = fresh.map((_, i) => lo + step * (i + 1));
  }
  await db.items.bulkAdd(fresh.map((c, i) => ({ ...makeItem(c, deck), createdAt: times[i] })));
  return fresh.length;
}

/** The pack's own version of a library item, if it came from a pack. */
export function packOriginal(item: Pick<Item, 'deck' | 'term'>): ItemContent | undefined {
  const key = termKey(item.term);
  return DECKS.find((d) => d.id === item.deck)?.items.find((c) => termKey(c.term) === key);
}

/** `restore`: the learner asked for the whole pack, so words they removed come back too. */
export async function addDeck(deck: Deck, restore = false) {
  return addContents(deck.items, deck.id, { first: !!deck.course, restore });
}

/** Bump when the pack files change, so libraries made from older packs get the fixes. */
export const PACKS_VERSION = 2;

/**
 * Brings pack items already in the library up to date with the current pack
 * files, keeping all progress. Items dropped from a pack are removed only if
 * they were never studied; new pack items are added to packs the learner has.
 */
export async function syncPacks() {
  await updatePacks();
  await addCoursePacks();
}

async function updatePacks() {
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
        await db.items.update(item.id, packUpdate(fresh, item.edited));
      } else if (item.level === 0 && item.card.reps === 0) {
        await db.items.delete(item.id);
      }
    }
    await db.kv.put({ key: 'packsVersion', value: PACKS_VERSION });
  });
  for (const d of DECKS) if (owned.has(d.id)) await addDeck(d);
}

/**
 * Course packs come into every library once, ahead of the other words not
 * started yet. A brand-new library skips this: the welcome screen offers them.
 */
async function addCoursePacks() {
  const row = await db.kv.get('coursePacks');
  const done = new Set<string>(Array.isArray(row?.value) ? row.value : []);
  const todo = DECKS.filter((d) => d.course && !done.has(d.id));
  if (!todo.length) return;
  if ((await db.items.count()) > 0) for (const d of todo) await addDeck(d);
  await db.kv.put({ key: 'coursePacks', value: [...done, ...todo.map((d) => d.id)] });
}
