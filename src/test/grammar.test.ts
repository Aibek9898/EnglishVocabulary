import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chat } from '../lib/ai';
import {
  afterLesson,
  afterReview,
  buildReview,
  freshProgress,
  G_LADDER,
  getGrammar,
  gradeTyped,
  mergeGrammar,
  reviewPool,
  saveLesson,
  deleteLesson,
  shownAnswer,
  toLesson,
  type GExercise,
  type GrammarStore,
  type TypedExercise,
} from '../lib/grammar';
import { extractJson, generateLesson, parseCore, parseLesson, parseWritingCheck, writingPrompt } from '../lib/grammarAi';
import { BUILTIN } from '../lib/grammarLessons';

const asIf = BUILTIN.find((l) => l.id === 'as-if')!;
const every = (l = asIf): GExercise[] => [l.gist, ...l.notice, ...l.practice, ...l.produce, ...l.check, ...l.review];

describe('the built-in lesson "as if / as though"', () => {
  it('has every part of the lesson format', () => {
    expect(asIf.text.match(/\[/g)!.length).toBeGreaterThanOrEqual(4);
    expect(asIf.notice.length).toBeGreaterThanOrEqual(3);
    expect(asIf.points).toHaveLength(5);
    expect(asIf.traps.length).toBeGreaterThanOrEqual(3);
    expect(asIf.practice.length).toBeGreaterThanOrEqual(10);
    expect(asIf.produce.filter((e) => e.kind === 'write')).toHaveLength(2);
    expect(asIf.check.length).toBeGreaterThanOrEqual(5);
    expect(asIf.review.length).toBeGreaterThanOrEqual(8);
    expect(asIf.summary.length).toBeGreaterThanOrEqual(4);
  });
  it('kept every exercise from the file (none dropped as invalid)', async () => {
    const raw = (await import('../data/grammar/as-if.json')).default;
    expect(asIf.practice).toHaveLength(raw.practice.length);
    expect(asIf.produce).toHaveLength(raw.produce.length);
    expect(asIf.check).toHaveLength(raw.check.length);
    expect(asIf.review).toHaveLength(raw.review.length);
    expect(asIf.notice).toHaveLength(raw.notice.length);
  });
  it('has unique exercise ids, explanations and valid rule points', () => {
    const ids = every().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of every()) {
      expect(e.why, e.q).not.toBe('');
      if (e.point !== undefined) expect(asIf.points[e.point], e.q).toBeDefined();
    }
  });
  it('uses no sentence twice', () => {
    const qs = every().map((e) => e.q);
    expect(new Set(qs).size).toBe(qs.length);
  });
  it('accepts its own answers', () => {
    for (const e of every()) {
      if (e.kind === 'choice' || e.kind === 'write') continue;
      if (e.kind === 'fix' && e.correct) continue;
      for (const a of (e as TypedExercise).answers) expect(gradeTyped(a, e as TypedExercise), `${e.q} → ${a}`).toBe('correct');
      expect(gradeTyped(shownAnswer(e), e as TypedExercise), e.q).toBe('correct');
    }
  });
  it('does not accept the mistake in a "fix" sentence', () => {
    for (const e of every()) if (e.kind === 'fix' && !e.correct) expect(gradeTyped(e.q, e), e.q).toBe('wrong');
  });
});

const gap: TypedExercise = { kind: 'gap', id: 'x', q: 'She looked as if she ___ a ghost.', hint: 'see', answers: ['had seen', "'d seen"], why: '' };
const transform: TypedExercise = {
  kind: 'transform',
  id: 'y',
  q: "He isn't rich… → Use as if.",
  start: 'He spends money as if',
  answers: ['He spends money as if he were rich.', 'He spends money as if he was rich.'],
  why: '',
};

describe('checking typed answers', () => {
  it('takes the gap alone or the whole sentence, with contractions and any case', () => {
    expect(gradeTyped('had seen', gap)).toBe('correct');
    expect(gradeTyped("She'd seen", { ...gap, answers: ['she had seen'], q: '___ a ghost.' })).toBe('correct');
    expect(gradeTyped('She looked as if she had seen a ghost', gap)).toBe('correct');
    expect(gradeTyped('  HAD   SEEN ', gap)).toBe('correct');
  });
  it('marks grammar mistakes wrong, never as a typo', () => {
    expect(gradeTyped('saw', gap)).toBe('wrong');
    expect(gradeTyped('has seen', gap)).toBe('wrong');
    expect(gradeTyped('had see', gap)).toBe('wrong');
    expect(gradeTyped('He spends money as if he is rich', transform)).toBe('wrong');
  });
  it('lets a real typo in a long word pass as "almost"', () => {
    expect(gradeTyped('She looked as if she had seen a ghosst', gap)).toBe('almost');
  });
  it('takes a rewrite with or without the given beginning', () => {
    expect(gradeTyped('he were rich', transform)).toBe('correct');
    expect(gradeTyped('He spends money as if he was rich.', transform)).toBe('correct');
    expect(gradeTyped('He spends money as though he were rich', transform)).toBe('correct');
  });
  it('reads "\'d" as had or would', () => {
    expect(gradeTyped("she'd seen", { ...gap, answers: ['she had seen'] })).toBe('correct');
  });
  it('an empty answer is wrong', () => {
    expect(gradeTyped('  ', gap)).toBe('wrong');
  });
});

