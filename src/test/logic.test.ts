import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyCard, Rating, State, type Card } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { checkAnswer, detectCyrillic } from '../lib/check';
import { firstLetterHint, maskTerm, parseCloze, sentenceUsesTerm, wordBlanks } from '../lib/cloze';
import { toContent } from '../lib/content';
import { parseImport } from '../lib/importer';
import {
  buildSession,
  dueItems,
  exerciseFor,
  MAX_RELEARN,
  newAllowance,
  pickMessageWords,
  pickNew,
  retrySteps,
  type Step,
} from '../lib/session';
import { gradeFor, nextLevel } from '../lib/srs';
import { computeStreak, retention } from '../lib/stats';
import { DEFAULT_SETTINGS, type Deck, type ExerciseKind, type Item, type ReviewEntry } from '../lib/types';

function item(term: string, patch: Partial<Item> = {}): Item {
  return {
    ...toContent({ term, translation: 'перевод', example: `I [${term}] today.` })!,
    id: term,
    deck: 'pack',
    createdAt: 0,
    level: 0,
    card: createEmptyCard(new Date(0)),
    mySentences: [],
    usedInLife: 0,
    suspended: false,
    ...patch,
  };
}

const DAY = 864e5;
const NOW = new Date(2026, 5, 15, 12);

/** A reviewed card: due `dueIn` days from NOW, last seen `ago` days before NOW. */
function reviewed(stability: number, dueIn = -1, ago = 3): Card {
  return {
    ...createEmptyCard(NOW),
    state: State.Review,
    stability,
    reps: 3,
    due: new Date(NOW.getTime() + dueIn * DAY),
    last_review: new Date(NOW.getTime() - ago * DAY),
  };
}

const log = (itemId: string, exercise: ExerciseKind, result: ReviewEntry['result'], patch: Partial<ReviewEntry> = {}): ReviewEntry => ({
  itemId,
  exercise,
  result,
  at: NOW.getTime(),
  day: '2026-06-15',
  scheduled: true,
  ...patch,
});

describe('checkAnswer', () => {
  it('accepts exact answers regardless of case and punctuation', () => {
    expect(checkAnswer('  Make a Decision! ', 'make a decision')).toBe('correct');
  });
  it('treats a small typo as almost', () => {
    expect(checkAnswer('make a desicion', 'make a decision')).toBe('almost');
  });
  it('rejects a wrong collocation', () => {
    expect(checkAnswer('take a decision', 'make a decision')).toBe('wrong');
  });
  it('ignores sth/sb placeholders when asked', () => {
    expect(checkAnswer('put off', 'put sth off', { ignorePlaceholders: true })).toBe('correct');
  });
  it('accepts alternatives separated by a slash', () => {
    expect(checkAnswer('angry at', 'angry with/angry at')).toBe('correct');
  });
  it('fills a sth/sb slot with any 1-3 words', () => {
    expect(checkAnswer('turn it down', 'turn sth down')).toBe('correct');
    expect(checkAnswer('do me a favour', 'do sb a favour')).toBe('correct');
    expect(checkAnswer('turn the radio volume down', 'turn sth down')).toBe('correct');
    expect(checkAnswer('turn the old radio volume down', 'turn sth down')).toBe('wrong');
    expect(checkAnswer('turn down', 'turn sth down')).toBe('wrong');
  });
  it('fills a possessive slot with any possessive', () => {
    expect(checkAnswer('change my mind', "change one's mind")).toBe('correct');
    expect(checkAnswer('change his mind', 'change your mind')).toBe('correct');
    expect(checkAnswer("get on Anna's nerves", "get on sb's nerves")).toBe('correct');
    expect(checkAnswer('change the mind', "change one's mind")).toBe('wrong');
  });
  it('keeps optional placeholders for recall', () => {
    expect(checkAnswer('put sth off', 'put sth off', { ignorePlaceholders: true })).toBe('correct');
    expect(checkAnswer('put it off', 'put sth off', { ignorePlaceholders: true })).toBe('correct');
    expect(checkAnswer('look into sth', 'look into', { ignorePlaceholders: true })).toBe('correct');
    expect(checkAnswer('fed up with', 'be fed up with sth', { ignorePlaceholders: true })).toBe('correct');
    expect(checkAnswer('fed up with it', 'be fed up with sth')).toBe('wrong');
  });
  it('reads a slash between single words as word alternatives', () => {
    expect(checkAnswer('drop off', 'drop sb/sth off', { ignorePlaceholders: true })).toBe('correct');
    expect(checkAnswer('drop the kids off', 'drop sb/sth off')).toBe('correct');
    expect(checkAnswer('be in a bad mood', 'be in a good/bad mood')).toBe('correct');
    expect(checkAnswer('in a good mood', 'be in a good/bad mood', { ignorePlaceholders: true })).toBe('correct');
    expect(checkAnswer('bad mood', 'be in a good/bad mood')).toBe('wrong');
  });
  it('still spots typos around slots', () => {
    expect(checkAnswer('look forwad to it', 'look forward to sth')).toBe('almost');
    expect(checkAnswer('make up for it', 'make up for sth')).toBe('correct');
  });
  it('accepts answers the learner marked as right', () => {
    expect(checkAnswer('take a decision', 'make a decision', { accepted: ['take a decision'] })).toBe('correct');
    expect(checkAnswer('take a decision', 'make a decision', { accepted: [] })).toBe('wrong');
  });
  it('detects Cyrillic input', () => {
    expect(detectCyrillic('принять решение')).toBe(true);
    expect(detectCyrillic('make a решение')).toBe(true);
    expect(detectCyrillic('make a decision')).toBe(false);
  });
});

