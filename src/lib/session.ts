import { fsrs, State, type Card } from 'ts-fsrs';
import { parseCloze } from './cloze';
import { dayKey } from './dates';
import type { ExerciseKind, Item, ReviewEntry, Result, Settings } from './types';

export interface Step {
  itemId: string;
  exercise: ExerciseKind;
  /** First attempt of a scheduled item grades FSRS; repeats after a mistake do not. */
  scheduled: boolean;
  isNew: boolean;
  /** 'relearn': shown again after a mistake. 'confirm': one last recall at the end once a relearn went right. */
  retry?: 'relearn' | 'confirm';
}

const f = fsrs();

/** Chance of remembering the item now; 0 for a card that was never graded. */
export function retrievability(card: Card, now = new Date()): number {
  if (card.state === State.New || !card.last_review) return 0;
  return f.get_retrievability(card, now, false);
}

/** Due items, the most likely forgotten first. */
export function dueItems(items: Item[], now = new Date()): Item[] {
  return items
    .filter((i) => !i.suspended && i.level > 0 && new Date(i.card.due) <= now)
    .map((i) => ({ i, r: retrievability(i.card, now) }))
    .sort((a, b) => a.r - b.r || +new Date(a.i.card.due) - +new Date(b.i.card.due))
    .map(({ i }) => i);
}

/** Reviews left over from earlier days: due before today started. Never-graded cards have no real due date. */
export function overdueCount(items: Item[], now = new Date()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return items.filter((i) => !i.suspended && i.level > 0 && i.card.state !== State.New && new Date(i.card.due) < start).length;
}

/** How many new items were already introduced today. */
export function introducedToday(reviews: ReviewEntry[], today = dayKey()): number {
  return reviews.filter((r) => r.day === today && r.exercise === 'intro').length;
}

/**
 * New items still allowed today. A big backlog is the main reason people quit,
 * so the daily number shrinks with it: round(newPerDay * (1 - overdue / reviewCap)),
 * none once the overdue reviews reach the cap. Minus those introduced today.
 */
