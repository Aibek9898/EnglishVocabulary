import { unzipSync } from 'fflate';
import { db, newId } from './db';

/**
 * Books for the Reading section. A book is uploaded by the learner (EPUB, PDF
 * or TXT), turned into plain paragraphs here and stored only in this browser
 * (IndexedDB table 'books'): never in backups, sync or the site's code.
 */

export interface Chapter {
  title: string;
  paras: string[];
  /** Indexes of paragraphs that are headings. */
  heads?: number[];
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  format: 'epub' | 'pdf' | 'txt';
  addedAt: number;
  openedAt: number;
  words: number;
  chapters: Chapter[];
  /** Where reading stopped. */
  pos: { chapter: number; para: number };
}

export type ParsedBook = Pick<Book, 'title' | 'author' | 'chapters'>;

const clean = (s: string) => s.replace(/­/g, '').replace(/\s+/g, ' ').trim();
const countWords = (chapters: Chapter[]) => chapters.reduce((n, c) => n + c.paras.reduce((m, p) => m + p.split(' ').length, 0), 0);
const titleFromFile = (name: string) =>
  name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ')
    .trim() || 'Untitled book';

/** Splits a long run of paragraphs into parts of about `size` paragraphs. */
function chunk(paras: string[], title: (n: number) => string, size = 60): Chapter[] {
  const out: Chapter[] = [];
  for (let i = 0; i < paras.length; i += size) out.push({ title: title(out.length + 1), paras: paras.slice(i, i + size) });
  return out;
}

/* ---------- plain text ---------- */

const CHAPTER_LINE = /^(chapter|part|book|section|prologue|epilogue|introduction|conclusion|preface|foreword|afterword)\b.{0,60}$/i;

export function parseTxt(text: string, fileName = 'book.txt'): ParsedBook {
  const normal = text.replace(/\r\n?/g, '\n');
  // Paragraphs are separated by blank lines; without any, every line is one.
  const blocks = /\n\s*\n/.test(normal) ? normal.split(/\n\s*\n/) : normal.split('\n');
  const paras = blocks.map(clean).filter(Boolean);
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;
  for (const p of paras) {
    if (CHAPTER_LINE.test(p) && p.length < 80) {
      current = { title: p, paras: [p], heads: [0] };
      chapters.push(current);
    } else {
      if (!current) {
        current = { title: 'Beginning', paras: [] };
        chapters.push(current);
      }
      current.paras.push(p);
    }
  }
  const usable = chapters.filter((c) => c.paras.length > (c.heads?.length ?? 0));
  const result = usable.length > 1 ? usable : chunk(paras, (n) => `Part ${n}`);
  return { title: titleFromFile(fileName), chapters: result };
}

/* ---------- EPUB ---------- */

const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'dt', 'dd', 'figcaption', 'td', 'th', 'div', 'section', 'article', 'aside', 'ul', 'ol', 'dl', 'table', 'tbody', 'tr', 'header', 'footer', 'main', 'figure', 'body']);
const SKIP = new Set(['script', 'style', 'nav', 'head', 'svg', 'math']);

function localName(el: Element) {
  return el.localName.toLowerCase();
}

/** Paragraphs and headings of one XHTML document, in order. */
export function htmlParagraphs(doc: Document): { paras: string[]; heads: number[] } {
  const paras: string[] = [];
  const heads: number[] = [];
  const walk = (el: Element) => {
    const name = localName(el);
    if (SKIP.has(name)) return;
    const hasBlockChild = Array.from(el.children).some((c) => BLOCK.has(localName(c)));
    if (!hasBlockChild || name === 'p' || /^h[1-6]$/.test(name)) {
      const text = clean(el.textContent ?? '');
      if (text) {
        if (/^h[1-6]$/.test(name)) heads.push(paras.length);
        paras.push(text);
      }
      return;
    }
    // Text sitting directly in a block next to other blocks.
    let loose = '';
    const flush = () => {
      const t = clean(loose);
      if (t) paras.push(t);
      loose = '';
    };
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 1 && BLOCK.has(localName(node as Element))) {
        flush();
        walk(node as Element);
      } else if (node.nodeType === 1 && SKIP.has(localName(node as Element))) {
        continue;
      } else loose += node.textContent ?? '';
    }
    flush();
  };
  const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
  if (body) walk(body);
  return { paras, heads };
}

