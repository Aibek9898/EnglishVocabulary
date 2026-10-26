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
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  say: ['said'],
  see: ['saw', 'seen'],
  know: ['knew', 'known'],
  leave: ['left'],
  send: ['sent'],
  sell: ['sold'],
  teach: ['taught'],
  fight: ['fought'],
  speak: ['spoke', 'spoken'],
  write: ['wrote', 'written'],
  drive: ['drove', 'driven'],
  throw: ['threw', 'thrown'],
  blow: ['blew', 'blown'],
  grow: ['grew', 'grown'],
  win: ['won'],
  sit: ['sat'],
  lead: ['led'],
  stick: ['stuck'],
  hang: ['hung'],
  mean: ['meant'],
  deal: ['dealt'],
  bite: ['bit', 'bitten'],
  shake: ['shook', 'shaken'],
  wake: ['woke', 'woken'],
  wear: ['wore', 'worn'],
  tear: ['tore', 'torn'],
  begin: ['began', 'begun'],
  forget: ['forgot', 'forgotten'],
  choose: ['chose', 'chosen'],
  steal: ['stole', 'stolen'],
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

const ARTICLES = new Set(['a', 'an', 'the']);

/**
 * Where a term is used in a sentence, allowing other forms of its words and
 * any words in place of sth/sb/your: "trip sb up" is found in "The last
 * question really tripped me up." as "tripped me up". Null when it isn't there.
 */
export function findTarget(sentence: string, term: string): { start: number; end: number } | null {
  // "fall over / fall over sth", "be (a bit) out of sth": the first variant is enough.
  const main = term.split(/[/(]/)[0].trim();
  if (!main) return null;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = new RegExp(`(?<![\\p{L}\\p{N}])${esc(main)}(?![\\p{L}\\p{N}])`, 'iu').exec(sentence);
  if (exact) return { start: exact.index, end: exact.index + exact[0].length };
  const words = normalize(main)
    .split(' ')
    .filter((w) => w && !ARTICLES.has(w) && !slotKind(w));
  if (!words.length) return null;
  const word = (w: string) => `(?<![\\p{L}\\p{N}])(?:${/^[a-z]+$/.test(w) ? wordForms(w) : esc(w)})(?![\\p{L}\\p{N}])`;
  // Up to three other words may stand between the term's words: "tripped [me] up", "make a [quick] decision".
  const re = new RegExp(words.map(word).join('(?:\\s+\\S+){0,3}?\\s+'), 'iu');
  const m = re.exec(sentence);
  if (!m) return null;
  let start = m.index;
  // Keep a leading article: "the last straw", not "last straw".
  const before = sentence.slice(0, start).match(/\b(a|an|the)\s+$/i);
  if (before && ARTICLES.has(normalize(main).split(' ')[0])) start -= before[0].length;
  return { start, end: m.index + m[0].length };
}

/** Puts the term in [brackets] inside the example, if it is there and nothing is marked yet. */
export function markExample(example: string, term: string): string {
  if (!term.trim() || example.includes('[')) return example;
  const t = findTarget(example, term);
  if (!t) return example;
  return `${example.slice(0, t.start)}[${example.slice(t.start, t.end)}]${example.slice(t.end)}`;
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
