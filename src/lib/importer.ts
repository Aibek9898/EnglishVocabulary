import { toContent } from './content';
import type { ItemContent } from './types';

export const AI_PROMPT = `You are helping me build my English vocabulary. My level: Upper-Intermediate (B2). My native language: Russian.

From our conversation above (or from the topic or text at the end), choose 8 to 15 of the most useful English items for me. Prefer collocations, phrasal verbs, fixed phrases and idioms that people really use in everyday life and at work. Skip words I obviously know already. If I made mistakes in my English in this chat, add the correct phrases too, with the tag "my-mistakes".

Reply with ONE \`\`\`json code block and nothing else, in exactly this format:
[
  {
    "term": "make a mistake",
    "type": "collocation",
    "translation": "сделать ошибку, ошибиться",
    "definition": "to do something wrong without meaning to",
    "example": "I [made a mistake] in the report, so I sent a new version.",
    "exampleRu": "Я ошибся в отчёте, поэтому отправил новую версию.",
    "collocations": ["a big mistake", "by mistake"],
    "pattern": "make a mistake (in sth)",
    "trap": "Not 'do a mistake' (calque of «сделать ошибку»).",
    "wrong": ["did a mistake"],
    "tags": ["everyday"]
  }
]

Rules:
- "type" is one of: collocation, phrasal-verb, idiom, phrase, word.
- "definition": simple English, at most 12 words, and it must NOT contain the term itself.
- "example": one natural sentence of at most 15 words about everyday life or work. Put the target, exactly as used in the sentence, inside [square brackets] once.
- "translation" and "exampleRu": natural Russian, not word for word. Everything else in English.
- "collocations": 1 to 3 other common combinations, or [].
- "pattern": the grammar around it, e.g. "look forward to + -ing", or "".
- "trap": the typical mistake Russian speakers make with it, in one short sentence, or "".
- "wrong": 0 to 2 typical wrong versions in the same form as the bracketed text (they must be wrong in both British and American English), or [].
- "tags": 1 or 2 of: work, travel, money, health, feelings, opinions, everyday, relationships, study, tech, food, home, my-mistakes.
- Use sth / sb for placeholders in "term", e.g. "put sth off".

Topic or text:
`;

export interface ParseResult {
  items: ItemContent[];
  skipped: number;
}

/** AI chats sometimes add trailing commas or curly quotes that break JSON. */
function repairJson(text: string): string {
  return text
    .replace(/[\u201C\u201D\u201E](?=\s*[:,\]}])|(?<=[[{,:]\s*)[\u201C\u201D\u201E]/g, '"')
    .replace(/,\s*([\]}])/g, '$1');
}

/** Finds the outermost JSON array or object inside any text (AI replies often wrap it in prose or ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const starts = ['[', '{'].map((c) => body.indexOf(c)).filter((i) => i >= 0);
  if (!starts.length) return undefined;
  const start = Math.min(...starts);
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  if (end <= start) return undefined;
  const raw = body.slice(start, end + 1);
  for (const candidate of [raw, repairJson(raw)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the repaired version next
    }
  }
  return undefined;
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
