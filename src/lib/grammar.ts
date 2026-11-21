import { normalize, levenshtein } from './check';
import { db, newId, useLive } from './db';
import { addDays } from './dates';

/**
 * Grammar lessons: one topic per lesson, built the way research and teachers
 * agree grammar is learned best (see docs/GRAMMAR.md):
 *
 *   read a short text → notice the form → short rule card with Russian traps →
 *   controlled practice → use it yourself → exit check → spaced reviews.
 *
 * Lessons are plain JSON, so the built-in ones and the ones the AI writes from
 * a topic share one format. Lessons the AI wrote and all progress live in kv
 * 'grammar' (in backups and sync).
 */

/* ---------- the lesson format ---------- */

export interface GExample {
  /** English; the target form is wrapped in [square brackets]. */
  en: string;
  ru: string;
}

/** One rule point: form, meaning and use, explained briefly in Russian. */
export interface GPoint {
  title: string;
  /** The form, e.g. "as if + past simple (knew, were)". */
  form: string;
  /** What it means and when to use it, in Russian; one to three sentences. */
  ru: string;
  examples: GExample[];
}

/** A typical mistake of a Russian speaker. */
export interface GTrap {
  wrong: string;
  right: string;
  /** Why, in Russian. */
  why: string;
}

interface Base {
  id: string;
  /** Which rule point it practises (index into points), when known. */
  point?: number;
  /** Why the answer is right, in Russian: shown after every answer. */
  why: string;
}

/** Pick one option. Also used for meaning questions ("Is he really ill?"). */
export interface GChoice extends Base {
  kind: 'choice';
  q: string;
  options: string[];
  answer: number;
}

/** Fill the gap ___ in q; `hint` is the word in brackets, e.g. "know". */
export interface GGap extends Base {
  kind: 'gap';
  q: string;
  hint?: string;
  answers: string[];
}

/** Rewrite a sentence: `q` is the task with the sentence, `start` the given beginning of the answer. */
export interface GTransform extends Base {
  kind: 'transform';
  q: string;
  start?: string;
  answers: string[];
}

/** Is the sentence right? If not, type it correctly. */
export interface GFix extends Base {
  kind: 'fix';
  q: string;
  correct: boolean;
  /** The corrected sentence(s); empty when the sentence is already right. */
  answers: string[];
}

/** Translate a Russian sentence. */
export interface GTranslate extends Base {
  kind: 'translate';
  q: string;
  answers: string[];
}

/** Free writing about yourself: the AI checks it, or you compare with a model answer. */
export interface GWrite extends Base {
  kind: 'write';
  q: string;
  model: string;
}

export type GExercise = GChoice | GGap | GTransform | GFix | GTranslate | GWrite;
export type TypedExercise = GGap | GTransform | GFix | GTranslate;

export interface GrammarLesson {
  id: string;
  title: string;
  /** One line in Russian: what the lesson is for. */
  subtitle: string;
  level: string;
  source: 'builtin' | 'ai';
  /** The topic the learner typed (AI lessons). */
  topic?: string;
  createdAt: number;
  /** A short dialogue or text with the targets in [brackets]. */
  text: string;
  /** A question about what the text means, before any rule. */
  gist: GChoice;
  /** Guided discovery: questions about the highlighted forms. */
  notice: GChoice[];
  points: GPoint[];
  traps: GTrap[];
  practice: GExercise[];
  /** Translate and write about yourself. */
  produce: GExercise[];
  /** Exit check: new sentences, no hints. */
  check: GExercise[];
  /** Extra items only for the spaced reviews, so reviews aren't the lesson again. */
  review: GExercise[];
  /** Three to five lines to remember. */
  summary: string[];
}

/* ---------- validation (the AI's JSON is checked before it becomes a lesson) ---------- */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const GAP = /_{2,}/;

