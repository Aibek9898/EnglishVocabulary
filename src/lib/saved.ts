import { stripPlaceholders } from './check';
import { termKey } from './content';
import { db } from './db';

/** A word or phrase the learner saved from anywhere on the site, waiting to become a card. */
export interface SavedPhrase {
  text: string;
  /** The card it was saved from, e.g. "bite the bullet" for "take the plunge". */
  from?: string;
  at: number;
}

const KEY = 'saved';
export const MAX_SAVE_WORDS = 8;

export async function getSaved(): Promise<SavedPhrase[]> {
  const row = await db.kv.get(KEY);
  return Array.isArray(row?.value) ? (row.value as SavedPhrase[]) : [];
}

/** One line, without surrounding quotes, brackets or punctuation. */
export function cleanPhrase(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s"“”‘’'«»()[\]·•,.;:!?–—-]+|[\s"“”‘’'«»()[\]·•,.;:!?–—-]+$/gu, '')
    .trim();
}

/** True when the text is a sensible thing to save: a word or a short phrase. */
export function isSaveable(text: string): boolean {
  return text.length > 0 && text.length <= 80 && text.split(' ').length <= MAX_SAVE_WORDS;
}

/** Adds a phrase to the end of the list. Returns false when it is already there. */
export async function savePhrase(text: string, from?: string): Promise<boolean> {
  const clean = cleanPhrase(text);
  if (!clean) return false;
  return db.transaction('rw', db.kv, async () => {
    const list = await getSaved();
    if (list.some((s) => termKey(s.text) === termKey(clean))) return false;
    const source = from && termKey(from) !== termKey(clean) ? from : undefined;
    await db.kv.put({ key: KEY, value: [...list, { text: clean, from: source, at: Date.now() }] });
    return true;
  });
}

export async function removeSaved(texts: string[]) {
  const drop = new Set(texts.map(termKey));
  await db.transaction('rw', db.kv, async () => {
    await db.kv.put({ key: KEY, value: (await getSaved()).filter((s) => !drop.has(termKey(s.text))) });
  });
}

export async function setSaved(list: SavedPhrase[]) {
  await db.kv.put({ key: KEY, value: list });
}

/** Matches a saved phrase to library terms, ignoring sth/sb: "take the plunge" is in "take the plunge (on sth)". */
export function libraryKeys(terms: string[]): Set<string> {
  return new Set(terms.flatMap((t) => [termKey(t), stripPlaceholders(t)]));
}

export function inLibrary(phrase: SavedPhrase, keys: Set<string>): boolean {
  return keys.has(termKey(phrase.text)) || keys.has(stripPlaceholders(phrase.text));
}

/** Drops saved phrases that are now in the library. */
export async function pruneSaved() {
  const keys = libraryKeys((await db.items.toArray()).map((i) => i.term));
  const list = await getSaved();
  const left = list.filter((s) => !inLibrary(s, keys));
  if (left.length !== list.length) await setSaved(left);
}

/** The list as lines for an AI chat or a message. */
export function savedText(list: SavedPhrase[]): string {
  return list.map((s) => (s.from ? `${s.text} (seen next to “${s.from}”)` : s.text)).join('\n');
}
