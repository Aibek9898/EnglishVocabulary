import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { candidates, gloss, lookup, parseEntry, setDictionaryFetcher, shortSense } from '../lib/dictionary';

beforeAll(() => {
  setDictionaryFetcher(async (url) => {
    const file = `public/dict/${url.split('/').pop()}`;
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  });
});

describe('dictionary', () => {
  it('finds dictionary forms', () => {
    expect(candidates('smarter')).toContain('smart');
    expect(candidates('running')).toContain('run');
    expect(candidates('studies')).toContain('study');
    expect(candidates('hoped')).toContain('hope');
    expect(candidates('Don’t')).toContain('do');
  });

  it('keeps only Russian translations in a short sense', () => {
    expect(shortSense('оратор; he is no speaker он плохой оратор')).toBe('оратор');
  });

  it('looks up words and follows forms', async () => {
    const anxiety = await lookup('anxiety');
    expect(anxiety?.entry.senses[0].text).toContain('беспокойство');
    expect(anxiety?.entry.senses[0].pos).toBe('noun');
    const went = await lookup('went');
    expect(went?.entry.formOf).toEqual({ relation: 'past of', word: 'go' });
    expect(went?.base?.senses.length).toBeGreaterThan(3);
    expect(gloss(await lookup('Smarter'))).not.toBe('');
    expect(await lookup('qwzx')).toBeNull();
  });

  it('parses an entry with numbered parts of speech', () => {
    const e = parseEntry('thinking', '[ˈθɪŋkɪŋ]\n1. _pres-p. от think\n2. _n.\n1) размышление; to my thinking по моему мнению\n3. _a. мыслящий, разумный');
    expect(e.formOf?.word).toBe('think');
    expect(e.senses).toEqual([
      { pos: 'noun', text: 'размышление' },
      { pos: 'adjective', text: 'мыслящий, разумный' },
    ]);
  });
});

describe('reading helpers', () => {
  it('finds words and sentences in a paragraph', async () => {
    const { wordAt, snapToWords, sentenceAround, parseTxt } = await import('../lib/books');
    const p = 'I was nervous. Then I came up with a plan, didn’t I? Yes.';
    expect(p.slice(...Object.values(wordAt(p, 8)!) as [number, number])).toBe('nervous');
    expect(wordAt(p, 13)).toEqual({ start: 6, end: 13 });
    expect(wordAt(p, 14)).toBeNull();
    const r = snapToWords(p, 23, 31)!;
    expect(p.slice(r.start, r.end)).toBe('came up with');
    const s = sentenceAround(p, r.start, r.end);
    expect(s.text).toBe('Then I came up with a plan, didn’t I?');
    expect(s.text.slice(s.start, s.end)).toBe('came up with');
    const book = parseTxt('Chapter 1\n\nHello there.\n\nChapter 2\n\nBye now.', 'my_book.txt');
    expect(book.title).toBe('my book');
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
  });
});
