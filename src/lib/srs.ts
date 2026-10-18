import { createEmptyCard, fsrs, generatorParameters, Rating, type Grade } from 'ts-fsrs';
import { db, getSettings, newId } from './db';
import { dayKey } from './dates';
import type { ExerciseKind, Item, ItemContent, Result } from './types';

const RECOGNITION: ExerciseKind[] = ['choice', 'pairs', 'flashcard'];
const RECALL: ExerciseKind[] = ['cloze', 'cloze-ru', 'recall', 'dictation'];

/** Days of stability after which a "used" item counts as mastered. */
export const MASTERED_STABILITY = 21;

function scheduler(retention: number) {
  // Short-term steps off: a failed card is shown again inside the session instead.
  return fsrs(generatorParameters({ request_retention: retention, enable_fuzz: true, enable_short_term: false }));
}

export function gradeFor(result: Result): Grade {
  if (result === 'wrong') return Rating.Again;
  if (result === 'almost') return Rating.Hard;
  return Rating.Good;
}

/** How the mastery level moves after one exercise. Pure, so it can be tested. */
export function nextLevel(item: Pick<Item, 'level' | 'card'>, exercise: ExerciseKind, result: Result): number {
  let level = item.level;
  const ok = result !== 'wrong';
  if (exercise === 'intro') return Math.max(level, 1);
  if (!ok) return level >= 3 ? level - 1 : Math.max(level, 1);
  if (RECOGNITION.includes(exercise)) level = Math.max(level, Math.min(level + 1, 2));
  else if (RECALL.includes(exercise)) level = Math.max(level, 3);
  else if (exercise === 'sentence' && level >= 3) level = Math.max(level, 4);
  if (level === 4 && item.card.stability >= MASTERED_STABILITY && result === 'correct') level = 5;
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
    update.card = scheduler(retention).next(item.card, now, gradeFor(result)).card;
  }
  if (scheduled || exercise === 'sentence') {
    update.level = nextLevel({ level: item.level, card: update.card ?? item.card }, exercise, result);
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
  await db.items.update(id, { level: 0, card: createEmptyCard(new Date()) });
}
