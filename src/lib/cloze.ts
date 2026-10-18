import { normalize, stripPlaceholders } from './check';

export interface Cloze {
  before: string;
  answer: string;
  after: string;
}

/** Splits "We need to [make a decision] by Friday." into the parts around the target. */
export function parseCloze(example: string, term?: string): Cloze | null {
  const m = example.match(/^(.*?)\[([^\]]+)\](.*)$/s);
  if (m) return { before: m[1], answer: m[2].trim(), after: m[3] };
  if (!term) return null;
  // No brackets: look for the term itself (without sth/sb) in the sentence.
  const target = stripPlaceholders(term);
  if (!target) return null;
  const idx = example.toLowerCase().indexOf(target);
  if (idx < 0) return null;
  return {
    before: example.slice(0, idx),
    answer: example.slice(idx, idx + target.length),
    after: example.slice(idx + target.length),
  };
}

/** The example sentence with the brackets removed. */
export function plainExample(example: string): string {
  return example.replace(/\[([^\]]+)\]/g, '$1');
}

/** "make a decision" -> "m___ a d_______" style hint: first letter of each word. */
export function firstLetterHint(answer: string): string {
  return answer
    .split(' ')
    .map((w) => (w.length <= 1 ? w : w[0] + '_'.repeat(w.length - 1)))
    .join(' ');
}

/**
 * Rough check that a sentence uses the term: every content word of the term
 * must appear, allowing simple inflection (decide -> decided, make -> making).
 */
export function sentenceUsesTerm(sentence: string, term: string): boolean {
  const words = new Set(normalize(sentence).split(' '));
  const stems = [...words].map((w) => w.replace(/(ing|ed|es|s|d)$/, ''));
  const termWords = stripPlaceholders(term)
    .split(' ')
    .filter((w) => w.length > 2 || ['up', 'on', 'in', 'at', 'by', 'of', 'to', 'go', 'do'].includes(w));
  if (!termWords.length) return false;
  return termWords.every((tw) => {
    if (words.has(tw)) return true;
    const stem = tw.replace(/(e|ing|ed|es|s)$/, '');
    if (stem.length < 3) return false;
    return stems.some((s) => s.startsWith(stem)) || [...words].some((w) => w.startsWith(stem));
  });
}
