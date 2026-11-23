/**
 * "New lesson": the learner uploads a word list (Excel, CSV or pasted text),
 * the AI teacher fills in everything a card needs (translation, explanation,
 * examples, IPA, typical mistakes), the learner checks it and adds it as a
 * dated lesson. Lessons work like the course packs: they come first, and while
 * one has unlearned words only its words are offered as new.
 */
import { unzipSync } from 'fflate';
import { chat, type ActiveAi } from './ai';
import { toContent } from './content';
import { extractJson } from './importer';
import type { ItemContent } from './types';

/* ============ reading the list ============ */

export class ListError extends Error {}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m),
  );

/** All text of <t> runs inside a piece of XML (shared strings can be split into runs). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');

/** "B" → 1, "AA" → 26. */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Reads the first sheet of an .xlsx file into rows of cell text. */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ListError("This file can't be opened. In Excel, use File → Save As → Excel Workbook (.xlsx) or CSV.");
  }
  const read = (name: string) => (files[name] ? new TextDecoder().decode(files[name]) : '');
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  // The first sheet in the workbook's order, through its relationship id.
  let sheet = 'xl/worksheets/sheet1.xml';
  const first = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(read('xl/workbook.xml'))?.[1];
  if (first) {
    const rel = new RegExp(`<Relationship\\b[^>]*Id="${first}"[^>]*>`).exec(read('xl/_rels/workbook.xml.rels'))?.[0];
    const target = rel && /Target="([^"]+)"/.exec(rel)?.[1];
    if (target) sheet = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const xml = read(sheet);
  if (!xml) throw new ListError("I couldn't find a sheet in this file.");

  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = textOf(body);
      else if (v !== undefined) text = unxml(v);
      cells[ref ? colIndex(ref) : cells.length] = text.trim();
    }
    rows.push(Array.from(cells, (x) => x ?? ''));
  }
  return rows;
}

/** CSV with commas or semicolons (Excel in Russian uses ";"), quotes allowed. */
export function readCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = firstLine.includes('\t') ? '\t' : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/** Pasted text: one word per line; "word - перевод" or tab-separated columns are kept as columns. */
export function readPasted(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.includes('\t') ? l.split('\t') : l.includes('|') ? l.split('|') : l.split(/\s+[—–-]\s+/)).map((c) => c.trim()));
}

export async function readListFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) throw new ListError('This is an old Excel file (.xls). In Excel, use File → Save As → Excel Workbook (.xlsx).');
  if (name.endsWith('.xlsx')) return readXlsx(new Uint8Array(await file.arrayBuffer()));
  if (name.endsWith('.csv') || name.endsWith('.tsv')) return readCsv(await file.text());
  return readPasted(await file.text());
}

/* ============ rows → words ============ */

export interface ListEntry {
  term: string;
  /** What the list already says about it (translation, IPA, an example): the AI keeps it. */
  given: { translation?: string; ipa?: string; example?: string; note?: string };
}

const HEADERS: [keyof ListEntry['given'] | 'term', RegExp][] = [
  ['term', /^(word|words|term|phrase|english|en|eng|vocabulary|слово|слова|фраза|английский|выражение)s?$/i],
  ['translation', /^(translation|russian|ru|meaning|перевод|значение|русский)$/i],
  ['ipa', /^(ipa|transcription|pronunciation|транскрипция|произношение)$/i],
  ['example', /^(example|sentence|пример|предложение)$/i],
];

const looksLikeIpa = (s: string) => /^[/[].*[/\]]$/.test(s) || /[ɪʊəɜɒʌæɑɔθðʃʒŋˈˌː]/.test(s);
const looksRussian = (s: string) => /[а-яё]/i.test(s);

/**
 * Turns sheet rows into words. A header row (Word / Translation / IPA / Example,
 * in English or Russian) is used when there is one; otherwise the first column
 * is the word and the others are recognised by what they look like.
 */
