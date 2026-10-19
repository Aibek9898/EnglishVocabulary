/**
 * Pure helpers for the Practice games: picking words, building rounds,
 * masking sentences with a typical mistake, comparing answers and scoring.
 * No database or DOM access here, so everything can be unit-tested.
 */
import { normalize } from './check';
import { parseCloze, plainExample, sentenceUsesTerm } from './cloze';
import type { Item } from './types';

export type Rand = () => number;

/** Fisher–Yates; returns a new array. */
export function shuffle<T>(list: readonly T[], rand: Rand = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(list: readonly T[], rand: Rand): T {
  return list[Math.floor(rand() * list.length)];
}

/* ================= scope ================= */

/** 'started' | 'weak' | 'all' | 'tag:<name>' */
export type Scope = string;

/** Words that need work: started, and either low level or forgotten twice. */
export function isWeak(item: Item): boolean {
  return item.level > 0 && (item.level <= 2 || item.card.lapses >= 2);
}

export function scopeItems(items: Item[], scope: Scope): Item[] {
  const active = items.filter((i) => !i.suspended);
  if (scope === 'started') return active.filter((i) => i.level > 0);
  if (scope === 'weak') return active.filter(isWeak);
  if (scope.startsWith('tag:')) {
    const tag = scope.slice(4);
    return active.filter((i) => i.tags.includes(tag));
  }
  return active;
}

/** Games need this many words; it is also the bar for defaulting to "Started". */
export const MIN_WORDS = 5;

/** "Started" when there are enough started words, else "Everything". */
export function defaultScope(items: Item[]): Scope {
  return scopeItems(items, 'started').length >= MIN_WORDS ? 'started' : 'all';
}

export function allTags(items: Item[]): string[] {
  return [...new Set(items.filter((i) => !i.suspended).flatMap((i) => i.tags))].filter(Boolean).sort();
}

/** Up to `n` items with different terms and translations (so no two tiles or options look the same). */
export function pickDistinct(items: Item[], n: number, rand: Rand = Math.random): Item[] {
  const terms = new Set<string>();
  const translations = new Set<string>();
  const out: Item[] = [];
  for (const i of shuffle(items, rand)) {
    const t = normalize(i.term);
    const r = normalize(i.translation);
    if (!t || !r || terms.has(t) || translations.has(r)) continue;
    terms.add(t);
    translations.add(r);
    out.push(i);
    if (out.length === n) break;
  }
  return out;
}

/* ================= which games can run ================= */

export type GameId = 'blitz' | 'sorter' | 'mistake' | 'build' | 'roleplay' | 'pairs' | 'quiz' | 'typing' | 'dictation' | 'flashcards';

export function hasCloze(item: Item): boolean {
  return !!item.example && !!parseCloze(item.example, item.term);
}

/** The reason a game can't run with these words, or null when it can. */
export function gameBlocker(game: GameId, pool: Item[]): string | null {
  switch (game) {
    case 'sorter':
    case 'roleplay':
      return null;
    case 'typing':
      return pool.filter(hasCloze).length >= MIN_WORDS ? null : `Needs ${MIN_WORDS} words with examples`;
    case 'mistake':
    case 'blitz':
      return mistakeItems(pool).length >= MIN_WORDS ? null : `Needs ${MIN_WORDS} words with typical mistakes`;
    case 'build':
      return buildItems(pool).length >= MIN_WORDS ? null : `Needs ${MIN_WORDS} words with short examples`;
    default:
      return pickDistinct(pool, MIN_WORDS).length >= MIN_WORDS ? null : `Needs ${MIN_WORDS} words`;
  }
}

/* ================= scoring ================= */

export function scoreTitle(score: number, max: number): string {
  if (max <= 0) return 'Done!';
  const r = score / max;
  if (r >= 1) return 'Perfect!';
  if (r >= 0.8) return 'Great job!';
  if (r >= 0.5) return 'Nice work!';
  return 'Keep going!';
}

/** 75 -> "1:15" */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ================= make / do / take / have ================= */

export const LIGHT_VERBS = ['make', 'do', 'take', 'have'] as const;
export type LightVerb = (typeof LIGHT_VERBS)[number];

export interface VerbPhrase {
  verb: LightVerb;
  phrase: string;
  ru: string;
}

/**
 * Built-in cards. Each phrase takes exactly one of the four verbs in both
 * British and American English. Left out on purpose because two verbs are
 * natural: a shower/bath/break/look/rest/walk/nap/seat (take or have),
 * a decision (take in British English), notes (make in British English),
 * exercise (take in British English), homework/friends/money/an excuse/
 * a suggestion/a complaint/an appointment (have), a phone call (take/have).
 */
export const VERB_PHRASES: VerbPhrase[] = [
  { verb: 'make', phrase: 'a mistake', ru: 'ошибиться' },
  { verb: 'make', phrase: 'progress', ru: 'делать успехи' },
  { verb: 'make', phrase: 'an effort', ru: 'приложить усилия' },
  { verb: 'make', phrase: 'sure', ru: 'убедиться, проследить' },
  { verb: 'make', phrase: 'sense', ru: 'иметь смысл' },
  { verb: 'make', phrase: 'a difference', ru: 'иметь значение, влиять' },
  { verb: 'make', phrase: 'a noise', ru: 'шуметь' },
  { verb: 'make', phrase: 'a mess', ru: 'устроить беспорядок' },
  { verb: 'make', phrase: 'the bed', ru: 'заправить кровать' },
  { verb: 'make', phrase: 'a living', ru: 'зарабатывать на жизнь' },
  { verb: 'make', phrase: 'a promise', ru: 'дать обещание' },
  { verb: 'make', phrase: 'a fuss', ru: 'поднимать шум, суетиться' },
  { verb: 'make', phrase: 'an exception', ru: 'сделать исключение' },
  { verb: 'make', phrase: 'up your mind', ru: 'определиться, решить' },
  { verb: 'do', phrase: 'research', ru: 'проводить исследования' },
  { verb: 'do', phrase: 'the shopping', ru: 'ходить за покупками' },
  { verb: 'do', phrase: 'the dishes', ru: 'мыть посуду' },
  { verb: 'do', phrase: 'the laundry', ru: 'стирать' },
  { verb: 'do', phrase: 'the ironing', ru: 'гладить бельё' },
  { verb: 'do', phrase: 'the housework', ru: 'делать работу по дому' },
  { verb: 'do', phrase: 'the cooking', ru: 'готовить еду' },
  { verb: 'do', phrase: 'the cleaning', ru: 'убираться' },
  { verb: 'do', phrase: 'your best', ru: 'стараться изо всех сил' },
  { verb: 'do', phrase: 'me a favour', ru: 'сделать мне одолжение' },
  { verb: 'do', phrase: 'more harm than good', ru: 'принести больше вреда, чем пользы' },
  { verb: 'do', phrase: 'the gardening', ru: 'работать в саду' },
  { verb: 'take', phrase: 'a photo', ru: 'сфотографировать' },
  { verb: 'take', phrase: 'a risk', ru: 'рисковать' },
  { verb: 'take', phrase: 'part in', ru: 'участвовать в' },
  { verb: 'take', phrase: 'place', ru: 'состояться, проходить' },
  { verb: 'take', phrase: 'advantage of', ru: 'воспользоваться' },
  { verb: 'take', phrase: 'a taxi', ru: 'поехать на такси' },
  { verb: 'take', phrase: 'the bus', ru: 'поехать на автобусе' },
  { verb: 'take', phrase: 'care of', ru: 'заботиться о' },
  { verb: 'take', phrase: 'your time', ru: 'не торопиться' },
  { verb: 'take', phrase: 'a deep breath', ru: 'сделать глубокий вдох' },
  { verb: 'take', phrase: 'action', ru: 'принять меры' },
  { verb: 'take', phrase: 'turns', ru: 'делать по очереди' },
  { verb: 'take', phrase: 'the stairs', ru: 'пойти по лестнице' },
  { verb: 'take', phrase: 'sides', ru: 'принимать чью-то сторону' },
  { verb: 'have', phrase: 'fun', ru: 'веселиться' },
  { verb: 'have', phrase: 'a word with', ru: 'поговорить с' },
  { verb: 'have', phrase: 'a good time', ru: 'хорошо провести время' },
  { verb: 'have', phrase: 'a baby', ru: 'родить ребёнка' },
  { verb: 'have', phrase: 'a dream', ru: 'видеть сон' },
  { verb: 'have', phrase: 'a headache', ru: 'болит голова' },
  { verb: 'have', phrase: 'a cold', ru: 'быть простуженным' },
  { verb: 'have', phrase: 'a chat', ru: 'поболтать' },
  { verb: 'have', phrase: 'a conversation', ru: 'побеседовать' },
  { verb: 'have', phrase: 'an idea', ru: 'есть идея' },
  { verb: 'have', phrase: 'a nice day', ru: 'хорошего дня' },
  { verb: 'have', phrase: 'second thoughts', ru: 'засомневаться' },
  { verb: 'have', phrase: 'an accident', ru: 'попасть в аварию' },
  { verb: 'have', phrase: 'a feeling that', ru: 'чувствовать, что' },
];

/**
 * Phrases where two of the four verbs are natural, so they never become a
 * card, even when they come from the learner's library.
 */
export const AMBIGUOUS_PHRASES = new Set(
  [
    'a shower', 'a bath', 'a break', 'a look', 'a rest', 'a nap', 'a walk', 'a swim', 'a seat', 'a go', 'a try', 'a guess',
    'a drink', 'a bite', 'a sip', 'a taste', 'a moment', 'a minute', 'a trip', 'a holiday', 'a vacation', 'a day off',
    'a lesson', 'a class', 'a course', 'an exam', 'a test', 'a decision', 'notes', 'exercise', 'homework', 'your homework',
    'friends', 'money', 'a fortune', 'an excuse', 'a suggestion', 'a complaint', 'an appointment', 'a choice', 'plans',
    'a plan', 'a phone call', 'a call', 'a message', 'an offer', 'a profit', 'a speech', 'a joke', 'a comment', 'a list',
    'an announcement', 'a reservation', 'a booking', 'a cake', 'lunch', 'breakfast', 'dinner', 'a snack', 'a coffee',
    'a party', 'a meeting', 'a job interview', 'an interview', 'a job', 'a good job', 'damage', 'yoga', 'nothing',
    'medicine', 'your medicine', 'a temperature', 'an argument', 'a point', 'a chance', 'responsibility',
    'responsibility for', 'it easy', 'trouble', 'patience', 'a haircut', 'a picture',
  ].map(normalize),
);

export interface SorterCard {
  id: string;
  verb: LightVerb;
  /** What follows the verb: "a mistake", "someone's side". */
  phrase: string;
  translation: string;
  /** The library item behind the card, if any (games log activity for it). */
  itemId?: string;
}

const SLOT_WORDS: Record<string, string> = {
  sb: 'someone',
  somebody: 'someone',
  someone: 'someone',
  sth: 'it',
  something: 'it',
  "sb's": "someone's",
  "somebody's": "someone's",
  "someone's": "someone's",
  "one's": 'your',
};

/** "take sb's side" -> { verb: 'take', phrase: "someone's side" }; null when the term doesn't start with a light verb. */
export function splitLightVerb(term: string): { verb: LightVerb; phrase: string } | null {
  if (/[/()?!]/.test(term)) return null;
  const words = term.trim().split(/\s+/);
  const verb = words[0]?.toLowerCase() as LightVerb;
  if (!LIGHT_VERBS.includes(verb)) return null;
  const rest = words.slice(1);
  // A trailing slot adds nothing: "take part in sth" -> "part in".
  while (rest.length && SLOT_WORDS[rest[rest.length - 1].toLowerCase()]) rest.pop();
  const phrase = rest.map((w) => SLOT_WORDS[w.toLowerCase()] ?? w).join(' ');
  return phrase ? { verb, phrase } : null;
}

export function isAmbiguousPhrase(phrase: string): boolean {
  return AMBIGUOUS_PHRASES.has(normalize(phrase));
}

/**
 * Cards for the make/do/take/have sorter: the learner's own collocations
 * first, topped up from the built-in list with the verbs kept balanced.
 * `all` is used to link a built-in card to a library item with the same term.
 */
export function sorterCards(pool: Item[], all: Item[] = [], count = 12, rand: Rand = Math.random): SorterCard[] {
  const seen = new Set<string>();
  const cards: SorterCard[] = [];
  for (const item of shuffle(pool, rand)) {
    if (cards.length >= count) break;
    if (item.suspended || item.type === 'phrasal-verb') continue;
    const split = splitLightVerb(item.term);
    if (!split || isAmbiguousPhrase(split.phrase)) continue;
    const key = normalize(split.phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ id: item.id, verb: split.verb, phrase: split.phrase, translation: item.translation, itemId: item.id });
  }

  const byTerm = new Map(all.filter((i) => !i.suspended).map((i) => [normalize(i.term), i.id]));
  const left = new Map<LightVerb, VerbPhrase[]>(LIGHT_VERBS.map((v) => [v, shuffle(VERB_PHRASES.filter((p) => p.verb === v && !seen.has(normalize(p.phrase))), rand)]));
  const counts = new Map<LightVerb, number>(LIGHT_VERBS.map((v) => [v, cards.filter((c) => c.verb === v).length]));
  while (cards.length < count) {
    const open = LIGHT_VERBS.filter((v) => left.get(v)!.length);
    if (!open.length) break;
    const least = Math.min(...open.map((v) => counts.get(v)!));
    const verb = pick(
      open.filter((v) => counts.get(v) === least),
      rand,
    );
    const p = left.get(verb)!.pop()!;
    counts.set(verb, least + 1);
    cards.push({
      id: `builtin:${p.verb} ${p.phrase}`,
      verb: p.verb,
      phrase: p.phrase,
      translation: p.ru,
      itemId: byTerm.get(normalize(`${p.verb} ${p.phrase}`)),
    });
  }
  return shuffle(cards, rand);
}

