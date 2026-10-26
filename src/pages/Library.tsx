import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { ItemCard } from '../components/ItemCard';
import { ItemForm } from '../components/ItemForm';
import { Empty, LevelMeter, Sheet, toast, usePageTitle } from '../components/ui';
import { sentenceUsesTerm } from '../lib/cloze';
import { db, useLive } from '../lib/db';
import { COURSE_DECKS, DECKS, addDeck } from '../lib/decks';
import { addSentence, resetItem } from '../lib/srs';
import { LEVEL_NAMES, type Deck, type Item } from '../lib/types';

export function Library({ tab }: { tab: string }) {
  usePageTitle('Library');
  return (
    <section className="page">
      <div className="page-head">
        <h1>Library</h1>
        <a className="button small" href="#/add">
          <Icon name="plus" size={18} /> Add
        </a>
      </div>
      <nav className="tabs" aria-label="Library sections">
        <a className="tab" href="#/library" aria-current={tab !== 'packs' ? 'page' : undefined}>
          Words I'm learning
        </a>
        <a className="tab" href="#/library?tab=packs" aria-current={tab === 'packs' ? 'page' : undefined}>
          Packs
        </a>
      </nav>
      {tab === 'packs' ? <Packs /> : <Words />}
    </section>
  );
}

const DAY = 86_400_000;

function dueLabel(item: Item): { text: string; due: boolean } {
  if (item.suspended) return { text: 'Paused', due: false };
  if (item.level === 0) return { text: 'Not started', due: false };
  const days = Math.ceil((+new Date(item.card.due) - Date.now()) / DAY);
  if (days <= 0) return { text: 'Review now', due: true };
  if (days === 1) return { text: 'Tomorrow', due: false };
  if (days < 45) return { text: `in ${days} days`, due: false };
  return { text: `in ${Math.round(days / 30)} months`, due: false };
}

const FILTERS = [
  { id: 'all', label: 'All', test: (_: Item) => true },
  { id: 'due', label: 'Review now', test: (i: Item) => !i.suspended && i.level > 0 && +new Date(i.card.due) <= Date.now() },
  { id: 'new', label: 'Not started', test: (i: Item) => i.level === 0 && !i.suspended },
  { id: 'learning', label: 'Learning', test: (i: Item) => i.level >= 1 && i.level <= 3 },
  { id: 'use', label: 'Can use', test: (i: Item) => i.level >= 4 },
  { id: 'course', label: 'My course', test: (i: Item) => COURSE_DECKS.has(i.deck) },
  { id: 'own', label: 'My own', test: (i: Item) => i.deck === 'own' },
  { id: 'paused', label: 'Paused', test: (i: Item) => i.suspended },
];