export function rowsToEntries(rows: string[][]): ListEntry[] {
  const clean = rows.map((r) => r.map((c) => (c ?? '').trim())).filter((r) => r.some(Boolean));
  if (!clean.length) return [];
  const header = clean[0].map((c) => HEADERS.find(([, re]) => re.test(c.replace(/[:.]$/, '')))?.[0]);
  const hasHeader = header.includes('term') || header.filter(Boolean).length >= 2;
  const body = hasHeader ? clean.slice(1) : clean;
  const termCol = hasHeader && header.includes('term') ? header.indexOf('term') : clean[0].findIndex((c) => c && !looksRussian(c) && !looksLikeIpa(c));
  const seen = new Set<string>();
  const out: ListEntry[] = [];
  for (const row of body) {
    // Without a header, a row may still have its columns in another order.
    let col = Math.max(0, termCol);
    if (!hasHeader && (!row[col] || looksRussian(row[col]) || looksLikeIpa(row[col]))) col = row.findIndex((c) => c && !looksRussian(c) && !looksLikeIpa(c));
    if (col < 0) continue;
    const term = (row[col] ?? '').replace(/^\d+[.)]\s*/, '').trim();
    if (!term || looksRussian(term) || term.length > 80) continue;
    const key = term.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const given: ListEntry['given'] = {};
    const notes: string[] = [];
    row.forEach((cell, i) => {
      if (i === col || !cell) return;
      const kind = hasHeader ? header[i] : looksLikeIpa(cell) ? 'ipa' : looksRussian(cell) ? 'translation' : undefined;
      if (kind === 'ipa') given.ipa = cell.replace(/^[/[]+|[/\]]+$/g, '');
      else if (kind === 'translation' && !given.translation) given.translation = cell;
      else if (kind === 'example' && !given.example) given.example = cell;
      else notes.push(cell);
    });
    if (notes.length) given.note = notes.join('; ');
    out.push({ term, given });
  }
  return out;
}

/* ============ the AI fills in the cards ============ */

export const LESSON_PROMPT = `You are an experienced English teacher writing vocabulary cards for my lesson. My level: Upper-Intermediate (B2). My native language: Russian.

You get a numbered list of words and phrases from my teacher. Make exactly ONE card for EACH of them, in the same order, and keep the meaning my teacher meant. If a line already has a translation, IPA or example, keep it (you may fix obvious typos).

Reply with ONE JSON object and nothing else: {"items": [...]}, one item per input line, in this format:
{
  "n": 1,
  "term": "drive sb up the wall",
  "ipa": "draɪv ˈsʌmbədi ʌp ðə ˈwɔːl",
  "type": "idiom",
  "translation": "выводить кого-то из себя, доводить до белого каления",
  "definition": "to make someone very annoyed, especially again and again",
  "example": "My neighbour's dog barks all night and it [drives me up the wall].",
  "exampleRu": "Соседская собака лает всю ночь, и это доводит меня до белого каления.",
  "collocations": ["drive me crazy", "get on sb's nerves"],
  "pattern": "sth drives sb up the wall",
  "trap": "It's 'up the wall', not 'on the wall'.",
  "wrong": ["drives me on the wall"],
  "accepted": ["drives me up the wall", "drove me up the wall"],
  "tags": ["feelings"]
}

Rules:
- "n": the number of the input line.
- "term": the word or phrase as given, in dictionary form; use sb / sth for placeholders. Fix only obvious typos.
- "ipa": British IPA of the term, without slashes or brackets.
- "type": one of collocation, phrasal-verb, idiom, phrase, word.
- "translation": natural Russian, 1 to 3 close variants separated by commas.
- "definition": simple English, at most 14 words, WITHOUT the term itself.
- "example": one natural sentence from real everyday life or work, at most 16 words. Put the target, exactly as used in the sentence, inside [square brackets] once.
- "exampleRu": natural Russian translation of the example.
- "collocations": 1 to 3 other common combinations with it, or [].
- "pattern": the grammar around it, e.g. "look forward to + -ing", or "".
- "trap": the typical mistake Russian speakers make with it, one short sentence, or "".
- "wrong": 0 to 2 typical wrong versions in the same form as the bracketed text (wrong in both British and American English), or [].
- "accepted": the forms used in the example and other common forms (tenses, me/you instead of sb), or [].
- "tags": 1 or 2 of: work, travel, money, health, feelings, opinions, everyday, relationships, study, tech, food, home.`;

export function lessonMessage(entries: ListEntry[], from = 1): string {
  return entries
    .map((e, i) => {
      const g = e.given;
      const extra = [g.translation && `translation: ${g.translation}`, g.ipa && `IPA: ${g.ipa}`, g.example && `example: ${g.example}`, g.note && `note: ${g.note}`].filter(Boolean);
      return `${from + i}. ${e.term}${extra.length ? ` (${extra.join('; ')})` : ''}`;
    })
    .join('\n');
}