describe('cloze', () => {
  it('splits a bracketed example', () => {
    expect(parseCloze('We need to [make a decision] by Friday.')).toEqual({
      before: 'We need to ',
      answer: 'make a decision',
      after: ' by Friday.',
    });
  });
  it('falls back to finding the term in the sentence', () => {
    expect(parseCloze('I will look into it.', 'look into sth')?.answer).toBe('look into');
  });
  it('builds a first-letter hint', () => {
    expect(firstLetterHint('made a decision')).toBe('m___ a d_______');
  });
  it('spots inflected use of a term in a sentence', () => {
    expect(sentenceUsesTerm('Yesterday I finally decided and booked it', 'decide')).toBe(true);
    expect(sentenceUsesTerm('We are running out of milk', 'run out of sth')).toBe(true);
    expect(sentenceUsesTerm('Nothing related here', 'run out of sth')).toBe(false);
  });
  it('builds word-length blanks', () => {
    expect(wordBlanks('make a decision')).toBe('____ _ ________');
    expect(wordBlanks(" can't  afford ")).toBe("___'_ ______");
  });
  it('masks the term in a definition', () => {
    expect(maskTerm('to change a decision or opinion', 'change your mind')).toBe('to … a decision or opinion');
    expect(maskTerm('She decided, is deciding, decides', 'decide')).toBe('She …, is …, …');
    expect(maskTerm('We ran out and are running late', 'run out of sth')).toBe('We … out and are … late');
    expect(maskTerm('to take care of a child', 'take care of sb')).toBe('to … of a child');
    expect(maskTerm('a settlement', 'set sth up')).toBe('a settlement');
    expect(maskTerm('to support someone', 'back sb up')).toBe('to support someone');
    expect(maskTerm('He backed me up', 'back sb up')).toBe('He … me up');
    expect(maskTerm('', 'decide')).toBe('');
  });
});

describe('parseImport', () => {
  it('reads JSON wrapped in prose and code fences', () => {
    const text = 'Sure! Here you go:\n```json\n[{"term":"get the hang of sth","translation":"освоиться"}]\n```\nEnjoy!';
    const { items } = parseImport(text);
    expect(items).toHaveLength(1);
    expect(items[0].term).toBe('get the hang of sth');
  });
  it('reads simple dash and pipe lines', () => {
    const { items } = parseImport('make a decision - принять решение\nrun out of | закончиться | We [ran out of] milk.');
    expect(items.map((i) => i.term)).toEqual(['make a decision', 'run out of']);
    expect(items[1].example).toBe('We [ran out of] milk.');
  });
  it('skips entries without a translation', () => {
    expect(parseImport('[{"term":"x"},{"term":"y","translation":"у"}]')).toEqual(
      expect.objectContaining({ skipped: 1 }),
    );
  });
});

describe('grading', () => {
  it('maps results to FSRS ratings', () => {
    expect(gradeFor('correct')).toBe(Rating.Good);
    expect(gradeFor('done')).toBe(Rating.Good);
    expect(gradeFor('almost')).toBe(Rating.Hard);
    expect(gradeFor('hinted')).toBe(Rating.Again);
    expect(gradeFor('wrong')).toBe(Rating.Again);
  });
});

