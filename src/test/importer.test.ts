import { describe, expect, it } from 'vitest';
import { AI_PROMPT, extractJson, parseImport } from '../lib/importer';

describe('AI import', () => {
  it('reads a fenced JSON block with prose around it', () => {
    const reply = 'Here you go!\n```json\n[{"term":"run out of","translation":"закончиться","wrong":["run out from"]}]\n```\nGood luck!';
    const { items, skipped } = parseImport(reply);
    expect(skipped).toBe(0);
    expect(items[0].term).toBe('run out of');
    expect(items[0].wrong).toEqual(['run out from']);
  });

  it('repairs trailing commas and curly quotes', () => {
    const broken = '[{“term”: “put sth off”, “translation”: “откладывать”,},]';
    expect(extractJson(broken)).toEqual([{ term: 'put sth off', translation: 'откладывать' }]);
  });

  it('keeps Russian quotes inside values', () => {
    const json = '[{"term":"make a decision","translation":"принять решение","trap":"Not \'do\' («сделать»)",}]';
    const { items } = parseImport(json);
    expect(items[0].trap).toBe("Not 'do' («сделать»)");
  });

  it('falls back to plain lines', () => {
    const { items } = parseImport('make a decision - принять решение\ncome up with — придумать');
    expect(items.map((i) => i.term)).toEqual(['make a decision', 'come up with']);
  });

  it('asks for the fields the app uses', () => {
    for (const field of ['"wrong"', '"trap"', '"exampleRu"', 'my-mistakes', '```json']) expect(AI_PROMPT).toContain(field);
  });
});