/** A card is usable when it has the term, a translation and an example with the [target]. */
export function isComplete(c: ItemContent): boolean {
  return !!(c.term && c.translation && c.definition && /\[[^\]]+\]/.test(c.example) && c.exampleRu);
}

/** Matches the AI's cards to the list by "n", falling back to the order and then to the term. */
export function parseLessonAnswer(answer: string, entries: ListEntry[], from = 1): (ItemContent | null)[] {
  const json = extractJson(answer);
  const list: unknown[] = Array.isArray(json) ? json : Array.isArray((json as { items?: unknown[] })?.items) ? (json as { items: unknown[] }).items : [];
  const out: (ItemContent | null)[] = entries.map(() => null);
  const key = (s: string) => s.toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();
  list.forEach((raw, i) => {
    const c = toContent(raw);
    if (!c) return;
    const n = Number((raw as { n?: unknown }).n);
    let at = Number.isInteger(n) && n - from >= 0 && n - from < entries.length ? n - from : -1;
    if (at < 0 || out[at]) at = entries.findIndex((e, j) => !out[j] && key(e.term) === key(c.term));
    if (at < 0 && i < entries.length && !out[i]) at = i;
    if (at < 0) return;
    const given = entries[at].given;
    out[at] = { ...c, ipa: c.ipa || given.ipa, tags: c.tags.length ? c.tags : ['lesson'], source: 'My lesson' };
  });
  return out;
}

const BATCH = 8;

/**
 * Fills in cards for the whole list, a few words per request, two requests at
 * a time. Words the AI got wrong are asked once more on their own.
 */
export async function fillLesson(
  ai: ActiveAi,
  entries: ListEntry[],
  onProgress: (done: number, cards: (ItemContent | null)[]) => void,
  signal?: AbortSignal,
): Promise<(ItemContent | null)[]> {
  const cards: (ItemContent | null)[] = entries.map(() => null);
  let done = 0;
  const ask = async (start: number, part: ListEntry[]) => {
    const answer = await chat(ai, [{ role: 'system', content: LESSON_PROMPT }, { role: 'user', content: lessonMessage(part, start + 1) }], {
      json: true,
      maxTokens: 900 * part.length + 500,
      signal,
    });
    return parseLessonAnswer(answer, part, start + 1);
  };
  const batches: [number, ListEntry[]][] = [];
  for (let i = 0; i < entries.length; i += BATCH) batches.push([i, entries.slice(i, i + BATCH)]);
  let firstError: unknown = null;
  const worker = async () => {
    for (let b = batches.shift(); b; b = batches.shift()) {
      const [start, part] = b;
      try {
        let got = await ask(start, part);
        // Anything missing or half-done gets one more try, word by word.
        for (let j = 0; j < part.length; j++) {
          if (got[j] && isComplete(got[j]!)) continue;
          try {
            const again = (await ask(start + j, [part[j]]))[0];
            if (again && (!got[j] || isComplete(again))) got = got.map((x, k) => (k === j ? again : x));
          } catch (e) {
            if ((e as Error).name === 'AbortError') throw e;
          }
        }
        got.forEach((c, j) => (cards[start + j] = c));
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        firstError ??= e;
      }
      done += part.length;
      onProgress(done, cards.slice());
    }
  };
  await Promise.all([worker(), worker()]);
  if (firstError && cards.every((c) => !c)) throw firstError;
  return cards;
}

/* ============ lessons as packs ============ */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A lesson's pack id. The number after "course-" orders lessons (newest is the
 * current one), so it is the date and time: always after the built-in course
 * packs (course-1 … course-11).
 */
export function lessonDeckId(date: Date, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(now.getHours())}${p(now.getMinutes())}`;
  return `course-${stamp}-my-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export const isMyLesson = (deck: string) => /^course-\d+-my-\d{4}-\d{2}-\d{2}/.test(deck);

/** "Lesson — 23 November" for a lesson made on the site. */
export function myLessonTitle(deck: string): string | null {
  const m = /^course-\d+-my-(\d{4})-(\d{2})-(\d{2})/.exec(deck);
  return m ? `Lesson — ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : null;
}
