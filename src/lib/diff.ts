import { normalize } from './check';

export interface DiffWord {
  text: string;
  /** False when this word is not in the other answer. */
  same: boolean;
}

/**
 * Word-level comparison of the learner's answer with the right one, for the
 * "You wrote / Answer" feedback: words outside the longest common sequence are
 * marked, e.g. "did a mistake" vs "made a mistake" marks "did" and "made".
 */
export function diffWords(input: string, expected: string): { yours: DiffWord[]; answer: DiffWord[] } {
  const a = input.trim().split(/\s+/).filter(Boolean);
  const b = expected.trim().split(/\s+/).filter(Boolean);
  const na = a.map(normalize);
  const nb = b.map(normalize);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = na[i] === nb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const inA = new Set<number>();
  const inB = new Set<number>();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (na[i] === nb[j]) {
      inA.add(i++);
      inB.add(j++);
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  return {
    yours: a.map((text, i) => ({ text, same: inA.has(i) })),
    answer: b.map((text, j) => ({ text, same: inB.has(j) })),
  };
}
