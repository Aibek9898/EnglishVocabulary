import { createEmptyCard, State, type Card } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { toContent } from '../lib/content';
import { buildSession, dueItems, ladderDue, olderCheckedToday, refreshItems } from '../lib/session';
import { LADDER, scheduleNext } from '../lib/srs';
import { DEFAULT_SETTINGS, type Item, type ReviewEntry } from '../lib/types';

const DAY = 864e5;
const NOW = new Date(2026, 5, 15, 12);
const days = (from: Date, to: Date | string) => Math.round((+new Date(to) - +from) / DAY);

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

/** A learned card: last seen `ago` days before NOW, due `dueIn` days from NOW. */
function learned(dueIn: number, ago = 2, patch: Partial<Card> = {}): Card {
  return {
    ...createEmptyCard(NOW),
    state: State.Review,
    stability: 10,
    difficulty: 5,
    reps: 2,
    due: new Date(+NOW + dueIn * DAY),
    last_review: new Date(+NOW - ago * DAY),
    ...patch,
  };
}

const log = (itemId: string, exercise: ReviewEntry['exercise'], patch: Partial<ReviewEntry> = {}): ReviewEntry => ({
  itemId,
  exercise,
  result: 'correct',
  at: +NOW,
  day: '2026-06-15',
  scheduled: true,
  ...patch,
});

describe('review ladder', () => {
  it('brings a word answered right back after 1, 3, 7, 14 and 30 days, then lets FSRS decide', () => {
    let it2 = item('make a decision');
    let now = NOW;
    const gaps: number[] = [];
    for (let k = 0; k < LADDER.length + 1; k++) {
      const next = scheduleNext(it2, 'correct', now, 0.9);
      gaps.push(days(now, next.card.due));
      it2 = { ...it2, card: next.card, ladder: next.ladder };
      now = new Date(next.card.due);
    }
    expect(gaps.slice(0, LADDER.length)).toEqual(LADDER);
    expect(gaps[LADDER.length]).toBeGreaterThan(30);
  });
  it('after a mistake shows the word the next day, then within 3 days', () => {
    const it2 = item('make a decision', { card: learned(0, 14, { reps: 4, stability: 14 }), ladder: 4 });
    const wrong = scheduleNext(it2, 'wrong', NOW, 0.9);
    expect(days(NOW, wrong.card.due)).toBeLessThanOrEqual(2);
    expect(wrong.ladder).toBe(1);
    const later = new Date(wrong.card.due);
    const right = scheduleNext({ ...it2, card: wrong.card, ladder: wrong.ladder }, 'correct', later, 0.9);
    expect(days(later, right.card.due)).toBeLessThanOrEqual(3);
  });
  it('a typo still counts as remembered', () => {
    expect(scheduleNext(item('x', { ladder: 2 }), 'almost', NOW, 0.9).ladder).toBe(3);
  });
  it('cards graded before the ladder come back by its gaps', () => {
    // Two reviews, last one 5 days ago: FSRS said 14 days, the ladder says 3.
    const old = item('old', { level: 3, card: learned(9, 5, { reps: 2 }) });
    expect(days(NOW, new Date(ladderDue(old)))).toBe(-2);
    expect(ladderDue(item('fresh', { card: learned(9, 5), ladder: 5 }))).toBe(+NOW + 9 * DAY);
  });
});

describe('older words at the end of a lesson', () => {
  const words = [
    item('soon', { level: 3, card: learned(2), ladder: 3 }),
    item('later', { level: 3, card: learned(20), ladder: 4 }),
    item('legacy', { level: 3, card: learned(9, 5, { reps: 2 }) }),
    item('due', { level: 2, card: learned(-1) }),
    item('fresh'),
    item('paused', { level: 3, card: learned(1), suspended: true }),
  ];
  it('picks words not due yet, the ones that would come back soonest first', () => {
    const picked = refreshItems(words, [], DEFAULT_SETTINGS, NOW);
    expect(picked.map((i) => i.id)).toEqual(['legacy', 'soon', 'later']);
  });
  it('tops up to the daily number, counting reviews done today and due in this lesson', () => {
    const settings = { ...DEFAULT_SETTINGS, oldPerDay: 3 };
    expect(refreshItems(words, [], settings, NOW, 1)).toHaveLength(2);
    expect(refreshItems(words, [log('a', 'cloze'), log('b', 'recall')], settings, NOW)).toHaveLength(1);
    expect(refreshItems(words, [], { ...settings, oldPerDay: 0 }, NOW)).toHaveLength(0);
    // Words introduced today don't count as older words.
    expect(olderCheckedToday([log('n', 'intro', { scheduled: false }), log('n', 'cloze'), log('o', 'recall')], '2026-06-15')).toBe(1);
  });
  it('skips words already seen today', () => {
    const picked = refreshItems(words, [log('soon', 'pairs', { scheduled: false })], DEFAULT_SETTINGS, NOW);
    expect(picked.map((i) => i.id)).toEqual(['legacy', 'later']);
  });
  it('comes after the new words and their checks, as scheduled reviews', () => {
    const steps = buildSession(words, [], DEFAULT_SETTINGS, NOW);
    const firstOlder = steps.findIndex((s) => s.refresh);
    expect(steps.slice(firstOlder).every((s) => s.refresh && s.scheduled && !s.isNew)).toBe(true);
    expect(steps.slice(0, firstOlder).some((s) => s.itemId === 'fresh' && s.scheduled)).toBe(true);
    expect(steps.slice(firstOlder).map((s) => s.itemId)).toEqual(['legacy', 'soon', 'later']);
  });
  it('can be asked for on its own once the day is done', () => {
    const steps = buildSession(words, [log('a', 'cloze')], { ...DEFAULT_SETTINGS, oldPerDay: 1 }, NOW, 0, 2);
    expect(steps.filter((s) => s.refresh).map((s) => s.itemId)).toEqual(['legacy', 'soon']);
  });
});

describe('due today', () => {
  it('counts anything due today, whatever the time', () => {
    const tonight = item('tonight', { level: 3, card: learned(0.4) });
    const tomorrow = item('tomorrow', { level: 3, card: learned(1) });
    expect(dueItems([tonight, tomorrow], NOW).map((i) => i.id)).toEqual(['tonight']);
  });
});

describe('wrapping up today’s words first', () => {
  it('puts a new word’s confirm before the older words', async () => {
    const { retrySteps } = await import('../lib/session');
    const queue = [
      { itemId: 'n', exercise: 'cloze' as const, scheduled: false, isNew: true, retry: 'relearn' as const },
      { itemId: 'x', exercise: 'cloze' as const, scheduled: true, isNew: false },
      { itemId: 'o1', exercise: 'cloze' as const, scheduled: true, isNew: false, refresh: true },
      { itemId: 'o2', exercise: 'cloze' as const, scheduled: true, isNew: false, refresh: true },
    ];
    expect(retrySteps(queue, 0, 'correct', item('n'))[0].at).toBe(2);
    const older = [{ ...queue[2], retry: 'relearn' as const }, queue[3]];
    expect(retrySteps(older, 0, 'correct', item('o1'))[0].at).toBe(2);
  });
});
