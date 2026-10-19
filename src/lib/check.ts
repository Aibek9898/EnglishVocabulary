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
/** Slot words in a term that stand for any object: "turn sth down". */
const THING_SLOTS = new Set(['sth', 'sb', 'something', 'somebody', 'someone']);
/** Slot words that stand for any possessive: "change your mind", "get on sb's nerves". */
const POSSESSIVE_SLOTS = new Set(["one's", "sb's", "someone's", "somebody's", 'your']);
const POSSESSIVE = /^(my|your|his|her|our|their|its|\S+'s)$/;

/** Drops sth/sb-style placeholders so "put sth off" and "put off" compare equal. */
export function stripPlaceholders(text: string): string {
  return normalize(text)
    .split(' ')
    .filter((w) => !PLACEHOLDERS.has(w))
    .join(' ');
}

/** 'thing' for sth/sb/someone…, 'possessive' for one's/sb's/your, else null. Expects a normalized word. */
export function slotKind(word: string): 'thing' | 'possessive' | null {
  if (THING_SLOTS.has(word)) return 'thing';
  if (POSSESSIVE_SLOTS.has(word)) return 'possessive';
  return null;
}

/** True when the text contains Russian (Cyrillic) letters: the UI asks for English instead of grading. */
export function detectCyrillic(input: string): boolean {
  return /\p{Script=Cyrillic}/u.test(input);
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

/** One position of an expected answer: a slot, or a word with its "/" alternatives. */
type Segment = { slot: 'thing' | 'possessive' } | { alts: string[][]; optional?: boolean };

/**
 * "angry with/angry at" is two whole answers; "drop sb/sth off" and
 * "be in a good/bad mood" are alternatives for one word.
 */
function wholeAlternatives(expected: string): string[] {
  const parts = expected.split(/\s*\/\s*/).map(normalize);
  const words = parts.map((p) => p.split(' '));
  const whole = parts.length > 1 && words.every((w) => w.length >= 2 && w[0] === words[0][0]);
  return whole ? parts : [expected];
}

function segments(expected: string): Segment[] {
  const out: Segment[] = [];
  for (const token of expected.replace(/\s*\/\s*/g, '/').trim().split(/\s+/)) {
    const parts = token.split('/').map(normalize).filter(Boolean);
    if (!parts.length) continue;
    if (parts.every((p) => slotKind(p) === 'thing')) out.push({ slot: 'thing' });
    else if (parts.every((p) => slotKind(p) === 'possessive')) out.push({ slot: 'possessive' });
    // A dictionary-form "be" ("be fed up with sth") may be left out when recalling.
    else out.push({ alts: parts.map((p) => p.split(' ')), optional: !out.length && parts.join() === 'be' });
  }
  return out;
}

/**
 * A typo, not a different word: short words exact (make vs take is a real
 * mistake), longer words within 1-2 edits.
 */
function sameWord(input: string | undefined, expected: string, fuzzy: boolean): boolean {
  if (input === undefined) return false;
  if (input === expected) return true;
  if (!fuzzy || expected.length < 5) return false;
  return levenshtein(input, expected) <= (expected.length >= 8 ? 2 : 1);
}

/**
 * Matches the input words against the segments. A sth/sb slot takes any 1-3
 * words (0-3 when optional, as is a leading "be"), a possessive slot one of
 * my/your/his/…/Anna's.
 */
function matches(input: string[], segs: Segment[], fuzzy: boolean, optional: boolean): boolean {
  const go = (i: number, j: number): boolean => {
    if (j === segs.length) return i === input.length;
    const s = segs[j];
    if ('slot' in s) {
      if (s.slot === 'possessive') return i < input.length && POSSESSIVE.test(input[i]) && go(i + 1, j + 1);
      for (let k = optional ? 0 : 1; k <= 3 && i + k <= input.length; k++) if (go(i + k, j + 1)) return true;
      return false;
    }
    if (optional && s.optional && go(i, j + 1)) return true;
    return s.alts.some((alt) => alt.every((w, k) => sameWord(input[i + k], w, fuzzy)) && go(i + alt.length, j + 1));
  };
  return go(0, 0);
}

export interface CheckOptions {
  /** Recall of a dictionary form: "put off" counts for "put sth off", "fed up with" for "be fed up with sth". */
  ignorePlaceholders?: boolean;
  /** Extra answers that count as right, e.g. the item's `accepted` list. */
  accepted?: string[];
}

/**
 * Exact match is correct, a small typo is "almost", anything else is wrong.
 * sth/sb slots in the expected answer accept any 1-3 words ("turn it down" for
 * "turn sth down"), possessive slots any possessive ("change my mind" for
 * "change one's mind"). Alternatives can be separated by "/".
 */
export function checkAnswer(input: string, expected: string, { ignorePlaceholders = false, accepted = [] }: CheckOptions = {}): Verdict {
  const clean = normalize(input);
  if (!clean) return 'wrong';
  // Typed placeholders ("put sth off") fill an optional slot, so drop them.
  const words = clean.split(' ').filter((w) => !ignorePlaceholders || slotKind(w) !== 'thing');
  const patterns = [expected, ...accepted].flatMap(wholeAlternatives).map(segments).filter((s) => s.length);
  if (patterns.some((p) => matches(words, p, false, ignorePlaceholders))) return 'correct';
  return patterns.some((p) => matches(words, p, true, ignorePlaceholders)) ? 'almost' : 'wrong';
}