describe('nextLevel', () => {
  const card = createEmptyCard();
  const stable = { ...card, stability: 30 };
  const at = (level: number, patch: Partial<Item> = {}) => ({ level, card, mySentences: [], ...patch });
  const yesterday = [{ text: 'I changed my mind.', at: NOW.getTime() - DAY }];
  const today = [{ text: 'I changed my mind.', at: NOW.getTime() - 60_000 }];

  it('an intro makes an item seen', () => {
    expect(nextLevel(at(0), 'intro', 'done')).toBe(1);
    expect(nextLevel(at(3), 'intro', 'done')).toBe(3);
  });
  it('recognition alone never goes past level 2', () => {
    expect(nextLevel(at(2), 'choice', 'correct')).toBe(2);
    expect(nextLevel(at(0), 'choice', 'correct')).toBe(1);
  });
  it('typed answers climb one level at a time up to 3', () => {
    expect(nextLevel(at(1), 'cloze', 'correct')).toBe(2);
    expect(nextLevel(at(2), 'cloze', 'correct')).toBe(3);
    expect(nextLevel(at(2), 'recall', 'almost')).toBe(3);
    expect(nextLevel(at(3), 'cloze-ru', 'correct')).toBe(3);
  });
  it('a hint leaves the level alone', () => {
    expect(nextLevel(at(2), 'cloze', 'hinted')).toBe(2);
    expect(nextLevel(at(4), 'recall', 'hinted')).toBe(4);
  });
  it('a sentence alone does not make a word used', () => {
    expect(nextLevel(at(3), 'sentence', 'done')).toBe(3);
    expect(nextLevel(at(3, { mySentences: yesterday }), 'sentence', 'done')).toBe(3);
  });
  it('used needs a correct typed answer on a later day than a sentence', () => {
    expect(nextLevel(at(3, { mySentences: yesterday }), 'cloze', 'correct', NOW)).toBe(4);
    expect(nextLevel(at(3, { mySentences: today }), 'cloze', 'correct', NOW)).toBe(3);
    expect(nextLevel(at(3, { mySentences: yesterday }), 'recall', 'almost', NOW)).toBe(3);
    expect(nextLevel(at(3, { mySentences: yesterday }), 'say', 'correct', NOW)).toBe(3);
    expect(nextLevel(at(2, { mySentences: yesterday }), 'cloze', 'correct', NOW)).toBe(3);
  });
  it('a used, stable word becomes mastered', () => {
    expect(nextLevel(at(4, { card: stable }), 'recall', 'correct')).toBe(5);
    expect(nextLevel(at(4, { card: stable }), 'say', 'correct')).toBe(5);
    expect(nextLevel(at(4, { card: stable }), 'recall', 'almost')).toBe(4);
    expect(nextLevel(at(4), 'recall', 'correct')).toBe(4);
  });
  it('saying it aloud never promotes below level 4', () => {
    expect(nextLevel(at(2, { card: stable }), 'say', 'correct')).toBe(2);
    expect(nextLevel(at(3, { card: stable }), 'say', 'correct')).toBe(3);
  });
  it('a mistake drops one level from 3 up', () => {
    expect(nextLevel(at(5), 'recall', 'wrong')).toBe(4);
    expect(nextLevel(at(4), 'recall', 'wrong')).toBe(3);
    expect(nextLevel(at(3), 'say', 'wrong')).toBe(2);
    expect(nextLevel(at(2), 'cloze', 'wrong')).toBe(2);
  });
});

describe('exerciseFor', () => {
  const at = (level: number, stability: number, patch: Partial<Item> = {}) =>
    item('make a decision', { level, card: reviewed(stability), exampleRu: 'Мы приняли решение.', ...patch });
  it('starts with a gap-fill and falls back to recall without a cloze', () => {
    expect(exerciseFor(at(1, 30))).toBe('cloze');
    expect(exerciseFor(at(1, 0, { example: '' }))).toBe('recall');
    expect(exerciseFor(at(3, 2))).toBe('cloze');
  });
  it('moves to translation, then recall or saying it aloud, as stability grows', () => {
    expect(exerciseFor(at(3, 10))).toBe('cloze-ru');
    expect(exerciseFor(at(3, 10, { exampleRu: '' }))).toBe('cloze');
    expect(exerciseFor(at(3, 10, { example: '' }))).toBe('recall');
    expect(exerciseFor(at(4, 25), () => 0.2)).toBe('say');
    expect(exerciseFor(at(4, 25), () => 0.8)).toBe('recall');
  });
  it('never asks multiple choice or dictation', () => {
    for (let level = 1; level <= 5; level++) {
      for (const s of [0, 3, 8, 15, 22, 60]) expect(['choice', 'dictation']).not.toContain(exerciseFor(at(level, s)));
    }
  });
});

