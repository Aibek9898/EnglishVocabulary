/**
 * The Reading section's English–Russian dictionary: V.K. Mueller's dictionary
 * (GPL electronic edition), split into small files in public/dict by the first
 * two letters (built by scripts/build-dictionary.mjs). A tap on a word loads
 * one file of a few kilobytes; the browser caches it after that.
 */

export interface Sense {
  /** "noun", "verb"…; empty when the entry doesn't say. */
  pos: string;
  /** Short Russian translations, e.g. "беспокойство, тревога". */
  text: string;
}

export interface Entry {
  word: string;
  ipa?: string;
  senses: Sense[];
  /** "past of go", when the word is a form of another word. */
  formOf?: { relation: string; word: string };
  /** The whole entry, one line per sense, with examples, for "Full entry". */
  lines: { depth: number; text: string }[];
}

export interface Lookup {
  /** The word as it was tapped, e.g. "went". */
  surface: string;
  /** The entry found for it, e.g. "went" (past of go) or "smart" for "smarter". */
  entry: Entry;
  /** The base word's entry when the found one is only a form, e.g. "go" for "went". */
  base?: Entry;
}

const POS: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  a: 'adjective',
  adv: 'adverb',
  prep: 'preposition',
  cj: 'conjunction',
  conj: 'conjunction',
  pron: 'pronoun',
  int: 'interjection',
  interj: 'interjection',
  num: 'numeral',
  'n-card': 'numeral',
  'n-ord': 'numeral',
  art: 'article',
  part: 'particle',
  predic: 'predicative',
  pref: 'prefix',
  suff: 'suffix',
};

const FORMS: Record<string, string> = {
  p: 'past of',
  'p-p': 'past participle of',
  pl: 'plural of',
  'pres-p': '-ing form of',
  comp: 'comparative of',
  superl: 'superlative of',
};

const LATIN = /[a-z]/i;

/** Drops English grammar labels ("_inf.") and keeps Russian ones ("_разг." → "разг."). */
function tidy(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/_([а-яё][а-яё-]*\.)/gi, '$1')
    .replace(/_[a-z][\w-]*\.?/gi, '')
    .replace(/\s+([,;)])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The Russian translations of one sense line, without the English examples. */
export function shortSense(line: string): string {
  const parts = tidy(line.replace(/\([^)]*[a-z][^)]*\)/gi, ''))
    .split(';')
    .map((s) => s.trim().replace(/^[,.:\s]+|[,:\s]+$/g, ''))
    .filter((s) => s && !LATIN.test(s) && /[а-яё]/i.test(s));
  return parts.join('; ');
}

function depthOf(line: string): number {
  if (/^_[IVX]+\b/.test(line)) return 0;
  if (/^\d+\.\s/.test(line)) return 1;
  if (/^\d+\)/.test(line)) return 2;
  if (/^[а-я]\)/.test(line)) return 3;
  return 1;
}