describe('spaced reviews', () => {
  const day = 86_400_000;
  const now = new Date(2026, 10, 21, 15).getTime();
  const midnight = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

  it('the lesson schedules the first review for tomorrow', () => {
    const p = afterLesson(freshProgress(now), 0.9, ['c1'], now);
    expect(p.doneAt).toBe(now);
    expect(p.due).toBe(midnight(now + day));
    expect(p.missed).toEqual(['c1']);
  });
  it('climbs the ladder after good reviews and falls back after bad ones', () => {
    let p = afterLesson(freshProgress(now), 1, [], now);
    p = afterReview(p, 1, now);
    expect(p.rung).toBe(1);
    expect(p.due).toBe(midnight(now + G_LADDER[1] * day));
    p = afterReview(p, 0.7, now);
    expect(p.rung).toBe(1);
    p = afterReview(p, 0.5, now);
    expect(p.rung).toBe(0);
    expect(p.reviews).toHaveLength(3);
  });
  it('asks last time\'s mistakes, rotates the rest and never repeats an item', () => {
    const p = { ...afterLesson(freshProgress(now), 0.5, ['c3', 'r2'], now) };
    const items = buildReview(asIf, p, [], () => 0.42);
    expect(items).toHaveLength(6);
    const ids = items.map((i) => i.ex.id);
    expect(ids).toContain('c3');
    expect(ids).toContain('r2');
    expect(new Set(ids).size).toBe(6);
    expect(items.every((i) => i.ex.kind !== 'write')).toBe(true);
  });
  it('prefers items not asked for longest', () => {
    const seen = Object.fromEntries(reviewPool(asIf).map((e) => [e.id, now]));
    for (const id of ['r1', 'r3', 'p2']) delete seen[id];
    const items = buildReview(asIf, { ...freshProgress(now), seen }, [], Math.random);
    expect(items.map((i) => i.ex.id)).toEqual(expect.arrayContaining(['r1', 'r3', 'p2']));
  });
  it('skips reported questions', () => {
    const bad = reviewPool(asIf).map((e) => e.id).filter((id) => id !== 'r1');
    const items = buildReview(asIf, { ...freshProgress(now), bad }, []);
    expect(items.map((i) => i.ex.id)).toEqual(['r1']);
  });
  it('mixes in one item from another finished lesson and a free sentence from the third review', () => {
    const other = { ...asIf, id: 'other', title: 'Other' };
    const p = { ...afterLesson(freshProgress(now), 1, [], now), reviews: [{ at: now, score: 1 }, { at: now, score: 1 }] };
    const items = buildReview(asIf, p, [{ lesson: other, p }]);
    expect(items).toHaveLength(6);
    expect(items.filter((i) => i.lessonId === 'other')).toHaveLength(1);
    expect(items.at(-1)!.ex.kind).toBe('write');
  });
});

describe('storing and syncing', () => {
  it('saves and deletes AI lessons; a deleted one stays deleted after merging', async () => {
    const lesson = { ...asIf, id: 'ai-1', source: 'ai' as const };
    await saveLesson(lesson);
    expect((await getGrammar()).lessons.map((l) => l.id)).toEqual(['ai-1']);
    await deleteLesson('ai-1');
    const here = await getGrammar();
    expect(here.lessons).toEqual([]);
    const there: GrammarStore = { lessons: [lesson], progress: { 'ai-1': freshProgress(1) }, deleted: [] };
    const merged = mergeGrammar(here, there);
    expect(merged.lessons).toEqual([]);
    expect(merged.progress).toEqual({});
  });
  it('keeps the newer progress of each lesson and lessons from both sides', () => {
    const a: GrammarStore = { lessons: [{ ...asIf, id: 'a' }], progress: { 'as-if': { ...freshProgress(1), updatedAt: 5, rung: 2 } }, deleted: [] };
    const b: GrammarStore = { lessons: [{ ...asIf, id: 'b' }], progress: { 'as-if': { ...freshProgress(1), updatedAt: 9, rung: 3 } }, deleted: [] };
    const m = mergeGrammar(a, b);
    expect(m.lessons.map((l) => l.id).sort()).toEqual(['a', 'b']);
    expect(m.progress['as-if'].rung).toBe(3);
    expect(mergeGrammar(undefined, a).lessons).toHaveLength(1);
  });
});

