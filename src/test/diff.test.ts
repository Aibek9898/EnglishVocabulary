import { describe, expect, it } from 'vitest';
import { diffWords } from '../lib/diff';

describe('diffWords', () => {
  it('marks the swapped verb', () => {
    const { yours, answer } = diffWords('did a mistake', 'made a mistake');
    expect(yours.map((w) => w.same)).toEqual([false, true, true]);
    expect(answer.map((w) => w.same)).toEqual([false, true, true]);
  });

  it('marks a missing word in the answer only', () => {
    const { yours, answer } = diffWords('depends from', 'depends on');
    expect(yours.filter((w) => !w.same).map((w) => w.text)).toEqual(['from']);
    expect(answer.filter((w) => !w.same).map((w) => w.text)).toEqual(['on']);
  });

  it('ignores case and punctuation', () => {
    const { yours } = diffWords('Look forward to,', 'look forward to');
    expect(yours.every((w) => w.same)).toBe(true);
  });
});
