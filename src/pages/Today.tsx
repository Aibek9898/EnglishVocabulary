import { useCallback, useEffect, useMemo, useState } from 'react';
import { Exercise } from '../components/Exercise';
import { sentenceUsesTerm } from '../lib/cloze';
import { dayKey } from '../lib/dates';
import { db, getSettings, useLive } from '../lib/db';
import { DECKS, addDeck } from '../lib/decks';
import { addSentence, recordResult } from '../lib/srs';
import { buildSession, dueItems, introducedToday, type Step } from '../lib/session';
import { usable } from '../lib/stats';
import type { Item, Result } from '../lib/types';

interface Summary {
  done: number;
  correct: number;
  newWords: number;
  usableBefore: number;
}

/** Sentence prompts per session: enough to move words to "Used", few enough not to tire. */
const MAX_SENTENCES = 3;

export function Today() {
  const items = useLive(() => db.items.toArray(), [], null as Item[] | null);
  const reviews = useLive(() => db.reviews.where('day').equals(dayKey()).toArray(), [], []);
  const [session, setSession] = useState<Step[] | null>(null);
  const [index, setIndex] = useState(0);
  const [snapshot, setSnapshot] = useState<Map<string, Item>>(new Map());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sentences, setSentences] = useState(0);

  const start = useCallback(
    async (quick = false) => {
      const all = await db.items.toArray();
      const settings = await getSettings();
      const logs = await db.reviews.toArray();
      const effective = quick ? { ...settings, newPerDay: 0, reviewCap: 15 } : settings;
      const steps = buildSession(all, logs, effective);
      setSnapshot(new Map(all.map((i) => [i.id, i])));
      setSession(steps);
      setIndex(0);
      setSentences(0);
      setSummary({ done: 0, correct: 0, newWords: 0, usableBefore: usable(all) });
    },
    [],
  );

  const step = session?.[index];
  const item = step ? snapshot.get(step.itemId) : undefined;
  const pool = useMemo(() => [...snapshot.values()], [snapshot]);

  const onDone = useCallback(
    async (result: Result, sentence?: string) => {
      if (!session || !step || !item) return;
      let updated: Item = item;
      try {
        if (step.exercise === 'sentence') {
          if (sentence) {
            updated = await addSentence(item, sentence);
            setSentences((n) => n + 1);
          }
        } else {
          updated = await recordResult(item, step.exercise, result, step.scheduled);
        }
      } catch (e) {
        // Never get stuck on one card because saving failed.
        console.error(e);
      }
      setSnapshot((m) => new Map(m).set(item.id, updated));

      const next = [...session];
      if (result === 'wrong' && step.exercise !== 'sentence' && step.exercise !== 'intro') {
        // Show it again a few steps later; repeats don't touch the schedule.
        const retry: Step = { ...step, scheduled: false, exercise: step.exercise === 'choice' ? 'choice' : 'cloze' };
        next.splice(Math.min(next.length, index + 4), 0, retry);
      } else if (
        step.scheduled &&
        result !== 'wrong' &&
        ['cloze', 'cloze-ru', 'recall', 'dictation'].includes(step.exercise) &&
        updated.level === 3 &&
        sentences < MAX_SENTENCES &&
        !next.slice(index + 1).some((s) => s.itemId === item.id && s.exercise === 'sentence')
      ) {
        next.splice(index + 1, 0, { itemId: item.id, exercise: 'sentence', scheduled: false, isNew: false });
      }
      setSession(next);
      if (step.exercise !== 'intro' && step.exercise !== 'sentence' && summary) {
        setSummary({
          ...summary,
          done: summary.done + (step.scheduled ? 1 : 0),
          correct: summary.correct + (step.scheduled && result !== 'wrong' ? 1 : 0),
          newWords: summary.newWords + (step.isNew && step.scheduled ? 1 : 0),
        });
      }
      setIndex(index + 1);
    },
    [session, step, item, index, sentences, summary],
  );

  if (items === null) return <p className="muted">Loading…</p>;
  if (items.length === 0) return <Welcome />;

  if (session && step && item) {
    const remaining = session.length - index;
    return (
      <section className="page session">
        <div className="session-bar">
          <button className="ghost small" onClick={() => setSession(null)}>
            ✕ Stop
          </button>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${(index / session.length) * 100}%` }} />
          </div>
          <span className="muted small">{remaining} left</span>
        </div>
        <Exercise key={index} item={item} kind={step.exercise} pool={pool} onDone={onDone} />
      </section>
    );
  }

  if (session && summary) {
    return <SessionEnd summary={summary} items={[...snapshot.values()]} session={session} onClose={() => setSession(null)} />;
  }

  const due = dueItems(items).length;
  return <TodayStart items={items} due={due} introduced={introducedToday(reviews)} onStart={start} />;
}

function TodayStart({
  items,
  due,
  introduced,
  onStart,
}: {
  items: Item[];
  due: number;
  introduced: number;
  onStart: (quick?: boolean) => void;
}) {
  const settings = useLive(getSettings, [], null);
  if (!settings) return null;
  const left = due >= settings.reviewCap ? 0 : Math.max(0, settings.newPerDay - introduced);
  const unseen = items.filter((i) => i.level === 0 && !i.suspended).length;
  const newCount = Math.min(left, unseen);
  const nothing = due === 0 && newCount === 0;
  return (
    <section className="page today">
      <h1>Today</h1>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-num">{Math.min(due, settings.reviewCap)}</span>
          <span className="stat-label">reviews{due > settings.reviewCap ? ` (+${due - settings.reviewCap} later)` : ''}</span>
        </div>
        <div className="stat">
          <span className="stat-num">{newCount}</span>
          <span className="stat-label">new</span>
        </div>
        <div className="stat accent">
          <span className="stat-num">{usable(items)}</span>
          <span className="stat-label">words you can use</span>
        </div>
      </div>
      {nothing ? (
        <div className="card center">
          <p className="big">🎉 All done for today.</p>
          <p className="muted">
            {unseen === 0 ? 'You have no new words left. Add a pack or your own words.' : 'Come back tomorrow, or play a game in Practice.'}
          </p>
          <div className="row center">
            <a className="button" href="#/practice">
              Practice
            </a>
            <a className="button" href="#/add">
              Add words
            </a>
          </div>
        </div>
      ) : (
        <div className="card center">
          <p>About {Math.max(2, Math.round((Math.min(due, settings.reviewCap) * 15 + newCount * 50) / 60))} minutes.</p>
          <button className="primary big" onClick={() => onStart()} autoFocus>
            Start
          </button>
          {due > 0 && (
            <button className="ghost" onClick={() => onStart(true)}>
              I only have 3 minutes
            </button>
          )}
          {due >= settings.reviewCap && (
            <p className="muted small">New words are paused until the review backlog is smaller.</p>
          )}
        </div>
      )}
    </section>
  );
}

function SessionEnd({
  summary,
  items,
  session,
  onClose,
}: {
  summary: Summary;
  items: Item[];
  session: Step[];
  onClose: () => void;
}) {
  const usableNow = usable(items);
  const gained = usableNow - summary.usableBefore;
  const pct = summary.done ? Math.round((summary.correct / summary.done) * 100) : 0;
  // Three of today's words for the "use them in a message" task.
  const candidates = useMemo(() => {
    const ids = [...new Set(session.map((s) => s.itemId))];
    const today = ids.map((id) => items.find((i) => i.id === id)).filter((i): i is Item => !!i);
    return today.sort(() => Math.random() - 0.5).slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="page">
      <h1>Session complete</h1>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-num">{summary.done}</span>
          <span className="stat-label">answers</span>
        </div>
        <div className="stat">
          <span className="stat-num">{pct}%</span>
          <span className="stat-label">right</span>
        </div>
        <div className="stat">
          <span className="stat-num">{summary.newWords}</span>
          <span className="stat-label">new</span>
        </div>
        <div className="stat accent">
          <span className="stat-num">{gained > 0 ? `+${gained}` : usableNow}</span>
          <span className="stat-label">{gained > 0 ? 'words you can use' : 'usable in total'}</span>
        </div>
      </div>
      {candidates.length > 0 && <DailyMessage items={candidates} />}
      <button className="primary" onClick={onClose}>
        Done
      </button>
    </section>
  );
}

/** "Write a short message about your day using these words." */
export function DailyMessage({ items }: { items: Item[] }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string[] | null>(null);
  const [used, setUsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    setUsed(new Set(items.filter((i) => sentenceUsesTerm(text, i.term)).map((i) => i.id)));
  }, [text, items]);
  const save = async () => {
    const chosen = items.filter((i) => used.has(i.id));
    for (const i of chosen) {
      const fresh = await db.items.get(i.id);
      if (fresh) await addSentence(fresh, text);
    }
    setSaved(chosen.map((i) => i.term));
  };
  if (saved) {
    return (
      <div className="card">
        <p>✍️ Saved. {saved.length ? `You used: ${saved.join(', ')}.` : ''}</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>Use them: write a short message</h3>
      <p className="muted small">Tell a friend about your day or your plans, using these:</p>
      <div className="chips">
        {items.map((i) => (
          <label key={i.id} className={used.has(i.id) ? 'chip on' : 'chip'}>
            <input
              type="checkbox"
              checked={used.has(i.id)}
              onChange={(e) => {
                const s = new Set(used);
                if (e.target.checked) s.add(i.id);
                else s.delete(i.id);
                setUsed(s);
              }}
            />
            {i.term}
          </label>
        ))}
      </div>
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Hi! Today I…" />
      <button className="primary" onClick={save} disabled={!text.trim() || used.size === 0}>
        Save message
      </button>
    </div>
  );
}

function Welcome() {
  const [busy, setBusy] = useState(false);
  const addAll = async () => {
    setBusy(true);
    for (const d of DECKS) await addDeck(d);
    setBusy(false);
  };
  return (
    <section className="page">
      <h1>Welcome 👋</h1>
      <div className="card">
        <p>Your library is empty. Start with the ready-made Upper-Intermediate packs, or add your own words.</p>
        <p className="muted small">
          You get {DECKS.reduce((n, d) => n + d.items.length, 0)} phrases in {DECKS.length} packs, but only 7 new ones a day, so it never gets overwhelming.
        </p>
        <div className="row">
          <button className="primary" onClick={addAll} disabled={busy}>
            {busy ? 'Adding…' : 'Add all packs'}
          </button>
          <a className="button" href="#/library?tab=packs">
            Choose packs
          </a>
          <a className="button" href="#/add">
            Add my own words
          </a>
        </div>
      </div>
    </section>
  );
}
