import { useEffect, useRef } from 'react';
import { recordResult } from '../../lib/srs';
import type { ExerciseKind, Item, Result } from '../../lib/types';

/** What every game gets from the Practice page. */
export interface GameProps {
  /** Words in the chosen scope (a snapshot taken when the game started). */
  pool: Item[];
  /** Every active word in the library, for distractors and fallbacks. */
  all: Item[];
  onExit: () => void;
  onAgain: () => void;
}

export const EXIT_LABEL = 'End game';

/**
 * Logs one game answer so it counts towards the streak. Games never change
 * the review schedule (scheduled = false) and a failed write never blocks play.
 */
export function logGame(item: Item | undefined, exercise: ExerciseKind, result: Result) {
  if (!item) return;
  recordResult(item, exercise, result, false).catch((e) => console.error(e));
}

/**
 * Global key handler for a game: ignores typing in fields, key combos and
 * auto-repeat, so one press is one answer.
 */
export function useKeys(handler: (key: string, e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
      ref.current(e.key, e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Calls `fn` after `ms`, cancelled on unmount or when a new one is scheduled. */
export function useLater() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (fn: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
}

const PRAISE = ['Correct!', 'Nice!', 'Exactly!', 'Well done!', 'Spot on!'];

/** A short word of praise that changes from round to round. */
export function praise(n: number): string {
  return PRAISE[n % PRAISE.length];
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
