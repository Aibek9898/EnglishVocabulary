import data from '../data/everyday-ru.json';
import { normalize } from './check';
import { db } from './db';

/** An everyday Russian sentence and natural ways to say it in English (the first is the most common). */
export interface Everyday {
  id: string;
  topic: string;
  ru: string;
  en: string[];
  /** A key English word or structure, shown on request. */
  hint?: string;
}

export const EVERYDAY = data as Everyday[];

export const TOPICS: { id: string; label: string }[] = [
  { id: 'small-talk', label: 'Small talk' },
  { id: 'plans', label: 'Plans' },
  { id: 'work', label: 'Work' },
  { id: 'feelings', label: 'Feelings' },
  { id: 'requests', label: 'Asking for things' },
  { id: 'apologies-thanks', label: 'Sorry & thanks' },
  { id: 'opinions', label: 'Opinions' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'food', label: 'Food' },
  { id: 'travel', label: 'Travel' },
  { id: 'home', label: 'Home' },
  { id: 'health', label: 'Health' },
];

export const ROUND = 10;

/**
 * Sentences for one round: ones never practised first, then the ones seen
 * longest ago, so the whole set comes round before anything repeats.
 */
export function pickRound(list: Everyday[], topic: string | null, seen: string[], n = ROUND, random = Math.random): Everyday[] {
  const pool = topic ? list.filter((e) => e.topic === topic) : list;
  const order = new Map(seen.map((id, i) => [id, i]));
  const shuffled = pool.map((e) => ({ e, k: random() })).sort((a, b) => a.k - b.k);
  const fresh = shuffled.filter(({ e }) => !order.has(e.id)).map(({ e }) => e);
  const old = shuffled
    .filter(({ e }) => order.has(e.id))
    .sort((a, b) => order.get(a.e.id)! - order.get(b.e.id)!)
    .map(({ e }) => e);
  return [...fresh, ...old].slice(0, n);
}

const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'cannot'],
  [/\bcan not\b/g, 'cannot'],
  [/\bshan't\b/g, 'shall not'],
  [/n't\b/g, ' not'],
  [/\bi'm\b/g, 'i am'],
  [/'re\b/g, ' are'],
  [/'ve\b/g, ' have'],
  [/'ll\b/g, ' will'],
  [/'d\b/g, ' would'],
  [/\b(it|that|what|there|here|who|he|she|where|how)'s\b/g, '$1 is'],
  [/\blet's\b/g, 'let us'],
];

/** The same words, ignoring case, punctuation and contractions: "I'm late." = "i am late". */
export function sameWords(a: string, b: string): boolean {
  const flat = (t: string) => CONTRACTIONS.reduce((s, [re, to]) => s.replace(re, to), normalize(t)).replace(/\s+/g, ' ').trim();
  return flat(a) === flat(b);
}

/** Without an AI: right when it matches one of the reference translations. */
export function matchesReference(answer: string, references: string[]): boolean {
  return references.some((r) => sameWords(answer, r));
}

const SEEN_KEY = 'everydaySeen';

export async function getSeen(): Promise<string[]> {
  return ((await db.kv.get(SEEN_KEY))?.value as string[] | undefined) ?? [];
}

/** Remembers practised sentences, most recent last. */
export async function markSeen(ids: string[]) {
  const seen = (await getSeen()).filter((id) => !ids.includes(id));
  await db.kv.put({ key: SEEN_KEY, value: [...seen, ...ids].slice(-1000) });
}
