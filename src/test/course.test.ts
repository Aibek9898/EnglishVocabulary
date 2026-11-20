import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../lib/check';
import { parseCloze, plainExample, sentenceUsesTerm } from '../lib/cloze';
import { toContent } from '../lib/content';
import { gradeTyped, wrongForms } from '../lib/mistakes';
import type { Deck, ItemContent } from '../lib/types';

const LISTS: [file: string, size: number][] = [
  ['course-8-comparing', 29],
  ['course-10-lesson-17-november', 12],
  ['course-11-lesson-20-november', 23],
];

for (const [file, size] of LISTS) {
const deck: Deck = JSON.parse(readFileSync(join(__dirname, `../data/decks/${file}.json`), 'utf8'));
const items = deck.items.map((raw) => toContent(raw)!) as ItemContent[];

describe(deck.title, () => {
  it('is a course pack with every phrase from the list', () => {
    expect(deck.course).toBe(true);
    expect(items).toHaveLength(size);
    expect(new Set(items.map((i) => i.term.toLowerCase())).size).toBe(size);
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
}
