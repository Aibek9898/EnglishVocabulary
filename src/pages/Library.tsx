import { useMemo, useState } from 'react';
import { ItemCard, LevelDots } from '../components/ItemCard';
import { ItemForm } from '../components/ItemForm';
import { db, useLive } from '../lib/db';
import { DECKS, addDeck } from '../lib/decks';
import { resetItem } from '../lib/srs';
import { LEVEL_NAMES, type Item } from '../lib/types';

export function Library({ tab }: { tab: string }) {
  return (
    <section className="page">
      <h1>Library</h1>
      <div className="tabs">
        <a className={tab !== 'packs' ? 'tab on' : 'tab'} href="#/library">
          My words
        </a>
        <a className={tab === 'packs' ? 'tab on' : 'tab'} href="#/library?tab=packs">
          Packs
        </a>
      </div>
      {tab === 'packs' ? <Packs /> : <Words />}
    </section>
  );
}

function dueLabel(item: Item): string {
  if (item.level === 0) return 'new';
  const days = Math.ceil((+new Date(item.card.due) - Date.now()) / 864e5);
  if (days <= 0) return 'due';
  return `in ${days}d`;
}

function Words() {
  const items = useLive(() => db.items.toArray(), [], [] as Item[]);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('any');
  const [deck, setDeck] = useState('any');
  const [open, setOpen] = useState<string | null>(null);

  const decks = useMemo(() => [...new Set(items.map((i) => i.deck))], [items]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items
      .filter((i) => level === 'any' || String(i.level) === level || (level === 'suspended' && i.suspended))
      .filter((i) => deck === 'any' || i.deck === deck)
      .filter(
        (i) =>
          !needle ||
          i.term.toLowerCase().includes(needle) ||
          i.translation.toLowerCase().includes(needle) ||
          i.tags.some((t) => t.includes(needle)),
      )
      .sort((a, b) => b.level - a.level || a.term.localeCompare(b.term));
  }, [items, q, level, deck]);

  const openItem = items.find((i) => i.id === open);

  return (
    <>
      <div className="filters">
        <input className="search" placeholder="Search words, translations, tags…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="any">Any level</option>
          {LEVEL_NAMES.map((n, i) => (
            <option key={n} value={i}>
              {i} · {n}
            </option>
          ))}
          <option value="suspended">Paused</option>
        </select>
        <select value={deck} onChange={(e) => setDeck(e.target.value)}>
          <option value="any">All sources</option>
          {decks.map((d) => (
            <option key={d} value={d}>
              {d === 'own' ? 'My own words' : DECKS.find((x) => x.id === d)?.title ?? d}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        {shown.length} of {items.length} · <a href="#/add">+ Add words</a>
      </p>
      <ul className="word-list">
        {shown.map((i) => (
          <li key={i.id}>
            <button className={i.suspended ? 'word-row paused' : 'word-row'} onClick={() => setOpen(i.id)}>
              <span className="word-term">{i.term}</span>
              <span className="word-tr muted">{i.translation}</span>
              <LevelDots level={i.level} />
              <span className="word-due small muted">{dueLabel(i)}</span>
            </button>
          </li>
        ))}
      </ul>
      {openItem && <ItemModal item={openItem} onClose={() => setOpen(null)} />}
    </>
  );
}

function ItemModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {editing ? (
          <ItemForm
            initial={item}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (c) => {
              await db.items.update(item.id, { ...c } as Partial<Item>);
              setEditing(false);
            }}
          />
        ) : (
          <>
            <ItemCard item={item} />
            <p className="muted small">
              Level {item.level}: {LEVEL_NAMES[item.level]} · reviews {item.card.reps} · forgotten {item.card.lapses}×
              {item.level > 0 && <> · next {new Date(item.card.due).toLocaleDateString()}</>}
              {item.source && <> · from: {item.source}</>}
            </p>
            {item.mySentences.length > 0 && (
              <div className="my-sentences">
                <b>My sentences</b>
                <ul>
                  {item.mySentences.map((s) => (
                    <li key={s.at}>{s.text}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="row wrap">
              <button
                className="primary"
                onClick={() => db.items.update(item.id, { usedInLife: item.usedInLife + 1 })}
                title="Press when you used it in a real conversation or message"
              >
                🙌 I used it in real life{item.usedInLife ? ` (${item.usedInLife})` : ''}
              </button>
              <button className="ghost" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="ghost" onClick={() => db.items.update(item.id, { suspended: !item.suspended })}>
                {item.suspended ? 'Resume' : 'Pause'}
              </button>
              <button
                className="ghost"
                onClick={() => {
                  if (confirm('Start learning this one from scratch?')) resetItem(item.id);
                }}
              >
                Reset progress
              </button>
              <button
                className="ghost danger"
                onClick={async () => {
                  if (confirm(`Delete “${item.term}”?`)) {
                    await db.items.delete(item.id);
                    onClose();
                  }
                }}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Packs() {
  const items = useLive(() => db.items.toArray(), [], [] as Item[]);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div className="packs">
      {DECKS.map((d) => {
        const added = items.filter((i) => i.deck === d.id).length;
        return (
          <div key={d.id} className="card pack">
            <div className="pack-head">
              <div>
                <h3>{d.title}</h3>
                <p className="muted small">
                  {d.description} · {d.items.length} phrases
                </p>
              </div>
              {added > 0 ? (
                <span className="chip on">✓ {added} in library</span>
              ) : (
                <button
                  className="primary"
                  onClick={async () => {
                    const n = await addDeck(d);
                    setMsg({ ...msg, [d.id]: `Added ${n}${n < d.items.length ? ` (${d.items.length - n} were already in your library)` : ''}.` });
                  }}
                >
                  Add pack
                </button>
              )}
            </div>
            {msg[d.id] && <p className="small">{msg[d.id]}</p>}
            <button className="link small" onClick={() => setPreview(preview === d.id ? null : d.id)}>
              {preview === d.id ? 'Hide' : 'Show phrases'}
            </button>
            {preview === d.id && (
              <ul className="pack-list small">
                {d.items.map((i) => (
                  <li key={i.term}>
                    <b>{i.term}</b> <span className="muted">— {i.translation}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