/* ================= tokens ================= */

export interface Span {
  text: string;
  start: number;
  end: number;
}

const HAS_WORD = /[\p{L}\p{N}]/u;

/**
 * Splits a sentence into word tiles, punctuation kept attached ("Friday.").
 * A dash or other punctuation-only piece is glued to the word before it.
 */
export function tokenSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const span = { text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
    const prev = out[out.length - 1];
    if (prev && (!HAS_WORD.test(span.text) || !HAS_WORD.test(prev.text))) {
      out[out.length - 1] = { text: `${prev.text} ${span.text}`, start: prev.start, end: span.end };
    } else out.push(span);
  }
  return out;
}

export function tokenize(text: string): string[] {
  return tokenSpans(text).map((s) => s.text);
}

/* ================= sentences with a typical mistake ================= */

export interface WrongSentence {
  before: string;
  /** The bracketed target as in the example. */
  right: string;
  /** The wrong form put in its place. */
  wrong: string;
  after: string;
  /** The sentence with the wrong form. */
  sentence: string;
  /** The original sentence, brackets removed. */
  rightSentence: string;
}

const BRACKET = /^(.*?)\[([^\]]+)\](.*)$/s;

/**
 * "I [made a mistake] in the report." + "did a mistake" ->
 * "I did a mistake in the report." Keeps the capital letter at the start of a
 * sentence. Null without brackets or when the wrong form is the right one.
 */
