import { createEmptyCard } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { findTarget, markExample, parseCloze } from '../lib/cloze';
import { toContent } from '../lib/content';
import { anotherMeaning, cleanMeaning, editPatch, packUpdate } from '../lib/edit';
import type { Item, ItemContent } from '../lib/types';

const PACK: ItemContent = toContent({
  term: 'trip sb up',
  translation: 'поставить подножку',
  definition: 'to make someone fall',
  example: 'Someone [tripped me up] at football.',
  exampleRu: 'Мне кто-то поставил подножку на футболе.',
  wrong: ['tripped up me'],
  tags: ['sport'],
})!;

function item(patch: Partial<Item> = {}): Item {
  return {
    ...PACK,
    id: 'x',
    deck: 'course-5-sport',
    createdAt: 0,
    level: 2,
    card: createEmptyCard(new Date(0)),
    mySentences: [],
    usedInLife: 0,
    suspended: false,
    ...patch,
  };
}

const marked = (sentence: string, term: string) => markExample(sentence, term);

describe('finding the phrase in your own sentence', () => {
  it('finds other forms and words in place of sb/sth', () => {
    expect(marked('The last question really tripped me up.', 'trip sb up')).toBe('The last question really [tripped me up].');
    expect(marked("Don't let it trip you up.", 'trip sb up')).toBe("Don't let it [trip you up].");
    expect(marked('She changed her mind at the last minute.', 'change your mind')).toBe('She [changed her mind] at the last minute.');
    expect(marked('We made a quick decision.', 'make a decision')).toBe('We [made a quick decision].');
    expect(marked('He was over the moon about it.', 'be over the moon')).toBe('He [was over the moon] about it.');
    expect(marked('That was the last straw.', 'the last straw')).toBe('That was [the last straw].');
  });
  it('matches whole words only', () => {
    expect(findTarget('We had brunch early.', 'run')).toBeNull();
    expect(marked('I run every morning.', 'run')).toBe('I [run] every morning.');
  });
  it('leaves a sentence alone when the phrase is not there or already marked', () => {
    expect(marked('Nothing to see here.', 'trip sb up')).toBe('Nothing to see here.');
    expect(marked('It [threw me off].', 'trip sb up')).toBe('It [threw me off].');
  });
  it('gives the gap the exercises will hide', () => {
    expect(parseCloze(marked('The question tripped me up.', 'trip sb up'), 'trip sb up')?.answer).toBe('tripped me up');
  });
});

describe('your own translation and example', () => {
  it('marks the phrase and drops the Russian of the old sentence', () => {
    const m = cleanMeaning(
      { translation: ' сбить с толку ', definition: '', example: 'The last question tripped me up.', exampleRu: PACK.exampleRu },
      PACK.term,
      PACK,
    );
    expect(m).toEqual({ translation: 'сбить с толку', definition: '', example: 'The last question [tripped me up].', exampleRu: '' });
  });
  it('keeps the Russian when only the translation changed', () => {
    const m = cleanMeaning({ translation: 'подставить ножку', definition: PACK.definition, example: PACK.example, exampleRu: PACK.exampleRu }, PACK.term, PACK);
    expect(m.exampleRu).toBe(PACK.exampleRu);
  });
  it('saves only what changed and remembers it as yours', () => {
    const patch = editPatch(item(), { translation: 'сбить с толку', example: PACK.example }, PACK);
    expect(patch).toEqual({ translation: 'сбить с толку', edited: ['translation'] });
  });
  it('forgets the edit when a field goes back to the pack text', () => {
    const it2 = item({ translation: 'сбить с толку', edited: ['translation', 'example'] });
    expect(editPatch(it2, { translation: PACK.translation }, PACK)).toEqual({ translation: PACK.translation, edited: ['example'] });
  });
  it('never treats progress fields as edits', () => {
    const it2 = item();
    expect(editPatch(it2, { ...it2 }, PACK)).toEqual({});
  });
  it('pack updates skip the fields you rewrote', () => {
    const update = packUpdate({ ...PACK, translation: 'новый', example: 'New [trip sb up].', source: 'pack' }, ['translation']);
    expect(update.translation).toBeUndefined();
    expect(update.example).toBe('New [trip sb up].');
    expect('source' in update).toBe(false);
  });
  it('another meaning becomes its own card with its own example', () => {
    const c = anotherMeaning(PACK, { translation: 'сбить с толку', definition: '', example: 'That question tripped me up.', exampleRu: 'Этот вопрос меня подловил.' });
    expect(c).toMatchObject({ term: 'trip sb up', translation: 'сбить с толку', example: 'That question [tripped me up].', wrong: [], tags: ['sport'] });
  });
});
