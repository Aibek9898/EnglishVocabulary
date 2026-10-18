import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyCard } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../lib/check';
import { firstLetterHint, parseCloze, sentenceUsesTerm } from '../lib/cloze';
import { toContent } from '../lib/content';
import { parseImport } from '../lib/importer';
import { buildSession, pickNew } from '../lib/session';
import { nextLevel } from '../lib/srs';
import { computeStreak } from '../lib/stats';
import { DEFAULT_SETTINGS, type Deck, type Item } from '../lib/types';

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

describe('nextLevel', () => {
  const card = createEmptyCard();
  it('recognition alone never goes past level 2', () => {
    expect(nextLevel({ level: 2, card }, 'choice', 'correct')).toBe(2);
    expect(nextLevel({ level: 0, card }, 'choice', 'correct')).toBe(1);
  });
  it('typed recall reaches level 3, a sentence reaches 4', () => {
    expect(nextLevel({ level: 2, card }, 'cloze', 'correct')).toBe(3);
    expect(nextLevel({ level: 3, card }, 'sentence', 'done')).toBe(4);
    expect(nextLevel({ level: 2, card }, 'sentence', 'done')).toBe(2);
  });
  it('a used, stable word becomes mastered; a mistake drops a level', () => {
    expect(nextLevel({ level: 4, card: { ...card, stability: 30 } }, 'recall', 'correct')).toBe(5);
    expect(nextLevel({ level: 4, card }, 'recall', 'wrong')).toBe(3);
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
  it('pauses new words when the backlog is full', () => {
    const due = Array.from({ length: 5 }, (_, i) => item(`due${i}`, { level: 2 }));
    const steps = buildSession([...due, item('fresh')], [], { ...DEFAULT_SETTINGS, reviewCap: 5 }, new Date());
    expect(steps).toHaveLength(5);
    expect(steps.every((s) => !s.isNew)).toBe(true);
  });
  it('introduces a new item and checks it right after', () => {
    const steps = buildSession([item('fresh')], [], DEFAULT_SETTINGS, new Date());
    expect(steps.map((s) => s.exercise)).toEqual(['intro', 'choice']);
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