export function withWrongForm(example: string, wrong: string): WrongSentence | null {
  const m = example.match(BRACKET);
  if (!m) return null;
  const before = m[1];
  const after = plainExample(m[3]);
  const right = m[2].trim();
  let w = wrong.trim().replace(/\s+/g, ' ');
  if (!w || !right || normalize(w) === normalize(right)) return null;
  if (/^\p{Lu}/u.test(right) && /^\p{Ll}/u.test(w)) w = w[0].toUpperCase() + w.slice(1);
  else if (/^\p{Ll}/u.test(right) && /^\p{Lu}/u.test(w) && !/^I\b/.test(w)) w = w[0].toLowerCase() + w.slice(1);
  return { before, right, wrong: w, after, sentence: before + w + after, rightSentence: before + right + after };
}

/** item.wrong entries that can be swapped into the item's example. */
export function usableWrongs(item: Item): string[] {
  return (item.wrong ?? []).filter((w) => withWrongForm(item.example, w));
}

export function mistakeItems(items: Item[]): Item[] {
  return items.filter((i) => !i.suspended && usableWrongs(i).length > 0);
}

export interface WordToken {
  text: string;
  /** Part of the target phrase (right or wrong). */
  target: boolean;
  /** Tapping it finds the mistake. */
  hot: boolean;
}

