import { describe, expect, it } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { baseOf, hash, itemHash, mergeList, mergeSnapshots, snapshotHash, stable, type Snapshot } from '../lib/syncMerge';
import type { Item, ReviewEntry } from '../lib/types';

const T0 = Date.UTC(2026, 9, 1);

function item(id: string, term: string, deck = 'pack-a', extra: Partial<Item> = {}): Item {
  return {
    id,
    term,
    translation: term + ' (ru)',
    example: `Use [${term}] here.`,
    tags: [],
    deck,
    createdAt: T0,
    level: 0,
    card: { ...createEmptyCard(new Date(T0)) },
    mySentences: [],
    usedInLife: 0,
    suspended: false,
    ...extra,
  } as Item;
}

const review = (itemId: string, at: number, exercise: ReviewEntry['exercise'] = 'recall'): ReviewEntry => ({
  itemId,
  at,
  day: new Date(at).toISOString().slice(0, 10),
  exercise,
  result: 'correct',
  scheduled: true,
});

const snap = (s: Partial<Snapshot>): Snapshot => ({ items: [], reviews: [], settings: {}, saved: [], removed: [], coursePacks: [], ...s });

/** Same data after a trip through JSON, as it comes back from GitHub. */
const viaJson = (s: Snapshot): Snapshot => {
  const raw = JSON.parse(JSON.stringify(s)) as Snapshot;
  return {
    ...raw,
    items: raw.items.map((i) => ({
      ...i,
      card: { ...i.card, due: new Date(i.card.due), last_review: i.card.last_review ? new Date(i.card.last_review) : undefined },
    })) as Item[],
  };
};

describe('fingerprints', () => {
  it('ignore key order and treat dates like their ISO text', () => {
    expect(stable({ b: 1, a: [1, { d: undefined, c: 2 }] })).toBe('{"a":[1,{"c":2}],"b":1}');
    expect(stable({ at: new Date(T0) })).toBe(stable({ at: new Date(T0).toISOString() }));
    expect(hash('a')).not.toBe(hash('b'));
  });
  it('survive a trip through JSON, and ignore the id', () => {
    const a = item('1', 'make a decision');
    expect(itemHash(viaJson(snap({ items: [a] })).items[0])).toBe(itemHash(a));
    expect(itemHash({ ...a, id: 'other' })).toBe(itemHash(a));
    expect(itemHash({ ...a, level: 2 })).not.toBe(itemHash(a));
  });
});

describe('first sync (nothing synced before)', () => {
  it('combines both sides and gives a pack word one id everywhere', () => {
    const phone = snap({
      items: [item('p1', 'make a decision'), item('p2', 'run late', 'own')],
      reviews: [review('p1', T0 + 5000, 'intro')],
      coursePacks: ['course-1'],
    });
    const computer = snap({
      items: [item('c1', 'make a decision', 'pack-a', { level: 3, card: { ...createEmptyCard(new Date(T0)), reps: 4, last_review: new Date(T0 + 9e6) } }), item('c2', 'take a break')],
      reviews: [review('c1', T0 + 1000), review('c1', T0 + 9e6)],
      coursePacks: ['course-2'],
    });
    const { merged, remap } = mergeSnapshots(phone, viaJson(computer), null);
    expect(merged.items.map((i) => i.id).sort()).toEqual(['c1', 'c2', 'p2']);
    // The word practised more (on the computer) wins, under the synced id.
    expect(merged.items.find((i) => i.id === 'c1')!.level).toBe(3);
    expect(remap.get('p1')).toBe('c1');
    // Both devices' practice is kept, all pointing at the one id.
    expect(merged.reviews.map((r) => `${r.itemId}@${r.at - T0}`)).toEqual(['c1@1000', 'c1@5000', 'c1@9000000']);
    expect(merged.coursePacks).toEqual(['course-1', 'course-2']);
  });

  it('keeps a pack word removed on the other device out, but not your own card for it', () => {
    const here = snap({ items: [item('h1', 'take a break'), item('h2', 'Take a Break', 'own')] });
    const there = snap({ items: [], removed: ['take a break'] });
    const { merged } = mergeSnapshots(here, there, null);
    expect(merged.items.map((i) => i.id)).toEqual(['h2']);
    expect(merged.removed).toEqual(['take a break']);
  });

  it('prefers the synced settings, but keeps this device\'s voice', () => {
    const { merged } = mergeSnapshots(snap({ settings: { newPerDay: 7, voiceName: 'Pixel voice' } }), snap({ settings: { newPerDay: 10, voiceName: 'Mac voice' } }), null);
    expect(merged.settings).toEqual({ newPerDay: 10 });
  });
});