function Words() {
  const items = useLive(() => db.items.toArray(), [], null as Item[] | null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    const test = FILTERS.find((f) => f.id === filter)?.test ?? (() => true);
    return items
      .filter(test)
      .filter((i) => !needle || i.term.toLowerCase().includes(needle) || i.translation.toLowerCase().includes(needle) || i.tags.some((t) => t.includes(needle)))
      .sort((a, b) => a.term.localeCompare(b.term));
  }, [items, q, filter]);

  if (!items) return null;
  if (items.length === 0) {
    return (
      <Empty icon="book" title="Your library is empty">
        <p className="muted">Add a ready-made pack or your own words to get started.</p>
        <div className="row center">
          <a className="button primary" href="#/library?tab=packs">
            Browse packs
          </a>
          <a className="button" href="#/add">
            Add my own words
          </a>
        </div>
      </Empty>
    );
  }

  const openItem = items.find((i) => i.id === open);

  return (
    <>
      <div className="input-icon search">
        <Icon name="search" size={20} />
        <input type="search" placeholder="Search words, translations, tags" aria-label="Search your words" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
      </div>
      <div className="filter-chips" role="group" aria-label="Show">
        {FILTERS.map((f) => {
          const n = items.filter(f.test).length;
          if (n === 0 && f.id !== 'all' && f.id !== filter) return null;
          return (
            <button key={f.id} type="button" className="filter-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="muted">{n}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <Empty icon="searchX" title="Nothing found">
          <p className="muted">Try another word, or clear the filter.</p>
        </Empty>
      ) : (
        <ul className="word-list">
          {shown.map((i) => {
            const due = dueLabel(i);
            return (
              <li key={i.id}>
                <button type="button" className={i.suspended ? 'word-row paused' : 'word-row'} onClick={() => setOpen(i.id)}>
                  <span className="word-term">{i.term}</span>
                  <span className="word-tr" lang="ru">
                    {i.translation}
                  </span>
                  <span className="word-side">
                    <LevelMeter level={i.level} />
                    <span className={due.due ? 'word-due due' : 'word-due'}>{due.text}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Sheet open={!!openItem} onClose={() => setOpen(null)} label={openItem?.term ?? 'Word'}>
        {openItem && <ItemDetails key={openItem.id} item={openItem} onClose={() => setOpen(null)} />}
      </Sheet>
    </>
  );
}

function statusLine(item: Item): string {
  const parts: string[] = [LEVEL_NAMES[item.level]];
  if (item.level > 0 && item.level < 5) parts.push(`step ${item.level} of 5`);
  if (item.suspended) parts.push('paused');
  else if (item.level > 0) {
    const d = dueLabel(item);
    parts.push(d.due ? 'review now' : `next review ${d.text}`);
  }
  return parts.join(' · ');
}

function ItemDetails({ item, onClose }: { item: Item; onClose: () => void }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'write' | 'delete' | 'reset'>('view');
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState('');

  if (mode === 'edit') {
    return (
      <>
        <h2>Edit</h2>
        <ItemForm
          initial={item}
          submitLabel="Save changes"
          onCancel={() => setMode('view')}
          onSubmit={async (c) => {
            await db.items.update(item.id, { ...c } as Partial<Item>);
            toast('Saved');
            setMode('view');
          }}
        />
      </>
    );
  }

  if (mode === 'delete' || mode === 'reset') {
    const del = mode === 'delete';
    return (
      <>
        <h2>{del ? `Delete “${item.term}”?` : 'Start over?'}</h2>
        <p>{del ? 'It will be removed with all its progress.' : 'Its progress goes back to zero and it comes back as a new word.'}</p>
        <div className="row">
          <button type="button" className="ghost" onClick={() => setMode('view')}>
            Cancel
          </button>
          <button
            type="button"
            className={del ? 'danger' : 'primary'}
            onClick={async () => {
              if (del) {
                await db.items.delete(item.id);
                toast('Deleted', 'trash');
                onClose();
              } else {
                await resetItem(item.id);
                toast('Progress reset', 'reset');
                setMode('view');
              }
            }}
          >
            {del ? 'Delete' : 'Start over'}
          </button>
        </div>
      </>
    );
  }

  const uses = text.trim() && sentenceUsesTerm(text, item.term);

  return (
    <>
      <ItemCard item={item} />
      <p className="status-line">
        <LevelMeter level={item.level} /> {statusLine(item)}
      </p>
      {item.source && <p className="muted small">From: {item.source}</p>}

      {item.mySentences.length > 0 && (
        <div className="my-sentences">
          <h3>My sentences</h3>
          <ul>
            {item.mySentences.map((s) => (
              <li key={s.at}>{s.text}</li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'write' && (
        <div className="write-box">
          <label className="field">
            <span>Your sentence with “{item.term}”</span>
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write about your work, your plans or your week." autoFocus />
          </label>
          {text.trim() && !uses && <p className="hint-line">I can't find “{item.term}” in it yet. You can still save it.</p>}
        </div>
      )}

      <div className="sheet-actions">
        {mode === 'write' ? (
          <>
            <button type="button" className="ghost" onClick={() => setMode('view')}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={!text.trim()}
              onClick={async () => {
                await addSentence(item, text.trim());
                setText('');
                setMode('view');
                toast('Sentence saved', 'pen');
              }}
            >
              Save sentence
            </button>
          </>
        ) : (
          <>
            <button type="button" className="primary" onClick={() => setMode('write')}>
              <Icon name="pen" size={18} /> Write a sentence
            </button>
            <button
              type="button"
              onClick={async () => {
                await db.items.update(item.id, { usedInLife: item.usedInLife + 1 });
                toast('Nice! Using it is how it sticks.', 'hand');
              }}
              title="Press when you used it in a real conversation or message"
            >
              <Icon name="hand" size={18} /> I used it{item.usedInLife ? ` (${item.usedInLife})` : ''}
            </button>
            <div className="menu">
              <button type="button" className="icon-btn" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                <Icon name="more" size={22} />
              </button>
              {menu && (
                <div className="menu-list" role="menu">
                  <button type="button" role="menuitem" onClick={() => setMode('edit')}>
                    <Icon name="pen" size={18} /> Edit
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      await db.items.update(item.id, { suspended: !item.suspended });
                      setMenu(false);
                      toast(item.suspended ? 'Back in your reviews' : 'Hidden from reviews', item.suspended ? 'play' : 'pause');
                    }}
                  >
                    <Icon name={item.suspended ? 'play' : 'pause'} size={18} /> {item.suspended ? 'Resume reviews' : 'Hide from reviews'}
                  </button>
                  <button type="button" role="menuitem" onClick={() => setMode('reset')}>
                    <Icon name="reset" size={18} /> Start over
                  </button>
                  <button type="button" role="menuitem" className="danger" onClick={() => setMode('delete')}>
                    <Icon name="trash" size={18} /> Delete
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Packs() {
  const items = useLive(() => db.items.toArray(), [], [] as Item[]);
  const [preview, setPreview] = useState<string | null>(null);
  const course = DECKS.filter((d) => d.course);
  return (
    <div className="stack">
      {course.length > 0 && (
        <>
          <h2 className="pack-group">From my course</h2>
          <p className="muted small">The words from your course, with examples. They come first in your lessons, at your daily pace.</p>
          {course.map((d) => (
            <PackCard key={d.id} deck={d} items={items} preview={preview} setPreview={setPreview} />
          ))}
          <h2 className="pack-group">Ready-made packs</h2>
        </>
      )}
      <p className="muted small">Ready-made Upper-Intermediate phrases. New words from packs come in at your daily pace, never all at once.</p>
      {DECKS.filter((d) => !d.course).map((d) => (
        <PackCard key={d.id} deck={d} items={items} preview={preview} setPreview={setPreview} />
      ))}
    </div>
  );
}

function PackCard({
  deck: d,
  items,
  preview,
  setPreview,
}: {
  deck: Deck;
  items: Item[];
  preview: string | null;
  setPreview: (id: string | null) => void;
}) {
  const added = items.filter((i) => i.deck === d.id).length;
  return (
    <div className="card pack">
      <div className="pack-head">
        <div>
          <h3>{d.title}</h3>
          <p className="muted small">
            {d.description} · {d.items.length} phrases
          </p>
        </div>
        {added > 0 ? (
          <span className="chip ok">
            <Icon name="check" size={14} strokeWidth={3} /> Added
          </span>
        ) : (
          <button
            type="button"
            className="primary small"
            onClick={async () => {
              const n = await addDeck(d);
              toast(n < d.items.length ? `Added ${n} (${d.items.length - n} were already there)` : `Added ${n} phrases`);
            }}
          >
            <Icon name="plus" size={18} /> Add pack
          </button>
        )}
      </div>
      <button type="button" className="link-btn small" aria-expanded={preview === d.id} onClick={() => setPreview(preview === d.id ? null : d.id)}>
        {preview === d.id ? 'Hide phrases' : 'Show phrases'}
      </button>
      {preview === d.id && (
        <ul className="pack-list small">
          {d.items.map((i) => (
            <li key={i.term}>
              <b>{i.term}</b>{' '}
              <span className="muted" lang="ru">
                — {i.translation}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