const overlaps = (s: Span, a: number, b: number) => s.start < b && s.end > a;

/**
 * Word tiles for "Find the mistake". The hot words are the ones that differ
 * from the right phrase ("did" in "did a mistake"); when a word is missing
 * ("listen podcasts"), the words on both sides of the gap are hot.
 */
export function mistakeTokens(w: WrongSentence): WordToken[] {
  const start = w.before.length;
  const end = start + w.wrong.length;
  const spans = tokenSpans(w.sentence);
  const wrongWords = [...w.wrong.matchAll(/\S+/g)].map((m) => ({
    key: normalize(m[0]),
    start: start + (m.index ?? 0),
    end: start + (m.index ?? 0) + m[0].length,
  }));
  const rightWords = w.right.split(/\s+/).filter(Boolean).map(normalize);
  let p = 0;
  while (p < wrongWords.length && p < rightWords.length && wrongWords[p].key === rightWords[p]) p++;
  let s = 0;
  while (
    s < wrongWords.length - p &&
    s < rightWords.length - p &&
    wrongWords[wrongWords.length - 1 - s].key === rightWords[rightWords.length - 1 - s]
  )
    s++;
  const changed = wrongWords.slice(p, wrongWords.length - s);
  const tokens = spans.map((sp) => ({
    text: sp.text,
    target: overlaps(sp, start, end),
    hot: changed.some((c) => overlaps(sp, c.start, c.end)),
  }));
  if (!changed.length) {
    const first = tokens.findIndex((t) => t.target);
    const last = tokens.length - 1 - [...tokens].reverse().findIndex((t) => t.target);
    const leftWord = wrongWords[p - 1];
    const rightWord = wrongWords[p];
    spans.forEach((sp, i) => {
      if (leftWord ? overlaps(sp, leftWord.start, leftWord.end) : i === first - 1) tokens[i].hot = true;
      if (rightWord ? overlaps(sp, rightWord.start, rightWord.end) : i === last + 1) tokens[i].hot = true;
    });
  }
  return tokens;
}