function toExercise(raw: unknown, id: string): GExercise | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const q = str(r.q);
  const why = str(r.why);
  const point = typeof r.point === 'number' && r.point >= 0 ? Math.floor(r.point) : undefined;
  const base = { id: str(r.id) || id, why, ...(point !== undefined ? { point } : {}) };
  if (!q) return null;
  switch (r.kind) {
    case 'choice': {
      const options = strs(r.options);
      const answer = typeof r.answer === 'number' ? r.answer : options.indexOf(str(r.answer));
      if (options.length < 2 || answer < 0 || answer >= options.length || new Set(options).size !== options.length) return null;
      return { kind: 'choice', ...base, q, options, answer };
    }
    case 'gap': {
      const answers = strs(r.answers);
      if (!GAP.test(q) || !answers.length) return null;
      return { kind: 'gap', ...base, q, answers, ...(str(r.hint) ? { hint: str(r.hint) } : {}) };
    }
    case 'transform': {
      const answers = strs(r.answers);
      if (!answers.length) return null;
      return { kind: 'transform', ...base, q, answers, ...(str(r.start) ? { start: str(r.start) } : {}) };
    }
    case 'fix': {
      const correct = r.correct === true;
      const answers = strs(r.answers);
      if (!correct && !answers.length) return null;
      return { kind: 'fix', ...base, q, correct, answers: correct ? [] : answers };
    }
    case 'translate': {
      const answers = strs(r.answers);
      if (!answers.length) return null;
      return { kind: 'translate', ...base, q, answers };
    }
    case 'write': {
      const model = str(r.model);
      if (!model) return null;
      return { kind: 'write', ...base, q, model };
    }
  }
  return null;
}

function exercises(raw: unknown, prefix: string): GExercise[] {
  return (Array.isArray(raw) ? raw : []).map((r, i) => toExercise(r, `${prefix}${i + 1}`)).filter((e): e is GExercise => !!e);
}

function examples(raw: unknown): GExample[] {
  return (Array.isArray(raw) ? raw : [])
    .map((e) => ({ en: str((e as GExample)?.en), ru: str((e as GExample)?.ru) }))
    .filter((e) => e.en);
}

/** Checks and cleans a lesson; null when too much is missing to learn from it. */
export function toLesson(raw: unknown, meta: Partial<GrammarLesson> = {}): GrammarLesson | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const gist = toExercise({ ...(r.gist as object), kind: 'choice' }, 'g1');
  const points: GPoint[] = (Array.isArray(r.points) ? r.points : [])
    .map((p: Record<string, unknown>) => ({ title: str(p?.title), form: str(p?.form), ru: str(p?.ru), examples: examples(p?.examples) }))
    .filter((p) => p.title && (p.ru || p.form));
  const traps: GTrap[] = (Array.isArray(r.traps) ? r.traps : [])
    .map((t: Record<string, unknown>) => ({ wrong: str(t?.wrong), right: str(t?.right), why: str(t?.why) }))
    .filter((t) => t.wrong && t.right);
  const lesson: GrammarLesson = {
    // The AI never picks the id: a lesson it writes must not replace another one.
    id: meta.id || (meta.source === 'ai' ? `ai-${newId()}` : str(r.id)) || `ai-${newId()}`,
    title: str(r.title) || meta.title || '',
    subtitle: str(r.subtitle),
    level: str(r.level) || 'B2',
    source: meta.source ?? (r.source === 'builtin' ? 'builtin' : 'ai'),
    ...(meta.topic || str(r.topic) ? { topic: meta.topic || str(r.topic) } : {}),
    createdAt: meta.createdAt ?? (typeof r.createdAt === 'number' ? r.createdAt : Date.now()),
    text: str(r.text),
    gist: (gist as GChoice) ?? null,
    notice: exercises((Array.isArray(r.notice) ? r.notice : []).map((n) => ({ kind: 'choice', ...n })), 'n').filter((e): e is GChoice => e.kind === 'choice'),
    points,
    traps,
    practice: exercises(r.practice, 'p'),
    produce: exercises(r.produce, 'u'),
    check: exercises(r.check, 'c'),
    review: exercises(r.review, 'r'),
    summary: strs(r.summary),
  };
  if (!lesson.title || !lesson.text || !lesson.gist || !points.length || lesson.practice.length < 4 || lesson.check.length < 3) return null;
  return lesson;
}

