import asIf from '../data/grammar/as-if.json';
import { toLesson, type GrammarLesson, type GrammarStore } from './grammar';

/** Lessons that ship with the app. New ones go in src/data/grammar/ and here. */
export const BUILTIN: GrammarLesson[] = [asIf].map((raw) => {
  const lesson = toLesson(raw, { source: 'builtin', createdAt: Date.UTC(2026, 10, 21) });
  if (!lesson) throw new Error(`Grammar lesson ${raw.id} is incomplete`);
  return lesson;
});

/** Built-in lessons first, then the ones the AI wrote, newest first. */
export function allLessons(store: GrammarStore | null): GrammarLesson[] {
  const own = (store?.lessons ?? []).filter((l) => !BUILTIN.some((b) => b.id === l.id)).sort((a, b) => b.createdAt - a.createdAt);
  return [...BUILTIN, ...own];
}