/** Tiles for a sentence without a mistake; the target words are marked, none is hot. */
export function cleanTokens(example: string): WordToken[] {
  const m = example.match(BRACKET);
  const text = plainExample(example);
  const start = m ? m[1].length : -1;
  const end = m ? start + m[2].length : -1;
  return tokenSpans(text).map((sp) => ({ text: sp.text, target: m ? overlaps(sp, start, end) : false, hot: false }));
}

export interface MistakeRound {
  id: string;
  item: Item;
  hasMistake: boolean;
  tokens: WordToken[];
  before: string;
  right: string;
  /** Null when the sentence is correct. */
  wrong: string | null;
  after: string;
}

/** Share of "Find the mistake" rounds with a correct sentence. */
export const CLEAN_SHARE = 0.3;

export function buildMistakeRounds(items: Item[], count = 10, rand: Rand = Math.random): MistakeRound[] {
  const eligible = shuffle(mistakeItems(items), rand).slice(0, count);
  const clean = Math.round(eligible.length * CLEAN_SHARE);
  const rounds = eligible.map((item, k): MistakeRound => {
    const w = withWrongForm(item.example, pick(usableWrongs(item), rand))!;
    if (k < clean) {
      return { id: `${item.id}-ok`, item, hasMistake: false, tokens: cleanTokens(item.example), before: w.before, right: w.right, wrong: null, after: w.after };
    }
    return { id: `${item.id}-x`, item, hasMistake: true, tokens: mistakeTokens(w), before: w.before, right: w.right, wrong: w.wrong, after: w.after };
  });
  const out = shuffle(rounds, rand);
  // Open with a real mistake so the first screen explains the game.
  const firstWrong = out.findIndex((r) => r.hasMistake);
  if (firstWrong > 0) [out[0], out[firstWrong]] = [out[firstWrong], out[0]];
  return out;
}

