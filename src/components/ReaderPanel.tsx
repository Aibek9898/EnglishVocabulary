import { useEffect, useMemo, useState } from 'react';
import { activeAi, AiError, translateInContext, useAi, type InContext } from '../lib/ai';
import { sentenceAround, wordsIn } from '../lib/books';
import { guessType, termKey } from '../lib/content';
import { db, useLive } from '../lib/db';
import { gloss, lookup, type Entry, type Lookup } from '../lib/dictionary';
import { savePhrase } from '../lib/saved';
import { makeItem } from '../lib/srs';
import { EMPTY } from './ItemForm';
import { Icon } from './Icon';
import { Speak } from './Speak';
import { toast } from './ui';

/** Words picked in the reader: a paragraph and a character range in it. */
export interface Pick {
  chapter: number;
  para: number;
  start: number;
  end: number;
}

const aiCache = new Map<string, InContext>();
const MAX_WORDS = 12;

/** The panel at the bottom of the reader: translation of the picked word or phrase, and saving it. */
export function ReaderPanel({ pick, paragraph, bookTitle, onChange, onClose }: { pick: Pick; paragraph: string; bookTitle: string; onChange: (p: Pick) => void; onClose: () => void }) {
  const text = paragraph.slice(pick.start, pick.end);
  const words = useMemo(() => wordsIn(paragraph), [paragraph]);
  const inPick = words.filter((w) => w.start >= pick.start && w.end <= pick.end);
  const single = inPick.length <= 1;
  const sentence = useMemo(() => sentenceAround(paragraph, pick.start, pick.end), [paragraph, pick.start, pick.end]);
  const ai = activeAi(useAi());

  const [found, setFound] = useState<Lookup | null | undefined>(undefined);
  const [parts, setParts] = useState<{ word: string; gloss: string }[] | null>(null);
  const [context, setContext] = useState<InContext | null>(() => aiCache.get(`${text}|${sentence.text}`) ?? null);
  const [aiState, setAiState] = useState<'idle' | 'busy' | string>('idle');
  const [full, setFull] = useState(false);
  const [adding, setAdding] = useState(false);

  // Dictionary: the word itself, or the phrase if the dictionary has it.
  useEffect(() => {
    let live = true;
    lookup(text)
      .then((r) => live && setFound(r))
      .catch(() => live && setFound(null));
    return () => {
      live = false;
    };
  }, [text]);

  // A phrase without a dictionary entry: a quick gloss of each word.
  useEffect(() => {
    if (single || found !== null) return;
    let live = true;
    Promise.all(inPick.slice(0, 8).map(async (w) => ({ word: paragraph.slice(w.start, w.end), gloss: gloss(await lookup(paragraph.slice(w.start, w.end)).catch(() => null), 1) })))
      .then((list) => live && setParts(list))
      .catch(console.error);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, found, text]);

  const askAi = async (signal?: AbortSignal) => {
    if (!ai) return;
    setAiState('busy');
    try {
      const r = await translateInContext(ai, text, sentence.text, signal);
      aiCache.set(`${text}|${sentence.text}`, r);
      setContext(r);
      setAiState('idle');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setAiState(e instanceof AiError ? e.message : "Couldn't get a translation. Try again.");
    }
  };

  // Phrases go to the AI straight away (when a key is set up).
  useEffect(() => {
    if (single || context || !ai || inPick.length > MAX_WORDS) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => askAi(ctrl.signal), 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, !!ai]);

  const grow = (side: 'left' | 'right') => {
    const first = words.findIndex((w) => w.start >= pick.start);
    const last = words.reduce((n, w, i) => (w.end <= pick.end ? i : n), -1);
    if (side === 'left' && first > 0) onChange({ ...pick, start: words[first - 1].start });
    if (side === 'right' && last >= 0 && last < words.length - 1) onChange({ ...pick, end: words[last + 1].end });
    window.getSelection()?.removeAllRanges();
  };
  const canLeft = words.some((w) => w.end <= pick.start);
  const canRight = words.some((w) => w.start >= pick.end);

  const shown: Entry | undefined = found ? (found.entry.senses.length ? found.entry : (found.base ?? found.entry)) : undefined;

  return (
    <aside className="reader-panel" aria-label={`Translation of ${text}`} aria-live="polite">
      <div className="rp-head">
        <div className="rp-term">
          <span className="rp-text" lang="en">
            {text}
          </span>
          <Speak text={text} small label={`Listen to ${text}`} />
          {single && found?.entry.ipa && <span className="ipa">[{found.entry.ipa}]</span>}
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={22} />
        </button>
      </div>

      <div className="rp-body">
        {context && (
          <div className="rp-ai">
            <p className="rp-translation" lang="ru">
              <Icon name="sparkles" size={18} /> {context.translation}
            </p>
            {context.base && termKey(context.base) !== termKey(text) && (
              <p className="rp-base">
                Learn as: <b lang="en">{context.base}</b>
              </p>
            )}
            {context.note && (
              <p className="muted rp-note" lang="ru">
                {context.note}
              </p>
            )}
          </div>
        )}
        {aiState === 'busy' && (
          <p className="rp-wait muted" role="status">
            <span className="spinner" aria-hidden="true" /> Translating in context…
          </p>
        )}
        {aiState !== 'idle' && aiState !== 'busy' && <p className="rp-error">{aiState}</p>}

        {found === undefined && !context && <p className="muted rp-wait">Looking it up…</p>}

        {found && shown && (
          <div className="rp-dict">
            {found.entry.formOf && (
              <p className="rp-form muted">
                <span lang="en">{found.entry.word}</span>: {found.entry.formOf.relation} <b lang="en">{found.entry.formOf.word}</b>
              </p>
            )}
            {shown !== found.entry && shown.ipa && (
              <p className="rp-form">
                <b lang="en">{shown.word}</b> <span className="ipa">[{shown.ipa}]</span>
              </p>
            )}
            {found.entry.word !== text.toLowerCase() && !found.entry.formOf && (
              <p className="rp-form muted">
                Dictionary form: <b lang="en">{found.entry.word}</b>
              </p>
            )}
            {shown.senses.length > 0 ? (
              <ol className="rp-senses" lang="ru">
                {shown.senses.slice(0, full ? undefined : 4).map((s, i) => (
                  <li key={i}>
                    {s.pos && <span className="rp-pos">{s.pos}</span>} {s.text}
                  </li>
                ))}
              </ol>
            ) : (
              !full && (
                <p className="rp-senses-raw" lang="ru">
                  {shown.lines.map((l) => l.text).join(' ')}
                </p>
              )
            )}
            {full && (
              <div className="rp-full">
                {shown.lines.map((l, i) => (
                  <p key={i} style={{ paddingLeft: `${Math.max(0, l.depth - 1) * 12}px` }}>
                    {l.text}
                  </p>
                ))}
              </div>
            )}
            {(shown.lines.length > 1 || shown.senses.length > 4) && (
              <button type="button" className="link-btn" onClick={() => setFull(!full)}>
                {full ? 'Show less' : 'Full dictionary entry, with examples'}
              </button>
            )}
          </div>
        )}

        {found === null && single && !context && <p className="muted">Not in the dictionary. {ai ? 'Ask the AI below.' : ''}</p>}

        {found === null && !single && !context && parts && (
          <ul className="rp-parts">
            {parts.map((p, i) => (
              <li key={i}>
                <b lang="en">{p.word}</b> <span lang="ru">{p.gloss || '—'}</span>
              </li>
            ))}
          </ul>
        )}

        {!ai && !single && !context && (
          <p className="rp-hint">
            To translate whole phrases, add your AI key in <a href="#/settings">Settings → AI teacher</a>.
          </p>
        )}
        {!single && inPick.length > MAX_WORDS && !context && <p className="rp-hint">That's a long piece. Select up to {MAX_WORDS} words for a translation.</p>}

        {adding && <AddCard text={text} sentence={sentence} found={found ?? null} context={context} bookTitle={bookTitle} onDone={() => setAdding(false)} />}
      </div>

      {!adding && (
        <div className="rp-actions">
          <div className="rp-grow" role="group" aria-label="Add a word to the selection">
            <button type="button" className="small" disabled={!canLeft || inPick.length >= MAX_WORDS} onClick={() => grow('left')} aria-label="Add the word before">
              <Icon name="plus" size={16} />
              <Icon name="left" size={16} />
            </button>
            <button type="button" className="small" disabled={!canRight || inPick.length >= MAX_WORDS} onClick={() => grow('right')} aria-label="Add the word after">
              <Icon name="right" size={16} />
              <Icon name="plus" size={16} />
            </button>
          </div>
          {ai && !context && aiState !== 'busy' && inPick.length <= MAX_WORDS && (
            <button type="button" className="small" onClick={() => askAi()}>
              <Icon name="sparkles" size={16} /> {single ? 'In this sentence' : 'Translate'}
            </button>
          )}
          <button type="button" className="small" onClick={async () => toast((await savePhrase(text)) ? 'Saved to Library → Saved' : 'Already saved', 'bookmark')}>
            <Icon name="bookmark" size={16} /> Save
          </button>
          <button type="button" className="primary small" onClick={() => setAdding(true)}>
            <Icon name="add" size={16} /> {single ? 'Add word' : 'Add phrase'}
          </button>
        </div>
      )}
    </aside>
  );
}

/** A short form to turn the picked words into a card, with the book's sentence as the example. */
function AddCard({
  text,
  sentence,
  found,
  context,
  bookTitle,
  onDone,
}: {
  text: string;
  sentence: { text: string; start: number; end: number };
  found: Lookup | null;
  context: InContext | null;
  bookTitle: string;
  onDone: () => void;
}) {
  const dictWord = found ? (found.entry.senses.length ? found.entry : (found.base ?? found.entry)) : null;
  const [term, setTerm] = useState(context?.base || dictWord?.word || text.toLowerCase());
  const [translation, setTranslation] = useState(context?.translation || gloss(found));
  const terms = useLive(() => db.items.toArray().then((items) => new Set(items.map((i) => termKey(i.term)))), [], new Set<string>());
  const exists = terms.has(termKey(term));
  const example = `${sentence.text.slice(0, sentence.start)}[${sentence.text.slice(sentence.start, sentence.end)}]${sentence.text.slice(sentence.end)}`;

  return (
    <form
      className="rp-add"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = term.trim();
        if (!t || !translation.trim()) return;
        const ipa = dictWord && termKey(dictWord.word) === termKey(t) ? dictWord.ipa : undefined;
        await db.items.add(
          makeItem(
            { ...EMPTY, term: t, ipa, type: guessType(t), translation: translation.trim(), example, exampleRu: context?.sentenceRu ?? '', source: bookTitle, tags: ['reading'] },
            'own',
          ),
        );
        toast(`Added “${t}” to your words`);
        onDone();
      }}
    >
      <label className="field">
        <span>English word or phrase</span>
        <input value={term} onChange={(e) => setTerm(e.target.value)} required autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </label>
      <label className="field">
        <span>Russian translation</span>
        <input value={translation} onChange={(e) => setTranslation(e.target.value)} required lang="ru" />
      </label>
      <p className="rp-example">
        <span className="muted small">Example from the book</span>
        <br />
        {sentence.text.slice(0, sentence.start)}
        <mark>{sentence.text.slice(sentence.start, sentence.end)}</mark>
        {sentence.text.slice(sentence.end)}
      </p>
      {exists && <p className="rp-hint">“{term}” is already in your words. Adding it again makes a second card.</p>}
      <div className="row">
        <button type="button" className="ghost small" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary small">
          <Icon name="check" size={16} /> Add card
        </button>
      </div>
    </form>
  );
}