/** Turns one stored entry into senses for the popup. */
export function parseEntry(word: string, text: string): Entry {
  const raw = text.split('\n').filter(Boolean);
  const ipa = text.match(/\[([^\]]+)\]/)?.[1];
  const senses: Sense[] = [];
  let pos = '';
  let formOf: Entry['formOf'];
  const lines: Entry['lines'] = [];
  for (const line of raw) {
    let rest = line
      .replace(/^_[IVX]+\s*/, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/\([^)]*полная форма[^)]*\)/, '')
      .trim();
    const form = rest.match(/\(?_(p|p-p|pl|pres-p|comp|superl)\.\s+от\s+([a-z][a-z' -]*?)(?=\s+(?:\d|[IVX]+\b)|[);,]|$)/i);
    if (form && !formOf) formOf = { relation: FORMS[form[1]], word: form[2].trim() };
    rest = rest.replace(/\(?_(p|p-p|pl|pres-p|comp|superl)\.\s+от\s+[a-z][a-z' -]*?(?:\s+(?:\d+|[IVX]+))?(?:,\s*\d+)?\)?(?=[\s;,]|$)/gi, '').trim();
    rest = rest.replace(/^\d+\.\s*/, '');
    const posMatch = rest.match(/^_([a-z-]+)\.\s*/i);
    if (posMatch && POS[posMatch[1]]) {
      pos = POS[posMatch[1]];
      rest = rest.slice(posMatch[0].length);
    } else if (/^\d+\.\s/.test(line.replace(/^_[IVX]+\s*/, ''))) {
      pos = '';
    }
    const shown = tidy(line.replace(/\[[^\]]+\]/g, '')).replace(/^_[IVX]+\s*/, '');
    if (shown) lines.push({ depth: depthOf(line), text: shown });
    const sense = shortSense(rest.replace(/^\d+\)\s*|^[а-я]\)\s*/, ''));
    if (sense) senses.push({ pos, text: sense });
  }
  return { word, ipa, senses, formOf, lines };
}

/* ---------- finding the dictionary form ---------- */

const CONTRACTIONS: [RegExp, string][] = [
  [/^won't$/, 'will'],
  [/^can't$/, 'can'],
  [/^shan't$/, 'shall'],
  [/n't$/, ''],
  [/'(s|re|ve|ll|d|m)$/, ''],
  [/s'$/, 's'],
];

/** Dictionary forms to try for a word as it appears in a text, best first. */
export function candidates(surface: string): string[] {
  let w = surface.toLowerCase().replace(/[’‘]/g, "'");
  const out: string[] = [];
  const add = (s: string) => {
    if (s.length > 1 && !out.includes(s)) out.push(s);
  };
  add(w);
  // Phrases are looked up only as they are.
  if (w.includes(' ')) return out;
  for (const [re, to] of CONTRACTIONS) {
    if (re.test(w)) {
      w = w.replace(re, to);
      add(w);
      break;
    }
  }
  const stem = (suffix: string) => w.slice(0, -suffix.length);
  const doubled = (s: string) => s.length > 2 && s[s.length - 1] === s[s.length - 2] && !/[aeiouslz]/.test(s[s.length - 1]);
  if (w.endsWith('ies') && w.length > 4) add(stem('ies') + 'y');
  if (w.endsWith('ves')) {
    add(stem('ves') + 'f');
    add(stem('ves') + 'fe');
  }
  if (/(s|x|z|ch|sh|o)es$/.test(w)) add(stem('es'));
  if (w.endsWith('s') && !w.endsWith('ss')) add(stem('s'));
  if (w.endsWith('ied')) add(stem('ied') + 'y');
  for (const suffix of ['ed', 'ing', 'er', 'est']) {
    if (!w.endsWith(suffix) || w.length < suffix.length + 2) continue;
    const s = stem(suffix);
    if (doubled(s)) add(s.slice(0, -1));
    add(s);
    add(s + 'e');
    if (suffix === 'ing' && s.endsWith('y')) add(s.slice(0, -1) + 'ie');
    if ((suffix === 'er' || suffix === 'est') && s.endsWith('i')) add(s.slice(0, -1) + 'y');
  }
  if (w.endsWith('ily')) add(stem('ily') + 'y');
  if (w.endsWith('ly')) {
    add(stem('ly'));
    add(stem('ly') + 'le');
  }
  if (w.includes('-')) w.split('-').forEach(add);
  return out;
}

/* ---------- loading ---------- */

type Shard = Record<string, string>;
const shards = new Map<string, Promise<Shard>>();

export function shardOf(word: string): string {
  const k = word.toLowerCase();
  return /^[a-z]{2}/.test(k) ? k.slice(0, 2) : /^[a-z]/.test(k) ? k[0] + '_' : '__';
}

let fetcher: (url: string) => Promise<Shard> = async (url) => {
  const res = await fetch(url);
  // No words start with these letters.
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`Dictionary file ${url}: ${res.status}`);
  return (await res.json()) as Shard;
};

/** For tests: read the dictionary files some other way. */
export function setDictionaryFetcher(fn: typeof fetcher) {
  fetcher = fn;
  shards.clear();
}

function loadShard(prefix: string): Promise<Shard> {
  let p = shards.get(prefix);
  if (!p) {
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
    p = fetcher(`${base}dict/${prefix}.json`).catch((e) => {
      shards.delete(prefix);
      throw e;
    });
    shards.set(prefix, p);
  }
  return p;
}

async function raw(word: string): Promise<string | null> {
  const shard = await loadShard(shardOf(word));
  return Object.prototype.hasOwnProperty.call(shard, word) ? shard[word] : null;
}

/** Finds a tapped word in the dictionary, following "went" to "go". Null when it isn't there. */
export async function lookup(surface: string): Promise<Lookup | null> {
  for (const c of candidates(surface)) {
    const text = await raw(c);
    if (!text) continue;
    const entry = parseEntry(c, text);
    let base: Entry | undefined;
    if (entry.formOf && entry.formOf.word !== c) {
      const t = await raw(entry.formOf.word.toLowerCase());
      if (t) base = parseEntry(entry.formOf.word, t);
    }
    return { surface, entry, base };
  }
  return null;
}

/** The first few translations, for a quick gloss or to prefill a new card. */
export function gloss(found: Lookup | null, max = 2): string {
  if (!found) return '';
  const senses = found.entry.senses.length ? found.entry.senses : (found.base?.senses ?? []);
  return senses
    .slice(0, max)
    .map((s) => s.text.split(';')[0].trim())
    .join('; ');
}