export function newAllowance(items: Item[], reviews: ReviewEntry[], settings: Settings, now = new Date()): number {
  const overdue = overdueCount(items, now);
  const room = settings.reviewCap > 0 ? Math.min(1, Math.max(0, 1 - overdue / settings.reviewCap)) : overdue ? 0 : 1;
  return Math.max(0, Math.round(settings.newPerDay * room) - introducedToday(reviews, dayKey(now)));
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

const hasCloze = (item: Pick<Item, 'example' | 'term'>) => !!parseCloze(item.example, item.term);

/**
 * Chooses a review exercise from how well the item is known; never multiple
 * choice. Level <= 1: 'cloze' (the UI scaffolds it). Then by FSRS stability:
 * under 7 days 'cloze', under 21 'cloze-ru' (or 'cloze' without a Russian
 * example), from 21 days 'say' half the time, else 'recall'. Without a usable
 * example sentence every gap-fill becomes 'recall'.
 */
export function exerciseFor(item: Item, random = Math.random): ExerciseKind {
  const cloze = hasCloze(item);
  const s = item.card.stability;
  if (item.level <= 1 || s < 7) return cloze ? 'cloze' : 'recall';
  if (s < 21) return !cloze ? 'recall' : item.exampleRu ? 'cloze-ru' : 'cloze';
  return random() < 0.5 ? 'say' : 'recall';
}

/** Positions after its intro where a new item's choice and its scheduled typed check may come. */
const CHOICE_AFTER = 3;
const TYPED_AFTER = 9;

/**
 * Today's queue: due reviews (most likely forgotten first, up to reviewCap) and
 * new items. A new item gets three steps: 'intro' (unscheduled), an unscheduled
 * 'choice' with at least 2 other steps in between, and its first scheduled,
 * typed check ('cloze', or 'recall' without a cloze) with at least 8 other steps
 * in between. When the queue is too short for a gap, the step goes at the end.
 */
export function buildSession(items: Item[], reviews: ReviewEntry[], settings: Settings, now = new Date()): Step[] {
  const reviewSteps = dueItems(items, now)
    .slice(0, settings.reviewCap)
    .map<Step>((i) => ({ itemId: i.id, exercise: exerciseFor(i), scheduled: true, isNew: false }));
  const fresh = pickNew(items, newAllowance(items, reviews, settings, now));

  // Base order: one warm-up review, then each intro followed by two reviews.
  const base: Step[] = reviewSteps.slice(0, 1);
  let r = base.length;
  for (const i of fresh) {
    base.push({ itemId: i.id, exercise: 'intro', scheduled: false, isNew: true }, ...reviewSteps.slice(r, r + 2));
    r += 2;
  }
  base.push(...reviewSteps.slice(r));
  const byId = new Map(fresh.map((i) => [i.id, i]));

  // A new item's later steps wait until their gap has passed, then take turns
  // with the base order (so intros keep coming); once it runs out, they follow.
  const pending: { at: number; step: Step }[] = [];
  const steps: Step[] = [];
  let b = 0;
  let lastPending = false;
  while (b < base.length || pending.length) {
    const ready: boolean = pending.length > 0 && (b >= base.length || (pending[0].at <= steps.length && !lastPending));
    const step = ready ? pending.shift()!.step : base[b++];
    lastPending = ready;
    if (step.exercise === 'intro') {
      const p = steps.length;
      const typed: ExerciseKind = hasCloze(byId.get(step.itemId)!) ? 'cloze' : 'recall';
      pending.push(
        { at: p + CHOICE_AFTER, step: { itemId: step.itemId, exercise: 'choice', scheduled: false, isNew: true } },
        { at: p + TYPED_AFTER, step: { itemId: step.itemId, exercise: typed, scheduled: true, isNew: true } },
      );
      pending.sort((x, y) => x.at - y.at);
    }
    steps.push(step);
  }
  return steps;
}

/** Steps between a mistake and its retry: two others in between. */
const RETRY_GAP = 3;
/** Relearn steps per item per session; after that FSRS brings it back another day. */
export const MAX_RELEARN = 2;
const CHECKED: ExerciseKind[] = ['choice', 'cloze', 'cloze-ru', 'recall', 'say', 'dictation'];

/**
 * In-session relearning after `queue[index]` was answered with `result`.
 * Returns steps to insert into the queue (splice each at `at`, an index into
 * `queue` as passed; there is at most one). All of them are unscheduled.
 * - wrong or hinted on a check (choice, cloze, cloze-ru, recall, say): a
 *   'relearn' step ('cloze', or 'recall' without a cloze) at index + 3, clamped
 *   to the end, so right next only when nothing else remains. At most
 *   MAX_RELEARN per item per session.
 * - correct or almost on a 'relearn' step: one 'confirm' 'recall' at the end.
 */
export function retrySteps(
  queue: Step[],
  index: number,
  result: Result,
  item: Pick<Item, 'example' | 'term'>,
): { at: number; step: Step }[] {
  const step = queue[index];
  if (!step || !CHECKED.includes(step.exercise)) return [];
  if (result === 'wrong' || result === 'hinted') {
    if (queue.filter((s) => s.itemId === step.itemId && s.retry === 'relearn').length >= MAX_RELEARN) return [];
    const exercise: ExerciseKind = hasCloze(item) ? 'cloze' : 'recall';
    return [{ at: Math.min(index + RETRY_GAP, queue.length), step: { ...step, exercise, scheduled: false, retry: 'relearn' } }];
  }
  const confirmLater = queue.slice(index + 1).some((s) => s.itemId === step.itemId && s.retry === 'confirm');
  if (step.retry === 'relearn' && (result === 'correct' || result === 'almost') && !confirmLater) {
    return [{ at: queue.length, step: { ...step, exercise: 'recall', scheduled: false, retry: 'confirm' } }];
  }
  return [];
}

/**
 * Up to `count` items for the end-of-session "use them in a message" task:
 * level-3 items answered right today first (a sentence moves them towards
 * Used), then items introduced today, then anything else answered right today.
 * Never an item answered wrong or with a hint today. `reviews` may be all
 * reviews or just today's; `items` should carry their current levels.
 */
export function pickMessageWords(
  items: Item[],
  reviews: ReviewEntry[],
  { count = 3, today = dayKey(), random = Math.random } = {},
): Item[] {
  const todays = reviews.filter((r) => r.day === today);
  const failed = new Set(todays.filter((r) => r.result === 'wrong' || r.result === 'hinted').map((r) => r.itemId));
  const right = new Set(
    todays.filter((r) => (r.result === 'correct' || r.result === 'almost') && CHECKED.includes(r.exercise)).map((r) => r.itemId),
  );
  const introduced = new Set(todays.filter((r) => r.exercise === 'intro').map((r) => r.itemId));
  const ok = items.filter((i) => !i.suspended && !failed.has(i.id));
  const shuffle = (list: Item[]) => list.map((i) => ({ i, k: random() })).sort((a, b) => a.k - b.k).map(({ i }) => i);
  const tiers = [
    ok.filter((i) => i.level === 3 && right.has(i.id)),
    ok.filter((i) => introduced.has(i.id)),
    ok.filter((i) => right.has(i.id)),
  ];
  return [...new Set(tiers.flatMap(shuffle))].slice(0, count);
}
