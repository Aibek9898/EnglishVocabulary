import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../lib/check';
import { parseCloze, plainExample, sentenceUsesTerm } from '../lib/cloze';
import { toContent } from '../lib/content';
import { gradeTyped, wrongForms } from '../lib/mistakes';
import type { Deck, ItemContent } from '../lib/types';

const deck: Deck = JSON.parse(readFileSync(join(__dirname, '../data/decks/course-8-comparing.json'), 'utf8'));
const items = deck.items.map((raw) => toContent(raw)!) as ItemContent[];

describe('course 8: comparing and job perks', () => {
  it('is a course pack with every phrase from the list', () => {
    expect(deck.course).toBe(true);
    expect(items).toHaveLength(29);
    expect(new Set(items.map((i) => i.term.toLowerCase())).size).toBe(29);
  });
  for (const item of items) {
    describe(item.term, () => {
      const gap = parseCloze(item.example, item.term)!.answer;
      it('counts its own example as using the phrase', () => {
        expect(sentenceUsesTerm(plainExample(item.example), item.term, item.accepted)).toBe(true);
      });
      it('accepts the phrase itself when recalled', () => {
        expect(checkAnswer(item.term, item.term, { ignorePlaceholders: true, accepted: item.accepted })).toBe('correct');
      });
      it('never offers a right answer as a wrong one', () => {
        for (const w of wrongForms(item)) {
          expect(checkAnswer(w, gap, { accepted: item.accepted }), w).not.toBe('correct');
          expect(gradeTyped(item, w, gap, false), w).toBe('wrong');
        }
        expect(wrongForms(item).length).toBeGreaterThanOrEqual(2);
      });
      it('has British IPA and a Russian example', () => {
        expect(item.ipa).toBeTruthy();
        expect(item.exampleRu).toMatch(/\p{Script=Cyrillic}/u);
      });
    });
  }
});
