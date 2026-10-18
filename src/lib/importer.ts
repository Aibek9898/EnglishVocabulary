import { toContent } from './content';
import type { ItemContent } from './types';

export const AI_PROMPT = `You are helping me build my English vocabulary (my level: Upper-Intermediate, my native language: Russian).
From our conversation (or the text/topic below), pick the most useful English words and phrases for me: collocations, phrasal verbs, idioms and fixed phrases are better than single words.

Return ONLY a JSON array, no other text, in exactly this format:
[
  {
    "term": "make a decision",
    "type": "collocation",
    "translation": "принять решение",
    "definition": "to choose what to do after thinking about it",
    "example": "We need to [make a decision] by Friday.",
    "exampleRu": "Нам нужно принять решение до пятницы.",
    "collocations": ["reach a decision", "a tough decision"],
    "pattern": "make a decision about sth / to do sth",
    "trap": "Not 'take a decision' (calque of «принять решение»)",
    "tags": ["work"]
  }
]

Rules:
- "type" is one of: collocation, phrasal-verb, idiom, phrase, word.
- "example" is one natural sentence; put the target words exactly as used in the sentence inside [square brackets], once.
- "translation" and "exampleRu" are in Russian; everything else in English.
- "trap" is a typical mistake Russian speakers make with it, or "" if none.
- Use sth / sb for placeholders, e.g. "put sth off".

Topic or text:
`;

export interface ParseResult {
  items: ItemContent[];
  skipped: number;
}

/** Finds the outermost JSON array or object inside any text (AI replies often wrap it in prose or ```json fences). */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const starts = ['[', '{'].map((c) => body.indexOf(c)).filter((i) => i >= 0);
  if (!starts.length) return undefined;
  const start = Math.min(...starts);
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  if (end <= start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * Accepts a JSON array/object (from an AI chat or an export) or plain lines like
 * "make a decision - принять решение" or "term | translation | example".
 */
export function parseImport(text: string): ParseResult {
  const json = extractJson(text);
  if (json !== undefined) {
    const list = Array.isArray(json)
      ? json
      : Array.isArray((json as { items?: unknown[] }).items)
        ? (json as { items: unknown[] }).items
        : [json];
    const items = list.map(toContent).filter((x): x is ItemContent => !!x);
    return { items, skipped: list.length - items.length };
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: ItemContent[] = [];
  let skipped = 0;
  for (const line of lines) {
    const parts = line.includes('|') || line.includes('\t')
      ? line.split(/\s*[|\t]\s*/)
      : line.split(/\s+[—–-]\s+|\s*[—–]\s*/);
    const [term, translation, example, exampleRu] = parts.map((p) => p?.trim());
    const content = toContent({ term, translation, example, exampleRu });
    if (content) items.push(content);
    else skipped++;
  }
  return { items, skipped };
}