/** A tap on token `index` (or "No mistake" when index is null) is right? */
export function isRightTap(round: Pick<MistakeRound, 'hasMistake' | 'tokens'>, index: number | null): boolean {
  if (index === null) return !round.hasMistake;
  return round.hasMistake && !!round.tokens[index]?.hot;
}

/* ================= build the sentence ================= */

/** Longest example (in words) used for "Build the sentence". */
export const MAX_BUILD_WORDS = 12;

export function sentenceTokens(example: string): string[] {
  return tokenize(plainExample(example));
}

export function buildItems(items: Item[]): Item[] {
  return items.filter((i) => {
    if (i.suspended || !i.exampleRu?.trim() || !i.example?.trim()) return false;
    const n = sentenceTokens(i.example).length;
    return n >= 3 && n <= MAX_BUILD_WORDS;
  });
}

export interface Tile {
  id: string;
  text: string;
}

export interface BuildRound {
  id: string;
  item: Item;
  /** The Russian sentence to translate. */
  prompt: string;
  /** The English sentence, brackets removed. */
  answer: string;
  tiles: Tile[];
  /** How many tiles are extra. */
  distractors: number;
}

const wordKey = (w: string) => normalize(w);

/** 0–2 extra tiles: words from the typical mistakes that are not in the sentence ("did" for "made"). */
export function distractorWords(item: Item, words: string[], max = 2, rand: Rand = Math.random): string[] {
  const inSentence = new Set(words.map(wordKey));
  const candidates = [
    ...new Set(
      (item.wrong ?? [])
        .flatMap((w) => w.split(/\s+/))
        .map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''))
        .filter((w) => HAS_WORD.test(w) && !inSentence.has(wordKey(w))),
    ),
  ];
  return shuffle(candidates, rand).slice(0, max);
}

export function buildRound(item: Item, rand: Rand = Math.random): BuildRound {
  const answer = plainExample(item.example).trim();
  const words = tokenize(answer);
  const extra = distractorWords(item, words, 2, rand);
  const tiles = [...words, ...extra].map((text, i) => ({ id: `${item.id}-${i}`, text }));
  let mixed = shuffle(tiles, rand);
  // Never hand over the tiles already in order.
  for (let k = 0; k < 5 && mixed.length > 1 && sameSentence(mixed.slice(0, words.length).map((t) => t.text).join(' '), answer); k++) {
    mixed = shuffle(tiles, rand);
  }
  return { id: item.id, item, prompt: item.exampleRu.trim(), answer, tiles: mixed, distractors: extra.length };
}

export function buildRounds(items: Item[], count = 8, rand: Rand = Math.random): BuildRound[] {
  return shuffle(buildItems(items), rand)
    .slice(0, count)
    .map((i) => buildRound(i, rand));
}

