import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs';
import { db, getSettings, newId } from './db';
import { addDays, dayKey } from './dates';
import type { ExerciseKind, Item, ItemContent, Result } from './types';

const RECOGNITION: ExerciseKind[] = ['choice', 'pairs', 'flashcard'];
/** Typed answers from memory: the only exercises that can prove "Recalled" and "Used". */
export const TYPED: ExerciseKind[] = ['cloze', 'cloze-ru', 'recall'];

/** Days of stability after which a "used" item counts as mastered. */
export const MASTERED_STABILITY = 21;

function scheduler(retention: number) {
  // Short-term steps off: a failed card is shown again inside the session instead.
  return fsrs(generatorParameters({ request_retention: retention, enable_fuzz: true, enable_short_term: false }));
}

/** correct/done = Good, almost (typo) = Hard, hinted and wrong = Again (a hint means it was not remembered). */
export function gradeFor(result: Result): Grade {
  if (result === 'wrong' || result === 'hinted') return Rating.Again;
  if (result === 'almost') return Rating.Hard;
  return Rating.Good;
}

/**
 * The longest gap in days after each right answer in a row. With FSRS alone a
 * word answered right comes back after 3, then 14, then 57 days, which is too
 * sparse while it is still new; the ladder brings it back after 1, 3, 7, 14
 * and 30 days, and FSRS decides on its own after that.
 */
export const LADDER = [1, 3, 7, 14, 30];

/** Right answers in a row so far. Cards graded before the ladder existed use their number of reviews. */
export function ladderStep(item: Pick<Item, 'ladder' | 'card'>): number {
  return item.ladder ?? item.card.reps;
}

/**
 * Grades the FSRS card and keeps the next gap within the ladder. A mistake
 * sends the word back a step: FSRS shows it the next day, and after that
 * the next right answer waits at most 3 days.
 */
export function scheduleNext(item: Pick<Item, 'ladder' | 'card'>, result: Result, now: Date, retention: number): { card: Card; ladder: number } {
  const grade = gradeFor(result);
  let card = scheduler(retention).next(item.card, now, grade).card;
  if (grade === Rating.Again) return { card, ladder: 1 };
  const step = ladderStep(item);
  if (step < LADDER.length) {
    const cap = addDays(now, LADDER[step]);
    if (+new Date(card.due) > +cap) card = { ...card, due: cap, scheduled_days: LADDER[step] };
  }
  return { card, ladder: step + 1 };
}

/**
 * How the mastery level moves after one exercise. Pure, so it can be tested.
 * Only applied to intros, sentences and scheduled answers (see recordResult);
 * `item.card` is the card after this answer was graded.
 * - intro: at least 1 (Seen).
 * - wrong: drops one level from 3 up, else stays (at least 1). hinted: no change.
 * - recognition: up to 2. Typed (cloze, cloze-ru, recall): one level per right
 *   answer up to 3; 3 -> 4 (Used) only on a correct answer on a later day than
 *   one of the learner's own sentences. A sentence alone changes nothing.
 * - say (self-graded): never promotes, except 4 -> 5 below.
 * - 4 -> 5 (Mastered): a correct typed or said answer with stability >= 21 days.
 */
export function nextLevel(
  item: Pick<Item, 'level' | 'card' | 'mySentences'>,
  exercise: ExerciseKind,
  result: Result,
  now = new Date(),
): number {
  const { level } = item;
  if (exercise === 'intro') return Math.max(level, 1);
  if (exercise === 'sentence' || result === 'hinted') return level;
  if (result === 'wrong') return level >= 3 ? level - 1 : Math.max(level, 1);
  if (RECOGNITION.includes(exercise)) return Math.max(level, Math.min(level + 1, 2));
  const typed = TYPED.includes(exercise);
  if (!typed && exercise !== 'say') return level;
  const correct = result === 'correct';
  if (level === 4 && correct && item.card.stability >= MASTERED_STABILITY) return 5;
  if (!typed) return level;
  if (level < 3) return level + 1;
  const wroteBefore = item.mySentences.some((s) => dayKey(s.at) < dayKey(now));
  if (level === 3 && correct && wroteBefore) return 4;
  return level;
}

/**
 * Records one exercise. When `scheduled` is true the FSRS card is graded too;
 * free practice only logs activity and never touches the schedule.
 */
export async function recordResult(item: Item, exercise: ExerciseKind, result: Result, scheduled: boolean) {
  const now = new Date();
  const update: Partial<Item> = {};
  if (scheduled && exercise !== 'sentence') {
    const { retention } = await getSettings();
    const next = scheduleNext(item, result, now, retention);
    update.card = next.card;
    update.ladder = next.ladder;
  }
  // Intros count even though unscheduled: they make the item "Seen".
  if (scheduled || exercise === 'sentence' || exercise === 'intro') {
    update.level = nextLevel({ ...item, card: update.card ?? item.card }, exercise, result, now);
  }
  await db.transaction('rw', db.items, db.reviews, async () => {
    if (Object.keys(update).length) await db.items.update(item.id, update);
    await db.reviews.add({ itemId: item.id, at: now.getTime(), day: dayKey(now), exercise, result, scheduled });
  });
  return { ...item, ...update } as Item;
}

export async function addSentence(item: Item, text: string) {
  const mySentences = [...item.mySentences, { text: text.trim(), at: Date.now() }];
  await db.items.update(item.id, { mySentences });
  return recordResult({ ...item, mySentences }, 'sentence', 'done', false);
}

export function makeItem(content: ItemContent, deck: string): Item {
  return {
    ...content,
    id: newId(),
    deck,
    createdAt: Date.now(),
    level: 0,
    card: createEmptyCard(new Date()),
    mySentences: [],
    usedInLife: 0,
    suspended: false,
  };
}

export async function resetItem(id: string) {
  await db.items.update(id, { level: 0, card: createEmptyCard(new Date()), ladder: 0 });
}