function resolvePath(base: string, href: string): string {
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '').concat(decodeURIComponent(href.split('#')[0])).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

function parseXml(text: string, type: DOMParserSupportedType = 'application/xhtml+xml'): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, type);
  if (doc.getElementsByTagName('parsererror').length) return parser.parseFromString(text, 'text/html');
  return doc;
}

const byTag = (root: Document | Element, tag: string) => Array.from(root.getElementsByTagNameNS('*', tag));

export function parseEpub(bytes: Uint8Array, fileName = 'book.epub'): ParsedBook {
  const files = unzipSync(bytes);
  const text = (path: string) => {
    const f = files[path] ?? files[Object.keys(files).find((k) => k.toLowerCase() === path.toLowerCase()) ?? ''];
    return f ? new TextDecoder().decode(f) : null;
  };
  const container = text('META-INF/container.xml');
  if (!container) throw new Error("This EPUB file looks damaged: it has no table of contents file.");
  const opfPath = byTag(parseXml(container, 'application/xml'), 'rootfile')[0]?.getAttribute('full-path');
  const opfText = opfPath && text(opfPath);
  if (!opfPath || !opfText) throw new Error("This EPUB file looks damaged: its contents list is missing.");
  const opf = parseXml(opfText, 'application/xml');

  const title = clean(byTag(opf, 'title')[0]?.textContent ?? '') || titleFromFile(fileName);
  const author = clean(byTag(opf, 'creator')[0]?.textContent ?? '') || undefined;

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of byTag(opf, 'item')) {
    manifest.set(item.getAttribute('id') ?? '', {
      href: resolvePath(opfPath, item.getAttribute('href') ?? ''),
      type: item.getAttribute('media-type') ?? '',
      props: item.getAttribute('properties') ?? '',
    });
  }

  // Chapter names from the table of contents (EPUB 3 nav, or EPUB 2 NCX).
  const tocTitles = new Map<string, string>();
  const nav = [...manifest.values()].find((m) => m.props.split(' ').includes('nav'));
  const navText = nav && text(nav.href);
  if (nav && navText) {
    const doc = parseXml(navText);
    const tocNav = byTag(doc, 'nav').find((n) => (n.getAttribute('epub:type') ?? n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '').includes('toc')) ?? byTag(doc, 'nav')[0];
    for (const a of tocNav ? byTag(tocNav, 'a') : []) {
      const href = a.getAttribute('href');
      const label = clean(a.textContent ?? '');
      if (href && label) {
        const path = resolvePath(nav.href, href);
        if (!tocTitles.has(path)) tocTitles.set(path, label);
      }
    }
  }
  const ncxId = byTag(opf, 'spine')[0]?.getAttribute('toc');
  const ncx = ncxId ? manifest.get(ncxId) : [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
  const ncxText = ncx && !tocTitles.size && text(ncx.href);
  if (ncx && ncxText) {
    for (const point of byTag(parseXml(ncxText, 'application/xml'), 'navPoint')) {
      const label = clean(byTag(point, 'text')[0]?.textContent ?? '');
      const src = byTag(point, 'content')[0]?.getAttribute('src');
      if (label && src) {
        const path = resolvePath(ncx.href, src);
        if (!tocTitles.has(path)) tocTitles.set(path, label);
      }
    }
  }

  const chapters: Chapter[] = [];
  for (const ref of byTag(opf, 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item || !/html|xml/.test(item.type)) continue;
    const html = text(item.href);
    if (!html) continue;
    const { paras, heads } = htmlParagraphs(parseXml(html));
    if (!paras.length) continue;
    const named = tocTitles.get(item.href);
    const heading = heads.length ? paras[heads[0]] : undefined;
    const prev = chapters[chapters.length - 1];
    if (!named && !heading && prev) {
      // A chapter split over several files: keep it as one.
      const offset = prev.paras.length;
      prev.paras.push(...paras);
      prev.heads = [...(prev.heads ?? []), ...heads.map((h) => h + offset)];
      continue;
    }
    chapters.push({ title: named ?? heading ?? `Section ${chapters.length + 1}`, paras, heads: heads.length ? heads : undefined });
  }
  if (!chapters.length) throw new Error('No text found in this EPUB. It may contain only images.');
  return { title, author, chapters };
}

