import { fsrs, State, type Card } from 'ts-fsrs';
import { parseCloze } from './cloze';
import { addDays, dayKey, endOfDay } from './dates';
import { LADDER, ladderStep } from './srs';
import type { ExerciseKind, Item, ReviewEntry, Result, Settings } from './types';

export interface Step {
  itemId: string;
  exercise: ExerciseKind;
  /** First attempt of a scheduled item grades FSRS; repeats after a mistake do not. */
  scheduled: boolean;
  isNew: boolean;
  /** 'relearn': shown again after a mistake. 'confirm': one last recall at the end once a relearn went right. */
  retry?: 'relearn' | 'confirm';
  /** A word from earlier days, not due yet, checked at the end of the lesson (see refreshItems). */
  refresh?: boolean;
}

const f = fsrs();

/** Chance of remembering the item now; 0 for a card that was never graded. */
export function retrievability(card: Card, now = new Date()): number {
  if (card.state === State.New || !card.last_review) return 0;
  return f.get_retrievability(card, now, false);
}

/** Due items, the most likely forgotten first. Anything due today counts, whatever the time. */
export function dueItems(items: Item[], now = new Date()): Item[] {
  const end = endOfDay(now);
  return items
    .filter((i) => !i.suspended && i.level > 0 && new Date(i.card.due) <= end)
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
 * When the item should come back: its due date, or sooner for a card graded
 * before the ladder existed (those were given the long FSRS gaps).
 */
export function ladderDue(item: Item): number {
  const due = +new Date(item.card.due);
  const k = ladderStep(item);
  if (!item.card.last_review || k < 1 || k > LADDER.length) return due;
  return Math.min(due, +addDays(new Date(item.card.last_review), LADDER[k - 1]));
}

/** Words from earlier days answered in a scheduled check today (not ones introduced today). */
export function olderCheckedToday(reviews: ReviewEntry[], today = dayKey()): number {
  const todays = reviews.filter((r) => r.day === today);
  const introduced = new Set(todays.filter((r) => r.exercise === 'intro').map((r) => r.itemId));
  return new Set(todays.filter((r) => r.scheduled && !introduced.has(r.itemId)).map((r) => r.itemId)).size;
}

/**
 * Words from earlier days to check at the end of a lesson although they are
 * not due yet, so at least `oldPerDay` older words get checked every day:
 * the ones that would come back soonest first. Never a word seen today or a
 * word due today (those are reviews anyway). `due` is how many reviews the
 * lesson already has; `count` overrides the daily top-up ("Review older words").
 */
export function refreshItems(items: Item[], reviews: ReviewEntry[], settings: Settings, now = new Date(), due = 0, count?: number): Item[] {
  const today = dayKey(now);
  const want = count ?? Math.max(0, settings.oldPerDay - olderCheckedToday(reviews, today) - due);
  if (want <= 0) return [];
  const seen = new Set(reviews.filter((r) => r.day === today).map((r) => r.itemId));
  const end = +endOfDay(now);
  return items
    .filter((i) => !i.suspended && i.level > 0 && i.card.state !== State.New && +new Date(i.card.due) > end && !seen.has(i.id))
    .map((i) => ({ i, at: ladderDue(i), r: retrievability(i.card, now) }))
    .sort((a, b) => a.at - b.at || a.r - b.r)
    .slice(0, want)
    .map(({ i }) => i);
}

/** Round-robin over the queues: one from each, then the second from each, and so on. */
function interleave(queues: Item[][]): Item[] {
  const out: Item[] = [];
  for (let round = 0; queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round]) out.push(q[round]);
  }
  return out;
}

/**
 * Picks new items: the learner's own words first, then the course packs
 * (course-*.json) round-robin, then the other packs round-robin, and never two
 * items starting with the same word on one day (look up / look after learned
 * together interfere with each other).
 */
export function pickNew(items: Item[], count: number): Item[] {
  if (count <= 0) return [];
  const fresh = items.filter((i) => !i.suspended && i.level === 0).sort((a, b) => a.createdAt - b.createdAt);
  const byDeck = new Map<string, Item[]>();
  for (const i of fresh) byDeck.set(i.deck, [...(byDeck.get(i.deck) ?? []), i]);
  const own = byDeck.get('own') ?? [];
  byDeck.delete('own');
  const decks = [...byDeck.entries()];
  const ordered = [
    ...own,
    ...interleave(decks.filter(([id]) => id.startsWith('course-')).map(([, q]) => q)),
    ...interleave(decks.filter(([id]) => !id.startsWith('course-')).map(([, q]) => q)),
  ];
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
 * new items, then older words that are not due yet (see refreshItems). A new
 * item gets three steps: 'intro' (unscheduled), an unscheduled 'choice' with at
 * least 2 other steps in between, and its first scheduled, typed check ('cloze',
 * or 'recall' without a cloze) with at least 8 other steps in between. When the
 * queue is too short for a gap, the step goes at the end, before the older words.
 * `newCount` overrides today's allowance ("Learn 5 more"), `refreshCount` the
 * older words ("Review older words").
 */
export function buildSession(
  items: Item[],
  reviews: ReviewEntry[],
  settings: Settings,
  now = new Date(),
  newCount?: number,
  refreshCount?: number,
): Step[] {
  const reviewSteps = dueItems(items, now)
    .slice(0, settings.reviewCap)
    .map<Step>((i) => ({ itemId: i.id, exercise: exerciseFor(i), scheduled: true, isNew: false }));
  const refresh = refreshItems(items, reviews, settings, now, reviewSteps.length, refreshCount).map<Step>((i) => ({
    itemId: i.id,
    exercise: exerciseFor(i),
    scheduled: true,
    isNew: false,
    refresh: true,
  }));
  const fresh = pickNew(items, newCount ?? newAllowance(items, reviews, settings, now));

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
  return [...steps, ...refresh];
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
 * - correct or almost on a 'relearn' step: one 'confirm' 'recall' at the end
 *   (before the older words, unless it is one of them).
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
    // Today's words are wrapped up before the older words start.
    const older = step.refresh ? -1 : queue.findIndex((s, k) => k > index && s.refresh);
    return [{ at: older >= 0 ? older : queue.length, step: { ...step, exercise: 'recall', scheduled: false, retry: 'confirm' } }];
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