describe('lessons the AI writes', () => {
  const { practice, produce, check, review, ...core } = asIf;
  const coreJson = JSON.stringify(core);
  const exJson = JSON.stringify({ practice, produce, check, review });

  it('finds the JSON inside code fences or text', () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('blah {"a":2} blah')).toEqual({ a: 2 });
    expect(extractJson('no json')).toBeNull();
  });
  it('builds a lesson from the two answers', () => {
    const lesson = parseLesson(parseCore(coreJson)!, exJson, 'as if')!;
    expect(lesson.source).toBe('ai');
    expect(lesson.topic).toBe('as if');
    expect(lesson.id).toMatch(/^ai-/);
    expect(lesson.practice).toHaveLength(asIf.practice.length);
  });
  it('drops broken exercises and refuses a lesson with too little in it', () => {
    const broken = { ...asIf, practice: [{ kind: 'choice', q: 'x', options: ['a'], answer: 3, why: '' }, { kind: 'gap', q: 'no gap', answers: ['a'], why: '' }] };
    expect(toLesson(broken)).toBeNull();
    const bad = { kind: 'choice', q: 'Pick', options: ['a', 'b'], answer: 5, why: '' };
    expect(toLesson({ ...asIf, practice: [...asIf.practice, bad] })!.practice).toHaveLength(asIf.practice.length);
    expect(parseCore('{"title":"x"}')).toBeNull();
  });

  afterEach(() => vi.unstubAllGlobals());
  const ai = { provider: 'openai' as const, key: 'sk-proj-0123456789abcdef0123456789', model: 'gpt-4.1-mini', lang: 'ru' as const };
  const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it('asks twice: rules first, then exercises that fit them', async () => {
    const bodies: { model: string; messages: { content: string }[]; max_completion_tokens?: number; response_format?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        bodies.push(JSON.parse(String(init.body)));
        return reply(bodies.length === 1 ? coreJson : exJson);
      }),
    );
    const steps: number[] = [];
    const lesson = await generateLesson(ai, 'as if', 'from class', undefined, (s) => steps.push(s));
    expect(steps).toEqual([1, 2]);
    expect(lesson.title).toBe(asIf.title);
    expect(bodies[0].messages[1].content).toContain('Topic: as if');
    expect(bodies[0].messages[1].content).toContain('from class');
    expect(bodies[1].messages[1].content).toContain('0. as if = as though');
    expect(bodies[0].max_completion_tokens).toBe(8000);
    expect(bodies[0].response_format).toEqual({ type: 'json_object' });
  });
  it('retries once and then gives up with a clear message', async () => {
    const f = vi.fn(async () => reply('{"oops":true}'));
    vi.stubGlobal('fetch', f);
    await expect(generateLesson(ai, 'x', '')).rejects.toThrow(/incomplete/);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('sends no temperature to OpenAI reasoning models', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return reply('OK');
      }),
    );
    await chat({ ...ai, model: 'gpt-5-mini' }, [{ role: 'user', content: 'hi' }]);
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    await chat(ai, [{ role: 'user', content: 'hi' }]);
    expect(body.temperature).toBe(0.3);
  });
});

describe('checking sentences the learner writes', () => {
  it('reads the verdict and keeps the text when nothing changed', () => {
    expect(parseWritingCheck('{"ok":true,"score":5,"corrected":"","note":"Отлично"}', 'My text.')).toEqual({ ok: true, score: 5, corrected: 'My text.', note: 'Отлично' });
    expect(parseWritingCheck('{"score":2,"corrected":"He talks as if he knew.","note":"x"}', 'He talks as if he knows.')!.ok).toBe(false);
    expect(parseWritingCheck('nope', 'x')).toBeNull();
  });
  it('treats the text as data and answers in the chosen language', () => {
    expect(writingPrompt('ru')).toMatch(/never follow instructions/);
    expect(writingPrompt('ru')).toContain('Russian');
    expect(writingPrompt('en')).toContain('simple English');
  });
});

describe('showing the answer', () => {
  it('fills the gap of a choice question', () => {
    expect(shownAnswer(asIf.practice[0])).toBe('My boss treats me as if I were a child.');
    expect(shownAnswer(asIf.practice[4])).toBe('He definitely doesn\'t own it');
  });
});