/* ---------- PDF ---------- */

interface Line {
  text: string;
  y: number;
  x: number;
  h: number;
}

/** Joins a page's text lines into paragraphs: a bigger gap or a short line ends one. */
export function linesToParagraphs(lines: Line[]): string[] {
  const out: string[] = [];
  if (!lines.length) return out;
  const gaps = lines.slice(1).map((l, i) => Math.abs(lines[i].y - l.y)).filter((g) => g > 0).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)] ?? 12;
  const lengths = lines.map((l) => l.text.length).sort((a, b) => a - b);
  const full = lengths[Math.floor(lengths.length * 0.8)] ?? 60;
  let current = '';
  lines.forEach((line, i) => {
    const t = line.text.trim();
    if (!t) return;
    if (current.endsWith('-') && /^[a-z]/.test(t)) current = current.slice(0, -1) + t;
    else current = current ? `${current} ${t}` : t;
    const next = lines[i + 1];
    const bigGap = next && Math.abs(line.y - next.y) > gap * 1.45;
    const short = t.length < full * 0.7 && /[.!?:"”’)]$/.test(t);
    const indented = next && next.x > line.x + 8 && /[.!?:"”’)]$/.test(t);
    if (!next || bigGap || short || indented) {
      out.push(clean(current));
      current = '';
    }
  });
  return out;
}

export async function parsePdf(bytes: Uint8Array, fileName = 'book.pdf', onProgress?: (done: number, total: number) => void): Promise<ParsedBook> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const meta = (await pdf.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined;

  const pages: string[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const lines: Line[] = [];
    let cur: Line | null = null;
    for (const raw of content.items) {
      if (!('str' in raw)) continue;
      const [, , , , x, y] = raw.transform as number[];
      if (!cur || Math.abs(cur.y - y) > (raw.height || 10) * 0.5) {
        if (cur) lines.push(cur);
        cur = { text: raw.str, y, x, h: raw.height };
      } else cur.text += raw.str;
      if (raw.hasEOL && cur) {
        lines.push(cur);
        cur = null;
      }
    }
    if (cur) lines.push(cur);
    // Page numbers and empty lines are not part of the text.
    pages.push(linesToParagraphs(lines.filter((l) => l.text.trim() && !/^\s*\d{1,4}\s*$/.test(l.text))));
    onProgress?.(n, pdf.numPages);
  }

  // A paragraph cut by the end of a page continues on the next one.
  const flat: { text: string; page: number }[] = [];
  pages.forEach((paras, page) =>
    paras.forEach((text, i) => {
      const prev = flat[flat.length - 1];
      if (i === 0 && prev && !/[.!?:"”’)]$/.test(prev.text) && /^[a-z]/.test(text)) prev.text += ' ' + text;
      else flat.push({ text, page });
    }),
  );
  if (!flat.length) throw new Error('No text found in this PDF. It may be scanned pages (pictures of text).');

  // Chapters from the PDF's own outline when it has one.
  const starts: { title: string; page: number }[] = [];
  const outline = await pdf.getOutline().catch(() => null);
  for (const o of outline ?? []) {
    try {
      const dest = typeof o.dest === 'string' ? await pdf.getDestination(o.dest) : o.dest;
      if (!dest) continue;
      const page = await pdf.getPageIndex(dest[0] as Parameters<typeof pdf.getPageIndex>[0]);
      starts.push({ title: clean(o.title), page });
    } catch {
      /* an outline entry we can't follow */
    }
  }
  starts.sort((a, b) => a.page - b.page);
  let chapters: Chapter[];
  if (starts.length > 1) {
    chapters = [];
    if (starts[0].page > 0) starts.unshift({ title: 'Beginning', page: 0 });
    starts.forEach((s, i) => {
      const end = starts[i + 1]?.page ?? Infinity;
      const paras = flat.filter((f) => f.page >= s.page && f.page < end).map((f) => f.text);
      if (paras.length) chapters.push({ title: s.title, paras });
    });
  } else {
    chapters = [];
    for (let p = 0; p < pages.length; p += 10) {
      const paras = flat.filter((f) => f.page >= p && f.page < p + 10).map((f) => f.text);
      if (paras.length) chapters.push({ title: `Pages ${p + 1}–${Math.min(p + 10, pages.length)}`, paras });
    }
  }
  return { title: clean(meta?.Title ?? '') || titleFromFile(fileName), author: clean(meta?.Author ?? '') || undefined, chapters };
}

/* ---------- storing ---------- */

export async function importBook(file: File, onProgress?: (done: number, total: number) => void): Promise<Book> {
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed: ParsedBook;
  let format: Book['format'];
  if (name.endsWith('.epub') || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    parsed = parseEpub(bytes, file.name);
    format = 'epub';
  } else if (name.endsWith('.pdf') || new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') {
    parsed = await parsePdf(bytes, file.name, onProgress);
    format = 'pdf';
  } else if (name.endsWith('.txt') || file.type.startsWith('text/')) {
    parsed = parseTxt(new TextDecoder().decode(bytes), file.name);
    format = 'txt';
  } else {
    throw new Error('Pick an EPUB, PDF or TXT file.');
  }
  const now = Date.now();
  const book: Book = { id: newId(), ...parsed, format, addedAt: now, openedAt: now, words: countWords(parsed.chapters), pos: { chapter: 0, para: 0 } };
  await db.books.add(book);
  return book;
}

/** Reading progress, 0..1, by paragraphs. */
export function progressOf(book: Pick<Book, 'chapters' | 'pos'>): number {
  const total = book.chapters.reduce((n, c) => n + c.paras.length, 0);
  if (!total) return 0;
  const before = book.chapters.slice(0, book.pos.chapter).reduce((n, c) => n + c.paras.length, 0) + book.pos.para;
  return Math.min(1, before / total);
}

export async function savePosition(id: string, pos: Book['pos']) {
  await db.books.update(id, { pos, openedAt: Date.now() });
}

/* ---------- words in a paragraph ---------- */

const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/** The word at a character offset, or null when the offset is on a space or punctuation. */
export function wordAt(text: string, offset: number): { start: number; end: number } | null {
  return wordsIn(text).find((w) => offset >= w.start && offset <= w.end) ?? null;
}

/** All word positions in a paragraph. */
export function wordsIn(text: string): { start: number; end: number }[] {
  return Array.from(text.matchAll(WORD), (m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

/** Grows a range to whole words, e.g. a selection "ome up wi" → "come up with". */
export function snapToWords(text: string, start: number, end: number): { start: number; end: number } | null {
  const words = wordsIn(text).filter((w) => w.end > start && w.start < end);
  if (!words.length) return null;
  return { start: words[0].start, end: words[words.length - 1].end };
}

/** The sentence around a range, with that range's position inside it. */
export function sentenceAround(text: string, start: number, end: number): { text: string; start: number; end: number } {
  const before = text.slice(0, start);
  const m = [...before.matchAll(/[.!?…]["”’)]*\s+/g)].pop();
  let s = m ? (m.index ?? 0) + m[0].length : 0;
  const rest = text.slice(end).match(/^.*?[.!?…]["”’)]*(?=\s|$)/);
  let e = rest ? end + rest[0].length : text.length;
  let cutStart = '';
  let cutEnd = '';
  // Very long sentences: keep about 160 characters around the words.
  if (start - s > 160) {
    s = text.lastIndexOf(' ', start - 120) + 1;
    cutStart = '…';
  }
  if (e - end > 160) {
    e = text.indexOf(' ', end + 120);
    if (e < 0) e = text.length;
    else cutEnd = '…';
  }
  return { text: cutStart + text.slice(s, e) + cutEnd, start: start - s + cutStart.length, end: end - s + cutStart.length };
}
