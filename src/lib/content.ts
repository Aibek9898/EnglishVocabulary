import type { ItemContent, ItemType } from './types';

const TYPES: ItemType[] = ['collocation', 'phrasal-verb', 'idiom', 'phrase', 'word'];

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const list = (v: unknown) =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === 'string' ? v.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : [];

export function guessType(term: string): ItemType {
  const words = term.trim().split(/\s+/);
  if (words.length === 1) return 'word';
  if (/\b(up|down|out|off|on|in|over|away|back|around|through)\b/.test(term) && words.length <= 3) return 'phrasal-verb';
  return 'collocation';
}

/** Turns anything item-shaped (pack entry, AI output, form) into a clean ItemContent, or null. */
export function toContent(raw: unknown): ItemContent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const term = str(r.term ?? r.phrase ?? r.word ?? r.english ?? r.en);
  const translation = str(r.translation ?? r.russian ?? r.ru ?? r.meaning);
  if (!term || !translation) return null;
  const type = TYPES.includes(r.type as ItemType) ? (r.type as ItemType) : guessType(term);
  return {
    term,
    type,
    translation,
    definition: str(r.definition),
    example: str(r.example),
    exampleRu: str(r.exampleRu ?? r.example_ru ?? r.exampleTranslation),
    collocations: list(r.collocations),
    pattern: str(r.pattern),
    trap: str(r.trap),
    tags: list(r.tags).map((t) => t.toLowerCase()),
    source: str(r.source) || undefined,
    wrong: list(r.wrong ?? r.mistakes),
  };
}

export function termKey(term: string): string {
  return term.toLowerCase().replace(/\s+/g, ' ').trim();
}
