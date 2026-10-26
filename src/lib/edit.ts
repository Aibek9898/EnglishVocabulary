import { markExample, plainExample } from './cloze';
import type { Item, ItemContent } from './types';

/** What a learner changes to make a card say the meaning they are learning. */
export interface Meaning {
  translation: string;
  definition: string;
  example: string;
  exampleRu: string;
}

export const MEANING_KEYS = ['translation', 'definition', 'example', 'exampleRu'] as const;

/** Every field of a card's content: progress fields are never part of an edit. */
const CONTENT_KEYS: (keyof ItemContent)[] = [
  'term',
  'ipa',
  'type',
  'translation',
  'definition',
  'example',
  'exampleRu',
  'collocations',
  'pattern',
  'trap',
  'tags',
  'source',
  'wrong',
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

/**
 * Cleans a meaning typed by the learner: trims it, marks the term in the
 * example, and drops a Russian example that still translates the old sentence.
 */
export function cleanMeaning(m: Meaning, term: string, before?: Pick<ItemContent, 'example' | 'exampleRu'>): Meaning {
  const example = markExample(m.example.trim().replace(/\s+/g, ' '), term);
  let exampleRu = m.exampleRu.trim();
  if (before && exampleRu && exampleRu === before.exampleRu.trim() && plainExample(example) !== plainExample(before.example)) exampleRu = '';
  return { translation: m.translation.trim(), definition: m.definition.trim(), example, exampleRu };
}

/**
 * The changes to save for an item, plus the updated `edited` list. With the
 * pack's original, a field set back to the pack's text stops counting as edited.
 */
export function editPatch(item: Item, next: Partial<ItemContent>, original?: ItemContent): Partial<Item> {
  const patch: Partial<Item> = {};
  const edited = new Set(item.edited ?? []);
  for (const key of CONTENT_KEYS) {
    if (!(key in next)) continue;
    const value = next[key];
    if (!same(value, item[key])) (patch as Record<string, unknown>)[key] = value;
    if (original) {
      if (same(value, original[key])) edited.delete(key);
      else edited.add(key);
    } else if (key in patch) edited.add(key);
  }
  const list = [...edited];
  if (!same(list.sort(), [...(item.edited ?? [])].sort())) patch.edited = list;
  return patch;
}

/** Pack content to write over a library item, without the fields the learner rewrote. */
export function packUpdate(fresh: ItemContent, edited: Item['edited'] = []): Partial<ItemContent> {
  const { source: _source, ...content } = fresh;
  for (const key of edited) delete (content as Partial<ItemContent>)[key];
  return content;
}

/** A separate card for another meaning of the same phrase. */
export function anotherMeaning(item: ItemContent, m: Meaning): ItemContent {
  return {
    term: item.term,
    ipa: item.ipa,
    type: item.type,
    ...cleanMeaning(m, item.term),
    collocations: [],
    pattern: item.pattern,
    trap: '',
    tags: item.tags,
    wrong: [],
  };
}
