import { addDays, dayKey } from './dates';
import type { ExerciseKind, Item, ReviewEntry } from './types';

/** A day counts towards the streak after this many exercises. */
export const MIN_DAY = 5;
const MAX_FREEZES = 2;

export function activityByDay(reviews: ReviewEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of reviews) map.set(r.day, (map.get(r.day) ?? 0) + 1);
  return map;
}

export interface Streak {
  current: number;
  best: number;
  freezes: number;
  activeToday: boolean;
}

/**
 * Walks every day from the first activity to today. Each 7 active days earns a
 * freeze (max 2); a missed day uses a freeze instead of breaking the streak.
 * Today never breaks the streak: it can still be done.
 */
export function computeStreak(byDay: Map<string, number>, today = new Date()): Streak {
  const days = [...byDay.entries()].filter(([, n]) => n >= MIN_DAY).map(([d]) => d).sort();
  const activeToday = (byDay.get(dayKey(today)) ?? 0) >= MIN_DAY;
  if (!days.length) return { current: 0, best: 0, freezes: 0, activeToday };
  const active = new Set(days);
  const todayKey = dayKey(today);
  let current = 0;
  let best = 0;
  let freezes = 0;
  let activeCount = 0;
  const [y, m, d] = days[0].split('-').map(Number);
  for (let day = new Date(y, m - 1, d); dayKey(day) <= todayKey; day = addDays(day, 1)) {
    const key = dayKey(day);
    if (active.has(key)) {
      current++;
      activeCount++;
      if (activeCount % 7 === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
    } else if (key !== todayKey) {
      if (freezes > 0) freezes--;
      else current = 0;
    }
    best = Math.max(best, current);
  }
  return { current, best, freezes, activeToday };
}

/** Answers from memory that measure retention ('dictation' only appears in older logs). */
const RECALLED: ExerciseKind[] = ['cloze', 'cloze-ru', 'recall', 'say', 'dictation'];

/**
 * Share of reviews remembered in the last `days` days, or null below 10 reviews.
 * Counts the first scheduled typed or said answer per item per day, but not a
 * new item's first check on the day it was introduced. Almost (typo) counts as
 * remembered; hinted and wrong do not.
 */
export function retention(reviews: ReviewEntry[], days = 30, now = new Date()): number | null {
  const since = now.getTime() - days * 864e5;
  const introduced = new Set(reviews.filter((r) => r.exercise === 'intro').map((r) => `${r.itemId}|${r.day}`));
  const first = new Map<string, ReviewEntry>();
  for (const r of [...reviews].sort((a, b) => a.at - b.at)) {
    const key = `${r.itemId}|${r.day}`;
    if (!r.scheduled || r.at < since || !RECALLED.includes(r.exercise) || introduced.has(key) || first.has(key)) continue;
    first.set(key, r);
  }
  const rel = [...first.values()];
  if (rel.length < 10) return null;
  return rel.filter((r) => r.result === 'correct' || r.result === 'almost').length / rel.length;
}

export function levelCounts(items: Item[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const i of items) counts[Math.min(5, Math.max(0, i.level))]++;
  return counts;
}

export function usable(items: Item[]): number {
  return items.filter((i) => i.level >= 4).length;
}

export function dueOn(items: Item[], date: Date): number {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return items.filter((i) => !i.suspended && i.level > 0 && new Date(i.card.due) <= end).length;
}

export const MILESTONES = [10, 25, 50, 100, 200, 300, 500, 750, 1000];
