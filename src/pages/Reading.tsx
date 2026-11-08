import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import '../reading.css';
import { Icon } from '../components/Icon';
import { ReaderPanel, type Pick } from '../components/ReaderPanel';
import { Empty, Sheet, toast, useFocusMode, usePageTitle } from '../components/ui';
import { importBook, progressOf, savePosition, snapToWords, wordAt, type Book } from '../lib/books';
import { db, useLive } from '../lib/db';

export function Reading({ bookId }: { bookId: string | null }) {
  return bookId ? <Reader id={bookId} /> : <Shelf />;
}

/* ---------- the list of books ---------- */

function Shelf() {
  usePageTitle('Reading');
  const books = useLive(() => db.books.orderBy('openedAt').reverse().toArray(), [], null as Book[] | null);
  const [busy, setBusy] = useState<string | null>(null);
  const [remove, setRemove] = useState<Book | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy('Opening the book…');
    try {
      const book = await importBook(file, (done, total) => setBusy(`Reading page ${done} of ${total}…`));
      toast(`Added “${book.title}”`, 'book');
      location.hash = `#/reading?book=${book.id}`;
    } catch (e) {
      toast((e as Error).message || "Couldn't open this file.", 'alert');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  if (!books) return null;
  return (
    <section className="page">
      <div className="page-head">
        <h1>Reading</h1>
        <button type="button" className="primary small" onClick={() => input.current?.click()} disabled={!!busy}>
          <Icon name="upload" size={18} /> Add a book
        </button>
        <input
          ref={input}
          type="file"
          accept=".epub,.pdf,.txt,application/epub+zip,application/pdf,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
      </div>

      {busy && (
        <div className="card row reading-busy" role="status">
          <span className="spinner" aria-hidden="true" /> {busy}
        </div>
      )}

      {books.length === 0 && !busy ? (
        <Empty icon="book" title="Read books in English">
          <p className="muted">Add a book as an EPUB, PDF or TXT file. Tap any word to see it in Russian, select a few words to get an AI translation, and save new words to learn them.</p>
          <button type="button" className="primary" onClick={() => input.current?.click()}>
            <Icon name="upload" size={18} /> Add a book
          </button>
        </Empty>
      ) : (
        <ul className="book-list">
          {books.map((b) => {
            const pct = Math.round(progressOf(b) * 100);
            return (
              <li key={b.id} className="card book-card">
                <a className="book-open" href={`#/reading?book=${b.id}`}>
                  <span className="book-cover" aria-hidden="true">
                    <Icon name="book" size={26} />
                  </span>
                  <span className="book-info">
                    <span className="book-title">{b.title}</span>
                    {b.author && <span className="book-author">{b.author}</span>}
                    <span className="book-meta">
                      {pct > 0 ? `${pct}% read` : 'Not started'} · {b.chapters.length} chapters · {Math.round(b.words / 1000)}k words
                    </span>
                    <span className="bar" aria-hidden="true">
                      <span className="bar-fill" style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                </a>
                <button type="button" className="icon-btn" aria-label={`Remove ${b.title}`} onClick={() => setRemove(b)}>
                  <Icon name="trash" size={20} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="muted small reading-note">
        <Icon name="lock" size={16} /> Books stay only in this browser on this device. They are not part of backups or sync, so add the book again on another device.
      </p>

      <Sheet open={!!remove} onClose={() => setRemove(null)} label="Remove book">
        <h2>Remove this book?</h2>
        <p>“{remove?.title}” and your place in it will be removed from this device. Words you saved from it stay.</p>
        <div className="row">
          <button type="button" className="ghost" onClick={() => setRemove(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (remove) await db.books.delete(remove.id);
              setRemove(null);
            }}
          >
            Remove
          </button>
        </div>
      </Sheet>
    </section>
  );
}

/* ---------- the reader ---------- */

const SIZES = [16, 18, 20, 22, 25];
const FONT_KEY = 'reader-font';
const TIP_KEY = 'reader-tip-done';

function readPrefs(): { size: number; serif: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(FONT_KEY) ?? '{}') as { size?: number; serif?: boolean };
    return { size: SIZES.includes(v.size ?? 0) ? v.size! : 20, serif: v.serif ?? true };
  } catch {
    return { size: 20, serif: true };
  }
}

function storePrefs(p: { size: number; serif: boolean }) {
  try {
    localStorage.setItem(FONT_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

function tipSeen(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === '1';
  } catch {
    return true;
  }
}

/** The text position under a point on screen. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = d.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

const paraOf = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-i]') ?? null;

/** A text node's offset counted from the start of its paragraph. */
function offsetIn(para: HTMLElement, node: Node, offset: number): number {
  if (node === para) {
    let n = 0;
    for (let i = 0; i < offset && i < para.childNodes.length; i++) n += para.childNodes[i].textContent?.length ?? 0;
    return n;
  }
  const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  let n = 0;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t === node) return n + offset;
    n += t.textContent?.length ?? 0;
  }
  return n;
}

function rangeFor(para: HTMLElement, start: number, end: number): Range | null {
  const text = para.firstChild;
  if (!text || text.nodeType !== 3) return null;
  const r = document.createRange();
  const len = text.textContent?.length ?? 0;
  r.setStart(text, Math.min(start, len));
  r.setEnd(text, Math.min(end, len));
  return r;
}

type HighlightApi = { highlights?: Map<string, unknown> };
declare const Highlight: { new (...ranges: Range[]): unknown } | undefined;

function Reader({ id }: { id: string }) {
  useFocusMode(true);
  const book = useLive(() => db.books.get(id), [id], undefined as Book | undefined | null);
  const [chapter, setChapter] = useState<number | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [toc, setToc] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState(readPrefs);
  const [tip, setTip] = useState(() => !tipSeen());
  const article = useRef<HTMLElement>(null);
  const restored = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  usePageTitle(book?.title ?? 'Reading');

  // Open where reading stopped.
  useEffect(() => {
    if (book && chapter === null) setChapter(Math.min(book.pos.chapter, book.chapters.length - 1));
  }, [book, chapter]);

  useLayoutEffect(() => {
    if (!book || chapter === null || restored.current) return;
    restored.current = true;
    const para = book.pos.chapter === chapter ? book.pos.para : 0;
    const el = article.current?.querySelector<HTMLElement>(`[data-i="${para}"]`);
    if (el && para > 0) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 72);
    else window.scrollTo(0, 0);
  }, [book, chapter]);

  // Remember the first paragraph on screen.
  useEffect(() => {
    if (chapter === null) return;
    const onScroll = () => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const paras = article.current?.querySelectorAll<HTMLElement>('[data-i]') ?? [];
        let para = 0;
        for (const p of paras) {
          if (p.getBoundingClientRect().bottom > 72) {
            para = Number(p.dataset.i);
            break;
          }
        }
        savePosition(id, { chapter, para }).catch(console.error);
      }, 600);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(saveTimer.current);
    };
  }, [id, chapter]);

  // Selecting words with the mouse or the phone's selection handles.
  useEffect(() => {
    if (chapter === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!article.current?.contains(range.commonAncestorContainer)) return;
        const startP = paraOf(range.startContainer);
        if (!startP) return;
        const endP = paraOf(range.endContainer);
        const text = startP.textContent ?? '';
        const start = offsetIn(startP, range.startContainer, range.startOffset);
        const end = endP === startP ? offsetIn(startP, range.endContainer, range.endOffset) : text.length;
        const snapped = snapToWords(text, start, end);
        if (snapped) setPick({ chapter, para: Number(startP.dataset.i), ...snapped });
      }, 450);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      clearTimeout(timer);
    };
  }, [chapter]);

  // Mark the picked words.
  useEffect(() => {
    const api = CSS as unknown as HighlightApi;
    if (!pick || typeof Highlight === 'undefined' || !api.highlights) return;
    const p = article.current?.querySelector<HTMLElement>(`[data-i="${pick.para}"]`);
    const r = p && rangeFor(p, pick.start, pick.end);
    if (!r) return;
    api.highlights.set('reader-pick', new Highlight(r));
    // Keep the words above the panel.
    const rect = r.getBoundingClientRect();
    const panel = document.querySelector('.reader-panel')?.getBoundingClientRect();
    const limit = (panel?.top ?? window.innerHeight * 0.55) - 16;
    const top = (document.querySelector('.reader-bar')?.getBoundingClientRect().bottom ?? 0) + 8;
    if (rect.bottom > limit) window.scrollBy({ top: rect.bottom - limit + 40, behavior: 'smooth' });
    else if (rect.top < top) window.scrollBy({ top: rect.top - top - 40, behavior: 'smooth' });
    return () => {
      api.highlights?.delete('reader-pick');
    };
  }, [pick]);

  if (book === null) {
    return (
      <section className="page">
        <Empty icon="book" title="This book isn't on this device">
          <a className="button" href="#/reading">
            Back to Reading
          </a>
        </Empty>
      </section>
    );
  }
  if (!book || chapter === null) return null;

  const ch = book.chapters[chapter];
  const heads = new Set(ch.heads ?? []);

  const goTo = (n: number) => {
    setPick(null);
    setChapter(n);
    window.scrollTo(0, 0);
    savePosition(id, { chapter: n, para: 0 }).catch(console.error);
  };

  const onTap = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const caret = caretAt(e.clientX, e.clientY);
    const p = caret && paraOf(caret.node);
    if (!caret || !p || !article.current?.contains(p)) return setPick(null);
    const text = p.textContent ?? '';
    const w = wordAt(text, offsetIn(p, caret.node, caret.offset));
    if (!w) return setPick(null);
    setPick({ chapter, para: Number(p.dataset.i), ...w });
    if (tip) {
      setTip(false);
      try {
        localStorage.setItem(TIP_KEY, '1');
      } catch {
        /* private mode */
      }
    }
  };

  const setPref = (p: { size: number; serif: boolean }) => {
    setPrefs(p);
    storePrefs(p);
  };

  return (
    <div className={'reader' + (pick ? ' with-panel' : '')}>
      <header className="reader-bar">
        <a href="#/reading" className="icon-btn" aria-label="Back to your books">
          <Icon name="left" size={24} />
        </a>
        <button type="button" className="reader-where" onClick={() => setToc(true)} aria-label={`Chapter: ${ch.title}. Show all chapters`}>
          <span className="reader-book">{book.title}</span>
          <span className="reader-chapter">{ch.title}</span>
        </button>
        <span className="reader-pct" aria-label="Read so far">
          {Math.round(progressOf(book) * 100)}%
        </span>
        <button type="button" className="icon-btn reader-aa" aria-label="Text size and font" onClick={() => setPrefsOpen(true)}>
          Aa
        </button>
      </header>

      {tip && (
        <p className="reader-tip">
          <Icon name="hand" size={18} /> Tap a word to translate it. Select several words for an AI translation of the phrase.
        </p>
      )}

      <article
        ref={article}
        className={'reader-text' + (prefs.serif ? ' serif' : '')}
        style={{ fontSize: `${prefs.size}px` }}
        lang="en"
        onClick={onTap}
      >
        {ch.paras.map((p, i) =>
          heads.has(i) ? (
            <h2 key={i} data-i={i}>
              {p}
            </h2>
          ) : (
            <p key={i} data-i={i}>
              {p}
            </p>
          ),
        )}
      </article>

      <nav className="reader-pager" aria-label="Chapters">
        <button type="button" className="ghost" disabled={chapter === 0} onClick={() => goTo(chapter - 1)}>
          <Icon name="left" size={20} /> Previous
        </button>
        <span className="muted small">
          {chapter + 1} / {book.chapters.length}
        </span>
        <button type="button" className={chapter < book.chapters.length - 1 ? 'primary' : 'ghost'} disabled={chapter >= book.chapters.length - 1} onClick={() => goTo(chapter + 1)}>
          Next chapter <Icon name="right" size={20} />
        </button>
      </nav>

      {pick && (
        <ReaderPanel
          key={`${pick.chapter}:${pick.para}:${pick.start}:${pick.end}`}
          pick={pick}
          paragraph={ch.paras[pick.para] ?? ''}
          bookTitle={book.title}
          onChange={setPick}
          onClose={() => {
            setPick(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      )}

      <Sheet open={toc} onClose={() => setToc(false)} label="Chapters">
        <h2>Chapters</h2>
        <ol className="toc-list">
          {book.chapters.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                className={'toc-item' + (i === chapter ? ' current' : '')}
                aria-current={i === chapter ? 'true' : undefined}
                onClick={() => {
                  setToc(false);
                  goTo(i);
                }}
              >
                {c.title}
              </button>
            </li>
          ))}
        </ol>
      </Sheet>

      <Sheet open={prefsOpen} onClose={() => setPrefsOpen(false)} label="Text size and font">
        <h2>Text</h2>
        <div className="reader-prefs">
          <span>Size</span>
          <div className="row">
            <button type="button" aria-label="Smaller text" disabled={prefs.size === SIZES[0]} onClick={() => setPref({ ...prefs, size: SIZES[SIZES.indexOf(prefs.size) - 1] })}>
              A−
            </button>
            <button type="button" aria-label="Bigger text" disabled={prefs.size === SIZES[SIZES.length - 1]} onClick={() => setPref({ ...prefs, size: SIZES[SIZES.indexOf(prefs.size) + 1] })}>
              A+
            </button>
          </div>
          <span>Font</span>
          <div className="row">
            <button type="button" className={'serif-sample' + (prefs.serif ? ' primary' : '')} aria-pressed={prefs.serif} onClick={() => setPref({ ...prefs, serif: true })}>
              Book
            </button>
            <button type="button" className={!prefs.serif ? 'primary' : ''} aria-pressed={!prefs.serif} onClick={() => setPref({ ...prefs, serif: false })}>
              Plain
            </button>
          </div>
        </div>
        <p className="reader-sample" style={{ fontSize: `${prefs.size}px`, fontFamily: prefs.serif ? 'var(--serif)' : undefined }}>
          The quick brown fox jumps over the lazy dog.
        </p>
      </Sheet>
    </div>
  );
}