describe('later syncs (three-way)', () => {
  const a = item('a', 'make a decision');
  const b = item('b', 'take a break');
  const c = item('c', 'run late', 'own');
  const start = snap({ items: [a, b, c], removed: ['old word'], saved: [{ text: 'bite the bullet', at: 1 }], settings: { newPerDay: 7, oldPerDay: 10 } });
  const base = baseOf(start);

  it('takes each side\'s own changes', () => {
    const here = snap({ ...start, items: [{ ...a, level: 2 }, b, c], settings: { newPerDay: 10, oldPerDay: 10 } });
    const there = snap({ ...start, items: [a, { ...b, translation: 'перерыв' }, c], settings: { newPerDay: 7, oldPerDay: 20 } });
    const { merged } = mergeSnapshots(here, viaJson(there), base);
    expect(merged.items.find((i) => i.id === 'a')!.level).toBe(2);
    expect(merged.items.find((i) => i.id === 'b')!.translation).toBe('перерыв');
    expect(merged.settings).toEqual({ newPerDay: 10, oldPerDay: 20 });
  });

  it('keeps deletions from either side', () => {
    const here = snap({ ...start, items: [a, b] }); // removed "run late" here
    const there = snap({ ...start, items: [a, c] }); // removed "take a break" there
    const { merged } = mergeSnapshots(here, viaJson(there), base);
    expect(merged.items.map((i) => i.id)).toEqual(['a']);
  });

  it('keeps a word deleted on one side but changed on the other', () => {
    const here = snap({ ...start, items: [a, c] });
    const there = snap({ ...start, items: [a, { ...b, level: 1 }, c] });
    const { merged } = mergeSnapshots(here, viaJson(there), base);
    expect(merged.items.find((i) => i.id === 'b')?.level).toBe(1);
  });

  it('settles a word changed on both sides by the latest practice', () => {
    const here = snap({ ...start, items: [{ ...a, level: 1 }, b, c], reviews: [review('a', T0 + 100)] });
    const there = snap({ ...start, items: [{ ...a, level: 4 }, b, c], reviews: [review('a', T0 + 500)] });
    const { merged } = mergeSnapshots(here, viaJson(there), base);
    expect(merged.items.find((i) => i.id === 'a')!.level).toBe(4);
    expect(merged.reviews).toHaveLength(2);
  });

  it('merges the Saved list and removed words with deletions', () => {
    const here = snap({ ...start, saved: [], removed: ['old word', 'new here'] }); // used the saved phrase
    const there = snap({ ...start, saved: [{ text: 'bite the bullet', at: 1 }, { text: 'call it a day', at: 2 }], removed: [] }); // re-added "old word"
    const { merged } = mergeSnapshots(here, viaJson(there), base);
    expect(merged.saved.map((s) => s.text)).toEqual(['call it a day']);
    expect(merged.removed).toEqual(['new here']);
  });

  it('changes nothing when both sides are the same', () => {
    const { merged } = mergeSnapshots(start, viaJson(start), base);
    expect(snapshotHash(merged)).toBe(snapshotHash(start));
  });
});

describe('three-way list merge', () => {
  it('keeps items on both sides or added since the last sync', () => {
    const k = (x: string) => x;
    expect(mergeList(['a', 'b', 'x'], ['a', 'c', 'y'], ['a', 'b', 'c'], k).sort()).toEqual(['a', 'x', 'y']);
    expect(mergeList(['a'], ['b'], undefined, k).sort()).toEqual(['a', 'b']);
  });
});
