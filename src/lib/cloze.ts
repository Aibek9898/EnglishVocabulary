import { normalize, slotKind, stripPlaceholders } from './check';

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
 * Word-length blanks for a scaffolded gap: "make a decision" -> "____ _ ________".
 * Apostrophes and hyphens stay visible.
 */
export function wordBlanks(answer: string): string {
  return answer
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[\p{L}\p{N}]/gu, '_'))
    .join(' ');
}

/** Words of a term that are too common to mask in a definition. */
const NOT_CONTENT = new Set(
  'a an the be is are was were been being to of in on at by for with from into onto up down out off over about and or not as so if than that this there what when how can will it i me my you your he him his she her we us our they them their one'.split(
    ' ',
  ),
);
const IRREGULAR: Record<string, string[]> = {
  make: ['made'],
  take: ['took', 'taken'],
  get: ['got', 'gotten'],
  give: ['gave', 'given'],
  go: ['goes', 'went', 'gone'],
  come: ['came'],
  do: ['does', 'did', 'done'],
  have: ['has', 'had'],
  run: ['ran'],
  find: ['found'],
  bring: ['brought'],
  keep: ['kept'],
  lose: ['lost'],
  fall: ['fell', 'fallen'],
  feel: ['felt'],
  catch: ['caught'],
  break: ['broke', 'broken'],
  stand: ['stood'],
  lay: ['laid'],
  pay: ['paid'],
  hold: ['held'],
  spend: ['spent'],
  tell: ['told'],
  think: ['thought'],
  buy: ['bought'],
  meet: ['met'],
};

/** A regex source matching a word and its simple inflections: decide/decides/decided/deciding, stop/stopped. */
function wordForms(word: string): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forms = [`${esc(word)}(?:s|es|ed|d|ing)?`, ...(IRREGULAR[word] ?? []).map(esc)];
  if (word.endsWith('e')) forms.push(`${esc(word.slice(0, -1))}(?:ing|ed)`);
  if (/[^aeiou]y$/.test(word)) forms.push(`${esc(word.slice(0, -1))}i(?:es|ed)`);
  if (/[^aeiou][aeiou][bdfgklmnprtvz]$/.test(word)) forms.push(`${esc(word)}${word.slice(-1)}(?:ed|ing)`);
  return forms.join('|');
}

/**
 * Hides the term's content words (and simple inflections) in a text, so a
 * recall prompt's definition does not give the answer away:
 * maskTerm("to change a decision", "change your mind") -> "to … a decision".
 */
export function maskTerm(text: string, term: string): string {
  const words = [...new Set(normalize(term).split(' '))].filter((w) => w && !NOT_CONTENT.has(w) && !slotKind(w));
  if (!text || !words.length) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(wordForms).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return text.replace(re, '…').replace(/…(?:\s+…)+/g, '…');
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
