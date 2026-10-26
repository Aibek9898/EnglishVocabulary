import { describe, expect, it } from 'vitest';
import { cleanPhrase, inLibrary, isSaveable, libraryKeys, savedText } from '../lib/saved';

describe('saved phrases', () => {
  it('cleans a selection to one line without surrounding punctuation', () => {
    expect(cleanPhrase(' take the plunge ')).toBe('take the plunge');
    expect(cleanPhrase('· take the\n plunge.')).toBe('take the plunge');
    expect(cleanPhrase('“bite the bullet”,')).toBe('bite the bullet');
    expect(cleanPhrase("s'mores")).toBe("s'mores");
  });
  it('accepts words and short phrases only', () => {
    expect(isSaveable('plunge')).toBe(true);
    expect(isSaveable('take the plunge')).toBe(true);
    expect(isSaveable('one two three four five six seven eight nine')).toBe(false);
    expect(isSaveable('')).toBe(false);
  });
  it('matches library terms with or without sth/sb', () => {
    const keys = libraryKeys(['Take the plunge', 'get away with sth']);
    expect(inLibrary({ text: 'take the plunge', at: 0 }, keys)).toBe(true);
    expect(inLibrary({ text: 'get away with', at: 0 }, keys)).toBe(true);
    expect(inLibrary({ text: 'grit your teeth', at: 0 }, keys)).toBe(false);
  });
  it('writes the list for an AI chat', () => {
    expect(savedText([{ text: 'take the plunge', from: 'bite the bullet', at: 0 }, { text: 'gooey', at: 0 }])).toBe(
      'take the plunge (seen next to “bite the bullet”)\ngooey',
    );
  });
});
