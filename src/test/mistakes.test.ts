import { describe, expect, it } from 'vitest';
import { toContent } from '../lib/content';
import { wrongForms } from '../lib/mistakes';

const item = (raw: Record<string, unknown>) => toContent({ translation: 'x', ...raw })!;

describe('wrongForms', () => {
  it('uses the explicit wrong list first', () => {
    expect(wrongForms(item({ term: 'make a mistake', wrong: ['do a mistake'] }))[0]).toBe('do a mistake');
  });
  it('reads quoted mistakes from the trap', () => {
    const forms = wrongForms(item({ term: 'depend on sth', trap: "Not 'depend from' (calque of «зависеть от»)." }));
    expect(forms).toContain('depend from');
  });
  it('swaps the light verb keeping the tense of the example', () => {
    const forms = wrongForms(item({ term: 'make a decision', example: 'We finally [made a decision] yesterday.' }));
    expect(forms).toContain('did a decision');
  });
  it('never returns the right answer or a collocation', () => {
    const forms = wrongForms(item({ term: 'arrive at', collocations: ['arrive in'], example: 'We [arrive at] noon.' }));
    expect(forms).not.toContain('arrive in');
    expect(forms).not.toContain('arrive at');
  });
});
