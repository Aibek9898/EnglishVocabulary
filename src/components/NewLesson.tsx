import { useEffect, useRef, useState } from 'react';
import { activeAi, AiError, useAi } from '../lib/ai';
import { termKey } from '../lib/content';
import { db, useLive } from '../lib/db';
import { addContents } from '../lib/decks';
import { fillLesson, isComplete, lessonDeckId, ListError, myLessonTitle, readListFile, readPasted, rowsToEntries, type ListEntry } from '../lib/lessonImport';
import type { ItemContent } from '../lib/types';
import { Icon } from './Icon';
import { ItemCard } from './ItemCard';
import { ItemForm } from './ItemForm';
import { Sheet, toast } from './ui';

/** Kept on this device while a lesson is being made, so leaving the page loses nothing. */
const DRAFT_KEY = 'lessonDraft';

interface Draft {
  date: string;
  entries: ListEntry[];
  cards: (ItemContent | null)[];
  /** Indexes left out by the learner. */
  skip: number[];
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Add → New lesson: a word list in, a dated lesson with full cards out. */
export function NewLesson() {
  const config = useAi();
  const ai = activeAi(config);
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [filling, setFilling] = useState<{ done: number; total: number } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [added, setAdded] = useState<{ count: number; title: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const library = useLive(async () => new Set((await db.items.toArray()).filter((i) => i.level > 0).map((i) => termKey(i.term))), [], new Set<string>());

  useEffect(() => {
    db.kv.get(DRAFT_KEY).then((r) => setDraft((r?.value as Draft | undefined) ?? null));
    return () => abort.current?.abort();
  }, []);

  const save = (d: Draft | null) => {
    setDraft(d);
    if (d) db.kv.put({ key: DRAFT_KEY, value: d });
    else db.kv.delete(DRAFT_KEY);
  };

  const start = (rows: string[][]) => {
    const entries = rowsToEntries(rows);
    if (!entries.length) {
      setError("I couldn't find English words in this list. Put one word or phrase per row, in the first column.");
      return;
    }
    setError('');
    save({ date: today(), entries, cards: entries.map(() => null), skip: [] });
  };

  const fill = async (d: Draft, only?: number[]) => {
    if (!ai) return;
    const todo = (only ?? d.entries.map((_, i) => i)).filter((i) => !d.skip.includes(i));
    if (!todo.length) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError('');
    setFilling({ done: 0, total: todo.length });
    let cards = d.cards.slice();
    try {
      const got = await fillLesson(
        ai,
        todo.map((i) => d.entries[i]),
        (done, part) => {
          setFilling({ done, total: todo.length });
          part.forEach((c, k) => c && (cards[todo[k]] = c));
          setDraft({ ...d, cards: cards.slice() });
        },
        ctrl.signal,
      );
      got.forEach((c, k) => c && (cards[todo[k]] = c));
      cards = cards.slice();
      save({ ...d, cards });
      const missing = todo.filter((i) => !cards[i]).length;
      if (missing) setError(`The AI couldn't make ${plural(missing, 'card')}. Press Try again on them, or write them yourself.`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof AiError ? e.message : 'Something went wrong. Try again.');
      save({ ...d, cards });
    } finally {
      setFilling(null);
      abort.current = null;
    }
  };

  const add = async (d: Draft) => {
    const date = new Date(`${d.date}T12:00:00`);
    const deck = lessonDeckId(date);
    const list = d.cards.filter((c, i): c is ItemContent => !!c && !d.skip.includes(i));
    const n = await addContents(list, deck, { first: true });
    save(null);
    setAdded({ count: n, title: myLessonTitle(deck) ?? 'your lesson' });
  };

  if (draft === undefined) return null;

  if (added) {
    return (
      <div className="card center success-card">
        <span className="empty-icon ok">
          <Icon name="check" size={28} strokeWidth={3} />
        </span>
        <h2>{added.title} is ready</h2>
        <p className="muted">
          {plural(added.count, 'word')} added. New words now come from this lesson first, at your daily pace. Reviews of older words go on as usual.
        </p>
        <div className="row center">
          <a className="button primary" href="#/today">
            Start the lesson
          </a>
          <button type="button" onClick={() => setAdded(null)}>
            Make another lesson
          </button>
        </div>
      </div>
    );
  }

  /* ---------- step 1: the list ---------- */
  if (!draft) {
    return (
      <>
        <div className="card">
          <h3>
            <span className="step-num">1</span>Your word list
          </h3>
          <p className="muted small">
            An Excel file with one word or phrase per row (first column). If it has a translation, transcription or example, they are kept. You can also paste the list.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => file.current?.click()}>
              <Icon name="upload" /> Upload Excel or CSV
            </button>
            <input
              ref={file}
              type="file"
              accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
              hidden
              aria-label="Word list file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  start(await readListFile(f));
                } catch (err) {
                  setError(err instanceof ListError ? err.message : "Couldn't read this file.");
                }
              }}
            />
          </div>
          <label className="field">
            <span>…or paste it here</span>
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'drive sb up the wall\nbe over the moon - быть на седьмом небе\nlisten in on'} />
          </label>
          <button type="button" onClick={() => start(readPasted(text))} disabled={!text.trim()}>
            Use this list
          </button>
          {error && (
            <p className="hint-line" role="alert">
              {error}
            </p>
          )}
        </div>
      </>
    );
  }

  const kept = draft.entries.map((_, i) => i).filter((i) => !draft.skip.includes(i));
  const ready = kept.filter((i) => draft.cards[i]);
  const empty = kept.filter((i) => !draft.cards[i]);
  const known = (i: number) => library.has(termKey(draft.cards[i]?.term ?? draft.entries[i].term));
  const anyFilled = draft.cards.some(Boolean);

  return (
    <>
      <div className="card">
        <h3>
          <span className="step-num">1</span>
          {plural(kept.length, 'word')} in your list
        </h3>
        <label className="field lesson-date">
          <span>Lesson date</span>
          <input type="date" value={draft.date} onChange={(e) => e.target.value && save({ ...draft, date: e.target.value })} />
        </label>
        <p className="muted small">It will be called “{myLessonTitle(lessonDeckId(new Date(`${draft.date}T12:00:00`)))}”.</p>
        {!anyFilled && (
          <ul className="lesson-terms">
            {draft.entries.map((e, i) => (
              <li key={i} className={draft.skip.includes(i) ? 'skipped' : ''}>
                <span>
                  {e.term}
                  {e.given.translation && (
                    <span className="muted" lang="ru">
                      {' '}
                      — {e.given.translation}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={draft.skip.includes(i) ? `Put ${e.term} back` : `Leave out ${e.term}`}
                  onClick={() => save({ ...draft, skip: draft.skip.includes(i) ? draft.skip.filter((x) => x !== i) : [...draft.skip, i] })}
                >
                  <Icon name={draft.skip.includes(i) ? 'reset' : 'x'} size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button type="button" className="ghost" onClick={() => !filling && save(null)} disabled={!!filling}>
            Start over
          </button>
        </div>
      </div>

      <div className="card">
        <h3>
          <span className="step-num">2</span>The AI teacher fills in the cards
        </h3>
        {!ai ? (
          <p className="hint-line">
            Connect an AI teacher first: <a href="#/settings?section=ai">Settings → AI teacher</a>. It writes the translation, explanation, examples and
            pronunciation for each word.
          </p>
        ) : filling ? (
          <>
            <p className="muted small" role="status">
              Writing cards: {filling.done} of {filling.total}…
            </p>
            <div className="bar" aria-hidden="true">
              <div className="bar-fill l3" style={{ width: `${Math.max(4, (filling.done / filling.total) * 100)}%` }} />
            </div>
            <button type="button" className="ghost" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          </>
        ) : (
          <>
            <p className="muted small">For each word: Russian translation, a simple explanation, a real-life example, IPA, common combinations and the typical mistake.</p>
            {empty.length > 0 && (
              <button type="button" className="primary" onClick={() => fill(draft, empty)}>
                <Icon name="sparkles" /> {anyFilled ? `Fill in the other ${plural(empty.length, 'word')}` : `Make ${plural(empty.length, 'card')}`}
              </button>
            )}
          </>
        )}
        {error && (
          <p className="hint-line" role="alert">
            {error}
          </p>
        )}
      </div>

      {anyFilled && (
        <div className="card">
          <h3>
            <span className="step-num">3</span>Check the cards and add the lesson
          </h3>
          <p className="muted small">Fix anything with Edit, or leave a word out. Nothing is added until you press the button below.</p>
          <ul className="lesson-cards">
            {kept.map((i) => {
              const c = draft.cards[i];
              return (
                <li key={i}>
                  {c ? (
                    <>
                      <ItemCard item={c} compact heading="h3" onEdit={() => setEditing(i)} />
                      {!isComplete(c) && <p className="hint-line small">Something is missing in this card. Check it with Edit.</p>}
                      {known(i) && <span className="chip gold">you already know this one: it won't be added again</span>}
                    </>
                  ) : (
                    <div className="lesson-missing">
                      <b>{draft.entries[i].term}</b>
                      <span className="muted small">{filling ? 'Waiting…' : 'No card yet.'}</span>
                      {!filling && ai && (
                        <button type="button" className="small" onClick={() => fill(draft, [i])}>
                          <Icon name="reset" size={16} /> Try again
                        </button>
                      )}
                      {!filling && (
                        <button type="button" className="small" onClick={() => setEditing(i)}>
                          <Icon name="pen" size={16} /> Write it myself
                        </button>
                      )}
                    </div>
                  )}
                  <button type="button" className="link-btn small" onClick={() => save({ ...draft, skip: [...draft.skip, i] })}>
                    <Icon name="trash" size={16} /> Leave out
                  </button>
                </li>
              );
            })}
          </ul>
          {draft.skip.length > 0 && (
            <p className="muted small">
              {plural(draft.skip.length, 'word')} left out.{' '}
              <button type="button" className="link-btn" onClick={() => save({ ...draft, skip: [] })}>
                Put them back
              </button>
            </p>
          )}
          <button type="button" className="primary block" disabled={!!filling || ready.length === 0} onClick={() => add(draft)}>
            <Icon name="add" /> Add {plural(ready.length, 'word')} as {myLessonTitle(lessonDeckId(new Date(`${draft.date}T12:00:00`)))}
          </button>
          {empty.length > 0 && !filling && <p className="muted small">{plural(empty.length, 'word')} without a card won't be added.</p>}
        </div>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} label="Edit the card">
        {editing !== null && (
          <>
            <h2>{draft.cards[editing] ? 'Edit the card' : 'Write the card'}</h2>
            <ItemForm
              initial={
                draft.cards[editing] ?? {
                  term: draft.entries[editing].term,
                  type: 'collocation',
                  translation: draft.entries[editing].given.translation ?? '',
                  definition: '',
                  example: draft.entries[editing].given.example ?? '',
                  exampleRu: '',
                  collocations: [],
                  pattern: '',
                  trap: '',
                  tags: ['lesson'],
                  ipa: draft.entries[editing].given.ipa,
                  source: 'My lesson',
                }
              }
              submitLabel="Save"
              onCancel={() => setEditing(null)}
              onSubmit={(c) => {
                const cards = draft.cards.slice();
                cards[editing] = { ...draft.cards[editing], ...c, source: 'My lesson' };
                save({ ...draft, cards });
                setEditing(null);
                toast('Card saved');
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