/** Compares two sentences ignoring case, spacing, curly quotes and the final punctuation. */
export function sameSentence(a: string, b: string): boolean {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[\s.!?…"')\]]+$/u, '');
  return clean(a) === clean(b);
}

/* ================= natural or not? (blitz) ================= */

export interface Statement {
  id: string;
  item: Item;
  /** What the learner sees. */
  text: string;
  natural: boolean;
  /** The natural version. */
  right: string;
}

function statement(item: Item, natural: boolean, rand: Rand, round: number): Statement {
  const w = withWrongForm(item.example, pick(usableWrongs(item), rand))!;
  return natural
    ? { id: `${item.id}-n${round}`, item, text: w.rightSentence, natural, right: w.rightSentence }
    : { id: `${item.id}-x${round}`, item, text: w.sentence, natural, right: w.rightSentence };
}

/**
 * A deck of sentences for the blitz, half natural and half with a typical
 * mistake. Every word appears once, then once more the other way round.
 */
export function blitzDeck(items: Item[], rand: Rand = Math.random, round = 0): Statement[] {
  const eligible = shuffle(mistakeItems(items), rand);
  const first = shuffle(
    eligible.map((item, k) => statement(item, k % 2 === 0, rand, round)),
    rand,
  );
  const second = shuffle(
    eligible.map((item, k) => statement(item, k % 2 === 1, rand, round)),
    rand,
  );
  if (first.length > 1 && second.length && second[0].item.id === first[first.length - 1].item.id) {
    [second[0], second[second.length - 1]] = [second[second.length - 1], second[0]];
  }
  return [...first, ...second];
}

/* ================= role-play ================= */

/**
 * 3–5 phrases to try in a role-play: the learner's started words, preferring
 * ones tagged like the scenario, then levels 2–4 (known, but not yet used).
 */
export function pickTargets(items: Item[], tags: string[], count = 4, rand: Rand = Math.random): Item[] {
  const active = items.filter((i) => !i.suspended && i.term.trim());
  const started = active.filter((i) => i.level > 0);
  const base = started.length >= 3 ? started : active;
  const want = new Set(tags);
  const scored = shuffle(base, rand).map((i) => ({
    i,
    s: (i.tags.some((t) => want.has(t)) ? 2 : 0) + (i.level >= 2 && i.level <= 4 ? 1 : 0),
  }));
  scored.sort((a, b) => b.s - a.s);
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const { i } of scored) {
    const key = normalize(i.term);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
    if (out.length === count) break;
  }
  return out;
}

/** Ids of the targets used in any of the replies. */
export function usedTargets(replies: string[], targets: Item[]): Set<string> {
  return new Set(targets.filter((t) => replies.some((r) => sentenceUsesTerm(r, t.term))).map((t) => t.id));
}

/** For each target, the first reply that uses it: what "Save to my sentences" stores. */
export function repliesToSave(replies: string[], targets: Item[]): { item: Item; text: string }[] {
  const out: { item: Item; text: string }[] = [];
  for (const t of targets) {
    const text = replies.find((r) => sentenceUsesTerm(r, t.term));
    if (text) out.push({ item: t, text: text.trim() });
  }
  return out;
}

export interface ChatLine {
  who: 'partner' | 'me';
  text: string;
}

/** A prompt to paste into Claude or Gemini to get the replies corrected. */
export function aiCheckPrompt(
  scenario: { title: string; setting: string; partner: string },
  targets: Pick<Item, 'term'>[],
  transcript: ChatLine[],
): string {
  const intro =
    "I'm learning English (B2). Please correct my replies in this role-play. For each reply give the corrected version and one short tip. Keep my style." +
    (targets.length ? ` Target phrases: ${targets.map((t) => t.term).join(', ')}.` : '');
  const lines = transcript.map((l) => `${l.who === 'me' ? 'Me' : scenario.partner}: ${l.text.trim()}`);
  return [intro, '', `Role-play: ${scenario.title}. ${scenario.setting}`, '', ...lines].join('\n');
}
