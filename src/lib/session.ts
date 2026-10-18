import { canSpeak } from './speech';
import { parseCloze } from './cloze';
import { dayKey } from './dates';
import type { ExerciseKind, Item, ReviewEntry, Settings } from './types';

export interface Step {
  itemId: string;
  exercise: ExerciseKind;
  /** First attempt of a scheduled item grades FSRS; repeats after a mistake do not. */
  scheduled: boolean;
  isNew: boolean;
}

export function dueItems(items: Item[], now = new Date()): Item[] {
  return items
    .filter((i) => !i.suspended && i.level > 0 && new Date(i.card.due) <= now)
    .sort((a, b) => +new Date(a.card.due) - +new Date(b.card.due));
}

/** How many new items were already introduced today. */
export function introducedToday(reviews: ReviewEntry[], today = dayKey()): number {
  return reviews.filter((r) => r.day === today && r.exercise === 'intro').length;
}

/**
 * Picks new items: the learner's own words first, then packs round-robin, and
 * never two items starting with the same word on one day (look up / look after
 * learned together interfere with each other).
 */
export function pickNew(items: Item[], count: number): Item[] {
  if (count <= 0) return [];
  const fresh = items.filter((i) => !i.suspended && i.level === 0).sort((a, b) => a.createdAt - b.createdAt);
  const byDeck = new Map<string, Item[]>();
  for (const i of fresh) byDeck.set(i.deck, [...(byDeck.get(i.deck) ?? []), i]);
  const own = byDeck.get('own') ?? [];
  byDeck.delete('own');
  const queues = [own, ...byDeck.values()];
  const ordered: Item[] = [...own];
  for (let round = 0; queues.slice(1).some((q) => q.length > round); round++) {
    for (const q of queues.slice(1)) if (q[round]) ordered.push(q[round]);
  }
  const picked: Item[] = [];
  const firstWords = new Set<string>();
  for (const i of ordered) {
    const first = i.term.toLowerCase().split(/\s+/)[0];
    if (firstWords.has(first)) continue;
    picked.push(i);
    firstWords.add(first);
    if (picked.length >= count) break;
  }
  return picked;
}

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** Chooses an exercise that fits how well the item is known. */
export function exerciseFor(item: Item): ExerciseKind {
  const hasCloze = !!parseCloze(item.example, item.term);
  const typed: ExerciseKind[] = ['recall'];
  if (hasCloze) typed.push('cloze');
  if (hasCloze && item.exampleRu) typed.push('cloze-ru');
  if (item.level <= 1) return 'choice';
  if (item.level === 2) return hasCloze ? 'cloze' : 'recall';
  if (canSpeak && Math.random() < 0.15) return 'dictation';
  return pick(typed);
}

export function buildSession(items: Item[], reviews: ReviewEntry[], settings: Settings, now = new Date()): Step[] {
  const due = dueItems(items, now).slice(0, settings.reviewCap);
  const backlog = dueItems(items, now).length;
  // A big backlog is the main reason people quit, so new words pause until it is cleared.
  const allowance = backlog >= settings.reviewCap ? 0 : settings.newPerDay - introducedToday(reviews);
  const fresh = pickNew(items, allowance);

  const steps: Step[] = [];
  const reviewSteps = due.map<Step>((i) => ({ itemId: i.id, exercise: exerciseFor(i), scheduled: true, isNew: false }));
  const newSteps = fresh.flatMap<Step>((i) => [
    { itemId: i.id, exercise: 'intro', scheduled: false, isNew: true },
    { itemId: i.id, exercise: 'choice', scheduled: true, isNew: true },
  ]);
  // Interleave: two reviews, then one new item (intro immediately followed by its check).
  let r = 0;
  let n = 0;
  while (r < reviewSteps.length || n < newSteps.length) {
    for (let k = 0; k < 2 && r < reviewSteps.length; k++) steps.push(reviewSteps[r++]);
    if (n < newSteps.length) steps.push(newSteps[n++], newSteps[n++]);
  }
  return steps;
}