describe('session', () => {
  it('does not pick two new items with the same first word on one day', () => {
    const picked = pickNew([item('look up'), item('look after'), item('make a decision')], 5);
    expect(picked.map((i) => i.term)).toEqual(['look up', 'make a decision']);
  });
  it('prefers the learner’s own words', () => {
    const picked = pickNew([item('take a break'), item('come up with', { deck: 'own', createdAt: 5 })], 1);
    expect(picked[0].term).toBe('come up with');
  });
  it('takes course words before other packs, mixing the course topics', () => {
    const picked = pickNew(
      [
        item('take a break', { deck: 'everyday-life', createdAt: 1 }),
        item('bond over sth', { deck: 'course-1-friends', createdAt: 2 }),
        item('click with sb', { deck: 'course-1-friends', createdAt: 3 }),
        item('urban areas', { deck: 'course-2-cities', createdAt: 4 }),
      ],
      4,
    );
    expect(picked.map((i) => i.term)).toEqual(['bond over sth', 'urban areas', 'click with sb', 'take a break']);
  });
  it('can be asked for extra new words after the daily ones', () => {
    const fresh = ['a', 'b', 'c', 'd'].map((t, k) => item(`${t} word`, { createdAt: k }));
    const intros = (steps: { exercise: string }[]) => steps.filter((s) => s.exercise === 'intro').length;
    expect(intros(buildSession(fresh, [], { ...DEFAULT_SETTINGS, newPerDay: 0 }, NOW))).toBe(0);
    expect(intros(buildSession(fresh, [], { ...DEFAULT_SETTINGS, newPerDay: 0 }, NOW, 3))).toBe(3);
  });
  it('pauses new words when the overdue backlog reaches the cap', () => {
    const due = Array.from({ length: 5 }, (_, i) => item(`due${i}`, { level: 2, card: reviewed(5, -2) }));
    const steps = buildSession([...due, item('fresh')], [], { ...DEFAULT_SETTINGS, reviewCap: 5 }, NOW);
    expect(steps).toHaveLength(5);
    expect(steps.every((s) => !s.isNew)).toBe(true);
  });
  it('shrinks the new-word allowance with the backlog', () => {
    const overdue = (n: number) => Array.from({ length: n }, (_, i) => item(`o${i}`, { level: 3, card: reviewed(5, -2) }));
    const settings = { ...DEFAULT_SETTINGS, newPerDay: 8, reviewCap: 40 };
    expect(newAllowance(overdue(0), [], settings, NOW)).toBe(8);
    expect(newAllowance(overdue(10), [], settings, NOW)).toBe(6);
    expect(newAllowance(overdue(30), [], settings, NOW)).toBe(2);
    expect(newAllowance(overdue(50), [], settings, NOW)).toBe(0);
    // Due later today is not overdue; already introduced today counts against the allowance.
    const today = Array.from({ length: 20 }, (_, i) => item(`t${i}`, { level: 3, card: reviewed(5, -0.1) }));
    expect(newAllowance(today, [log('x', 'intro', 'done', { scheduled: false })], settings, NOW)).toBe(7);
  });
  it('reviews the most likely forgotten items first', () => {
    const items = [
      item('a', { level: 3, card: reviewed(30, -5, 10) }),
      item('b', { level: 3, card: reviewed(2, -1, 10) }),
      item('c', { level: 3, card: reviewed(10, -1, 10) }),
    ];
    expect(dueItems(items, NOW).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(buildSession(items, [], { ...DEFAULT_SETTINGS, newPerDay: 0, reviewCap: 2 }, NOW).map((s) => s.itemId)).toEqual(['b', 'c']);
  });
  it('introduces a new item, then a choice, then a scheduled typed check', () => {
    const steps = buildSession([item('fresh')], [], DEFAULT_SETTINGS, NOW);
    expect(steps.map((s) => [s.exercise, s.scheduled, s.isNew])).toEqual([
      ['intro', false, true],
      ['choice', false, true],
      ['cloze', true, true],
    ]);
    expect(buildSession([item('fresh', { example: '' })], [], DEFAULT_SETTINGS, NOW).map((s) => s.exercise)).toEqual([
      'intro',
      'choice',
      'recall',
    ]);
  });

  /** Checks the gaps between each new item's intro, choice and typed check. */
  function gaps(steps: Step[]) {
    const ids = steps.filter((s) => s.exercise === 'intro').map((s) => s.itemId);
    return ids.map((id) => {
      const idx = (pred: (s: Step) => boolean) => steps.findIndex((s) => s.itemId === id && pred(s));
      const intro = idx((s) => s.exercise === 'intro');
      return { intro, choice: idx((s) => s.exercise === 'choice') - intro, typed: idx((s) => s.scheduled) - intro };
    });
  }
  it('spaces a new item’s checks between reviews', () => {
    // Due earlier today, so not a backlog that holds new words back.
    const due = Array.from({ length: 20 }, (_, i) => item(`due${i}`, { level: 3, card: reviewed(5, -0.1) }));
    const fresh = ['a', 'b', 'c', 'd', 'e'].map((t) => item(`${t} new`));
    const steps = buildSession([...due, ...fresh], [], DEFAULT_SETTINGS, NOW);
    expect(steps).toHaveLength(20 + 5 * 3);
    for (const g of gaps(steps)) {
      expect(g.choice).toBeGreaterThanOrEqual(3);
      expect(g.typed).toBeGreaterThanOrEqual(9);
    }
    expect(steps.filter((s) => s.scheduled)).toHaveLength(25);
  });
  it('keeps the gaps on a first day with only new words', () => {
    const fresh = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((t) => item(`${t} new`));
    const steps = buildSession(fresh, [], DEFAULT_SETTINGS, NOW);
    expect(steps).toHaveLength(21);
    for (const g of gaps(steps)) {
      expect(g.choice).toBeGreaterThanOrEqual(3);
      expect(g.typed).toBeGreaterThanOrEqual(9);
    }
  });
  it('puts checks at the end when the session is too short', () => {
    const due = [item('due', { level: 3, card: reviewed(5, -2) })];
    const steps = buildSession([...due, item('fresh')], [], DEFAULT_SETTINGS, NOW);
    expect(steps.map((s) => s.exercise)).toEqual(['cloze', 'intro', 'choice', 'cloze']);
  });
});

describe('retrySteps', () => {
  const it1 = item('make a decision');
  const queue = (n: number): Step[] => Array.from({ length: n }, (_, i) => ({ itemId: `x${i}`, exercise: 'cloze', scheduled: true, isNew: false }));
  const at0 = (q: Step[], patch: Partial<Step> = {}) => {
    q[0] = { itemId: it1.id, exercise: 'recall', scheduled: true, isNew: false, ...patch };
    return q;
  };
  it('retries a mistake two steps later as an unscheduled cloze', () => {
    expect(retrySteps(at0(queue(10)), 0, 'wrong', it1)).toEqual([
      { at: 3, step: { itemId: it1.id, exercise: 'cloze', scheduled: false, isNew: false, retry: 'relearn' } },
    ]);
    expect(retrySteps(at0(queue(10)), 0, 'hinted', it1)[0].at).toBe(3);
    expect(retrySteps(at0(queue(10)), 0, 'hinted', item('x', { example: '' }))[0].step.exercise).toBe('recall');
  });
  it('clamps to the end, right next only when nothing else remains', () => {
    expect(retrySteps(at0(queue(2)), 0, 'wrong', it1)[0].at).toBe(2);
    expect(retrySteps(at0(queue(1)), 0, 'wrong', it1)[0].at).toBe(1);
  });
  it('adds nothing after a right answer, an intro or a sentence', () => {
    expect(retrySteps(at0(queue(5)), 0, 'correct', it1)).toEqual([]);
    expect(retrySteps(at0(queue(5)), 0, 'almost', it1)).toEqual([]);
    expect(retrySteps(at0(queue(5), { exercise: 'intro' }), 0, 'done', it1)).toEqual([]);
    expect(retrySteps(at0(queue(5), { exercise: 'sentence' }), 0, 'wrong', it1)).toEqual([]);
  });
  it('confirms a successful retry with one recall at the end', () => {
    const q = at0(queue(6), { retry: 'relearn', scheduled: false });
    expect(retrySteps(q, 0, 'correct', it1)).toEqual([
      { at: 6, step: { itemId: it1.id, exercise: 'recall', scheduled: false, isNew: false, retry: 'confirm' } },
    ]);
    q.push({ itemId: it1.id, exercise: 'recall', scheduled: false, isNew: false, retry: 'confirm' });
    expect(retrySteps(q, 0, 'correct', it1)).toEqual([]);
    expect(retrySteps(q, 6, 'correct', it1)).toEqual([]);
  });
  it('stops relearning after MAX_RELEARN retries', () => {
    const q = at0(queue(8));
    for (let k = 1; k <= MAX_RELEARN; k++) q[k] = { itemId: it1.id, exercise: 'cloze', scheduled: false, isNew: false, retry: 'relearn' };
    expect(retrySteps(q, MAX_RELEARN, 'wrong', it1)).toEqual([]);
  });
});

describe('pickMessageWords', () => {
  const items = [
    item('recalled', { level: 3 }),
    item('recalled but failed', { level: 3 }),
    item('new today', { level: 2 }),
    item('old', { level: 4 }),
    item('untouched', { level: 3 }),
  ];
  const reviews = [
    log('recalled', 'cloze', 'correct'),
    log('recalled but failed', 'recall', 'hinted'),
    log('recalled but failed', 'cloze', 'correct', { scheduled: false }),
    log('new today', 'intro', 'done', { scheduled: false }),
    log('new today', 'cloze', 'correct'),
    log('old', 'say', 'correct'),
    log('untouched', 'cloze', 'correct', { day: '2026-06-14' }),
  ];
  it('prefers level-3 words answered right today, then new ones, never failed ones', () => {
    expect(pickMessageWords(items, reviews, { today: '2026-06-15', count: 2 }).map((i) => i.id)).toEqual(['recalled', 'new today']);
    expect(pickMessageWords(items, reviews, { today: '2026-06-15', count: 5 }).map((i) => i.id)).toEqual(['recalled', 'new today', 'old']);
  });
});

describe('retention', () => {
  it('counts the first scheduled typed or said answer per item and day', () => {
    const reviews = [
      ...Array.from({ length: 8 }, (_, i) => log(`r${i}`, 'recall', 'correct')),
      log('typo', 'cloze', 'almost'),
      log('hint', 'cloze', 'hinted'),
      log('said', 'say', 'wrong'),
      // A second scheduled answer the same day, unscheduled repeats and recognition do not count.
      log('hint', 'cloze', 'correct', { at: NOW.getTime() + 1000 }),
      log('r0', 'cloze', 'wrong', { scheduled: false }),
      log('c', 'choice', 'wrong'),
      // A new item's first check on its intro day is not a review.
      log('n', 'intro', 'done', { scheduled: false }),
      log('n', 'cloze', 'wrong'),
    ];
    expect(retention(reviews, 30, NOW)).toBeCloseTo(9 / 11);
    expect(retention(reviews.slice(0, 5), 30, NOW)).toBeNull();
  });
});

describe('streak', () => {
  const days = (keys: string[]) => new Map(keys.map((k) => [k, 10]));
  it('counts consecutive active days and does not break on today', () => {
    expect(computeStreak(days(['2026-01-01', '2026-01-02']), new Date(2026, 0, 3)).current).toBe(2);
  });
  it('a freeze covers one missed day after 7 active days', () => {
    const week = Array.from({ length: 7 }, (_, i) => `2026-01-0${i + 1}`);
    const s = computeStreak(days([...week, '2026-01-09']), new Date(2026, 0, 9));
    expect(s.current).toBe(8);
    expect(s.freezes).toBe(0);
  });
  it('a missed day without a freeze resets the streak', () => {
    expect(computeStreak(days(['2026-01-01', '2026-01-03']), new Date(2026, 0, 3)).current).toBe(1);
  });
});

describe('bundled packs', () => {
  const dir = join(__dirname, '../data/decks');
  for (const file of readdirSync(dir)) {
    it(`${file} is valid`, () => {
      const deck: Deck = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      expect(deck.items.length).toBeGreaterThan(0);
      for (const raw of deck.items) {
        const c = toContent(raw);
        expect(c, raw.term).not.toBeNull();
        expect(raw.example.match(/\[[^\]]+\]/g), raw.term).toHaveLength(1);
        expect(raw.exampleRu, raw.term).toBeTruthy();
      }
    });
  }
});