/* ---------- checking typed answers ---------- */

const CONTRACTIONS: [RegExp, string][] = [
  [/\bcan't\b/g, 'can not'],
  [/\bcannot\b/g, 'can not'],
  [/\bwon't\b/g, 'will not'],
  [/\bshan't\b/g, 'shall not'],
  [/\bain't\b/g, 'is not'],
  [/n't\b/g, ' not'],
  [/'re\b/g, ' are'],
  [/'ve\b/g, ' have'],
  [/'ll\b/g, ' will'],
  [/'m\b/g, ' am'],
  [/\b(it|he|she|that|there|what|who|here|where|how|this)'s\b/g, '$1 is'],
];

/** Lowercase, no punctuation, contractions spelled out, "as though" = "as if". */
export function grammarKey(text: string): string {
  let t = normalize(text);
  for (const [re, to] of CONTRACTIONS) t = t.replace(re, to);
  return t.replace(/\bas though\b/g, 'as if').replace(/\s+/g, ' ').trim();
}

/** "'d" is "had" or "would": both readings count. */
function readings(text: string): string[] {
  const k = grammarKey(text);
  if (!/'d\b/.test(k)) return [k];
  return [k.replace(/'d\b/g, ' had'), k.replace(/'d\b/g, ' would')].map((s) => s.replace(/\s+/g, ' '));
}

/** Small words where one letter changes the grammar: never a "typo". */
const GRAMMAR_WORDS = new Set(['was', 'were', 'is', 'are', 'had', 'has', 'have', 'did', 'does', 'do', 'been', 'being', 'be', 'if', 'as', 'like', 'that', 'what', 'who', 'which', 'it', 'would', 'will', 'could', 'can']);

function typoOnly(a: string, b: string): boolean {
  const x = a.split(' ');
  const y = b.split(' ');
  if (x.length !== y.length) return false;
  let typos = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    if (GRAMMAR_WORDS.has(y[i]) || y[i].length < 5 || levenshtein(x[i], y[i]) > 1) return false;
    // The ending carries the grammar: "knew"/"known", "seen"/"saw" are not typos.
    if (x[i].slice(-2) !== y[i].slice(-2)) return false;
    typos++;
  }
  return typos > 0 && typos <= 2;
}

export type GVerdict = 'correct' | 'almost' | 'wrong';

/** All the full answers an exercise accepts, as typed by the learner. */
export function expectedAnswers(ex: TypedExercise): string[] {
  if (ex.kind === 'gap') {
    // The learner may type just the gap or the whole sentence.
    return [...ex.answers, ...ex.answers.map((a) => ex.q.replace(GAP, a))];
  }
  if (ex.kind === 'transform' && ex.start) {
    // The beginning is given: typing it again is fine too.
    return [...ex.answers, ...ex.answers.map((a) => (grammarKey(a).startsWith(grammarKey(ex.start!)) ? a.slice(ex.start!.length).trim() : a))];
  }
  return ex.answers;
}

export function gradeTyped(input: string, ex: TypedExercise): GVerdict {
  const typed = readings(input);
  if (!typed[0]) return 'wrong';
  const wanted = expectedAnswers(ex).flatMap(readings);
  if (typed.some((t) => wanted.includes(t))) return 'correct';
  if (typed.some((t) => wanted.some((w) => typoOnly(t, w)))) return 'almost';
  return 'wrong';
}

/** The answer to show: for a gap, the whole sentence with the gap filled. */
export function shownAnswer(ex: GExercise): string {
  switch (ex.kind) {
    case 'choice':
      // "My boss treats me as if I ___ a child." → the whole sentence, not just "were".
      return GAP.test(ex.q) ? ex.q.replace(GAP, ex.options[ex.answer]) : ex.options[ex.answer];
    case 'gap':
      return ex.q.replace(GAP, ex.answers[0]);
    case 'fix':
      return ex.correct ? ex.q : ex.answers[0];
    case 'write':
      return ex.model;
    default:
      return ex.answers[0];
  }
}

/* ---------- progress and spaced reviews ---------- */

/** Days between reviews after each good one. */
export const G_LADDER = [1, 3, 7, 14, 30, 60];
export const REVIEW_SIZE = 6;

export interface GrammarProgress {
  updatedAt: number;
  startedAt: number;
  /** Where to continue an unfinished lesson: index of the step. */
  step?: number;
  doneAt?: number;
  /** Exit check, 0..1. */
  score?: number;
  /** Position on G_LADDER. */
  rung: number;
  /** When the next review is due (ms). */
  due?: number;
  reviews: { at: number; score: number }[];
  /** Exercise ids answered wrong the last time, asked first in the next review. */
  missed: string[];
  /** Exercise ids by when they were last asked, so reviews rotate. */
  seen: Record<string, number>;
  /** Exercises the learner reported as wrong: never asked again. */
  bad?: string[];
}

export interface GrammarStore {
  lessons: GrammarLesson[];
  progress: Record<string, GrammarProgress>;
  /** Ids of AI lessons deleted on purpose, so sync doesn't bring them back. */
  deleted: string[];
}

const EMPTY: GrammarStore = { lessons: [], progress: {}, deleted: [] };

export async function getGrammar(): Promise<GrammarStore> {
  const v = (await db.kv.get('grammar'))?.value as Partial<GrammarStore> | undefined;
  return { ...EMPTY, ...v, lessons: v?.lessons ?? [], progress: v?.progress ?? {}, deleted: v?.deleted ?? [] };
}

export async function setGrammar(store: GrammarStore) {
  await db.kv.put({ key: 'grammar', value: store });
}

export function useGrammar(): GrammarStore | null {
  return useLive(getGrammar, [], null);
}

export async function saveLesson(lesson: GrammarLesson) {
  const g = await getGrammar();
  await setGrammar({ ...g, lessons: [...g.lessons.filter((l) => l.id !== lesson.id), lesson], deleted: g.deleted.filter((d) => d !== lesson.id) });
}

export async function deleteLesson(id: string) {
  const g = await getGrammar();
  const progress = { ...g.progress };
  delete progress[id];
  await setGrammar({ lessons: g.lessons.filter((l) => l.id !== id), progress, deleted: [...new Set([...g.deleted, id])] });
}

export function freshProgress(now = Date.now()): GrammarProgress {
  return { updatedAt: now, startedAt: now, rung: 0, reviews: [], missed: [], seen: {} };
}

export async function updateProgress(id: string, fn: (p: GrammarProgress) => GrammarProgress) {
  const g = await getGrammar();
  const next = fn(g.progress[id] ?? freshProgress());
  await setGrammar({ ...g, progress: { ...g.progress, [id]: { ...next, updatedAt: Date.now() } } });
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** First review the next day; then up the ladder after ≥80%, back to the start below 60%. */
export function afterReview(p: GrammarProgress, score: number, now = Date.now()): GrammarProgress {
  const rung = score >= 0.8 ? Math.min(p.rung + 1, G_LADDER.length - 1) : score < 0.6 ? 0 : p.rung;
  return { ...p, rung, due: startOfDay(addDays(new Date(now), G_LADDER[rung]).getTime()), reviews: [...p.reviews, { at: now, score }] };
}

/** After the lesson's exit check: review tomorrow (or again soon if it went badly). */
export function afterLesson(p: GrammarProgress, score: number, missed: string[], now = Date.now()): GrammarProgress {
  return { ...p, doneAt: p.doneAt ?? now, score, step: undefined, rung: 0, missed, due: startOfDay(addDays(new Date(now), 1).getTime()) };
}

export function isDue(p: GrammarProgress | undefined, now = Date.now()): boolean {
  return !!p?.doneAt && !!p.due && p.due <= now;
}

/** Everything a review may ask: practice, check and the review pool (not the meaning questions). */
export function reviewPool(lesson: GrammarLesson, bad: string[] = []): GExercise[] {
  const skip = new Set(bad);
  return [...lesson.review, ...lesson.check, ...lesson.practice, ...lesson.produce.filter((e) => e.kind !== 'write')].filter((e) => !skip.has(e.id));
}

export type Rand = () => number;

function shuffle<T>(list: T[], rand: Rand): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ReviewItem {
  lessonId: string;
  ex: GExercise;
}

/**
 * A review: last time's mistakes first, then what was asked least recently,
 * one item from another finished lesson mixed in (so the form isn't guessed
 * from the title), and one free sentence from the third review on.
 */
export function buildReview(lesson: GrammarLesson, p: GrammarProgress, others: { lesson: GrammarLesson; p: GrammarProgress }[] = [], rand: Rand = Math.random, size = REVIEW_SIZE): ReviewItem[] {
  const pool = reviewPool(lesson, p.bad);
  const byId = new Map(pool.map((e) => [e.id, e]));
  const missed = p.missed.map((id) => byId.get(id)).filter((e): e is GExercise => !!e).slice(0, 2);
  const rest = shuffle(
    pool.filter((e) => !missed.includes(e)),
    rand,
  ).sort((a, b) => (p.seen[a.id] ?? 0) - (p.seen[b.id] ?? 0));
  const mine: GExercise[] = [...missed];
  const writes = lesson.produce.filter((e) => e.kind === 'write' && !p.bad?.includes(e.id));
  const wantWrite = p.reviews.length >= 2 && writes.length > 0;
  const other = others.filter((o) => o.lesson.id !== lesson.id && o.p.doneAt);
  const ownSlots = size - (other.length ? 1 : 0) - (wantWrite ? 1 : 0);
  for (const e of rest) {
    if (mine.length >= ownSlots) break;
    mine.push(e);
  }
  const items: ReviewItem[] = shuffle(mine, rand).map((ex) => ({ lessonId: lesson.id, ex }));
  if (other.length) {
    const o = other[Math.floor(rand() * other.length)];
    const pick = shuffle(reviewPool(o.lesson, o.p.bad), rand)[0];
    if (pick) items.splice(Math.floor(rand() * (items.length + 1)), 0, { lessonId: o.lesson.id, ex: pick });
  }
  if (wantWrite) items.push({ lessonId: lesson.id, ex: writes[Math.floor(rand() * writes.length)] });
  return items;
}

/* ---------- merging for sync ---------- */

export function mergeGrammar(a: GrammarStore | undefined, b: GrammarStore | undefined): GrammarStore {
  const x = a ?? EMPTY;
  const y = b ?? EMPTY;
  const deleted = [...new Set([...x.deleted, ...y.deleted])].sort();
  const gone = new Set(deleted);
  const lessons = new Map<string, GrammarLesson>();
  for (const l of [...y.lessons, ...x.lessons]) if (!gone.has(l.id) && !lessons.has(l.id)) lessons.set(l.id, l);
  const progress: Record<string, GrammarProgress> = {};
  for (const id of new Set([...Object.keys(x.progress), ...Object.keys(y.progress)])) {
    if (gone.has(id)) continue;
    const p = x.progress[id];
    const q = y.progress[id];
    progress[id] = !p ? q : !q ? p : p.updatedAt >= q.updatedAt ? p : q;
  }
  return { lessons: [...lessons.values()].sort((m, n) => m.createdAt - n.createdAt || (m.id < n.id ? -1 : 1)), progress, deleted };
}
