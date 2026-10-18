/** Lowercase, unify quotes, drop punctuation and extra spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PLACEHOLDERS = new Set(['sth', 'sb', 'something', 'somebody', 'someone', "one's", "sb's", "someone's"]);

/** Drops sth/sb-style placeholders so "put sth off" and "put off" compare equal. */
export function stripPlaceholders(text: string): string {
  return normalize(text)
    .split(' ')
    .filter((w) => !PLACEHOLDERS.has(w))
    .join(' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export type Verdict = 'correct' | 'almost' | 'wrong';

/**
 * A typo, not a different word: same number of words, short words exact
 * (make vs take is a real mistake), longer words within 1-2 edits.
 */
function isTypo(input: string, expected: string): boolean {
  const a = input.split(' ');
  const b = expected.split(' ');
  if (a.length !== b.length) return false;
  return a.every((w, i) => {
    const e = b[i];
    if (w === e) return true;
    if (e.length < 5) return false;
    return levenshtein(w, e) <= (e.length >= 8 ? 2 : 1);
  });
}

/** Exact match is correct, a small typo is "almost", anything else is wrong. */
export function checkAnswer(input: string, expected: string, { ignorePlaceholders = false } = {}): Verdict {
  const clean = ignorePlaceholders ? stripPlaceholders : normalize;
  const a = clean(input);
  const options = expected.split('/').map((e) => clean(e)).filter(Boolean);
  if (!a) return 'wrong';
  if (options.includes(a)) return 'correct';
  return options.some((e) => isTypo(a, e)) ? 'almost' : 'wrong';
}
