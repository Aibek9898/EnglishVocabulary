import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Exercise } from '../components/Exercise';
import { Icon } from '../components/Icon';
import { Confetti, Ring, SessionHead, Sheet, toast, useCountUp, useFocusMode, usePageTitle } from '../components/ui';
import { sentenceUsesTerm } from '../lib/cloze';
import { dayKey } from '../lib/dates';
import { db, getSettings, saveSettings, useLive, useSettings } from '../lib/db';
import { DECKS, addDeck } from '../lib/decks';
import { buildSession, dueItems, newAllowance, overdueCount, pickMessageWords, retrySteps, type Step } from '../lib/session';
import { unlockSpeech } from '../lib/speech';
import { addSentence, nextLevel, recordResult, TYPED } from '../lib/srs';
import { activityByDay, computeStreak, levelCounts, type Streak } from '../lib/stats';
import { LEVEL_NAMES, type Item, type Result } from '../lib/types';

/** Sentence prompts per lesson: enough to move words towards "Used", few enough not to tire. */
const MAX_SENTENCES = 3;
const CHECKS = ['choice', 'cloze', 'cloze-ru', 'recall', 'say', 'dictation'];

interface Lesson {
  steps: Step[];
  index: number;
  items: Map<string, Item>;
  /** Levels at the start, for the level-ups on the end screen. */
  levelsBefore: Map<string, number>;
  answered: number;
  right: number;
  newWords: number;
  sentences: number;
  combo: number;
  streakBefore: Streak;
  ended: 'done' | 'early' | null;
}

export function Today() {
  const items = useLive(() => db.items.toArray(), [], null as Item[] | null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // Saves run one after another in the background, so moving on never waits.
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(new Map<string, Item>());
  const handled = useRef(-1);

  usePageTitle(lesson && !lesson.ended ? 'Lesson' : 'Today');
  useFocusMode(!!lesson);

  const start = useCallback(async (quick = false) => {
    unlockSpeech();
    const [all, settings, logs] = await Promise.all([db.items.toArray(), getSettings(), db.reviews.toArray()]);
    const effective = quick ? { ...settings, newPerDay: 0, reviewCap: 15 } : settings;
    const steps = buildSession(all, logs, effective);
    if (!steps.length) return;
    latest.current = new Map(all.map((i) => [i.id, i]));
    handled.current = -1;
    setLesson({
      steps,
      index: 0,
      items: new Map(latest.current),
      levelsBefore: new Map(all.map((i) => [i.id, i.level])),
      answered: 0,
      right: 0,
      newWords: 0,
      sentences: 0,
      combo: 0,
      streakBefore: computeStreak(activityByDay(logs)),
      ended: null,
    });
    window.scrollTo(0, 0);
  }, []);

  const onDone = useCallback(
    (result: Result, sentence?: string) => {
      if (!lesson || lesson.ended) return;
      const { index, steps } = lesson;
      // One answer per step, however fast the taps.
      if (handled.current === index) return;
      handled.current = index;
      const step = steps[index];
      const item = lesson.items.get(step.itemId);
      if (!item) return;

      const next = [...steps];
      for (const { at, step: s } of retrySteps(steps, index, result, item)) next.splice(at, 0, s);
      const ok = result === 'correct' || result === 'almost';
      const isCheck = CHECKS.includes(step.exercise);
      if (
        step.scheduled &&
        ok &&
        TYPED.includes(step.exercise) &&
        nextLevel(item, step.exercise, result) === 3 &&
        lesson.sentences < MAX_SENTENCES &&
        item.mySentences.length === 0 &&
        !next.slice(index + 1).some((s) => s.itemId === item.id && s.exercise === 'sentence')
      ) {
        next.splice(index + 1, 0, { itemId: item.id, exercise: 'sentence', scheduled: false, isNew: false });
      }

      // Move on now; save afterwards.
      setLesson({
        ...lesson,
        steps: next,
        index: index + 1,
        answered: lesson.answered + (step.scheduled ? 1 : 0),
        right: lesson.right + (step.scheduled && ok ? 1 : 0),
        newWords: lesson.newWords + (step.isNew && step.scheduled ? 1 : 0),
        sentences: lesson.sentences + (sentence ? 1 : 0),
        combo: isCheck ? (ok ? lesson.combo + 1 : 0) : lesson.combo,
        ended: index + 1 >= next.length ? 'done' : null,
      });
      window.scrollTo(0, 0);

      saving.current = saving.current
        .then(async () => {
          const current = latest.current.get(item.id) ?? item;
          let updated = current;
          if (step.exercise === 'sentence') {
            if (sentence) {
              updated = await addSentence(current, sentence);
              toast('Sentence saved. Recall it on another day to reach “Used”.', 'pen');
            }
          } else {
            updated = await recordResult(current, step.exercise, result, step.scheduled);
          }
          latest.current.set(item.id, updated);
          setLesson((l) => (l ? { ...l, items: new Map(l.items).set(item.id, updated) } : l));
          if (updated.level > current.level && updated.level >= 3) toast(`“${item.term}” is now ${LEVEL_NAMES[updated.level]}`, 'star');
        })
        .catch((e) => console.error(e));
    },
    [lesson],
  );

  if (items === null) return null;
  if (items.length === 0 && !lesson) return <Welcome onStart={() => start()} />;

  if (lesson && !lesson.ended) {
    const step = lesson.steps[lesson.index];
    const item = lesson.items.get(step.itemId)!;
    return (
      <section className="page session">
        <SessionHead done={lesson.index} total={lesson.steps.length} combo={lesson.combo} onClose={() => setConfirmEnd(true)} />
        <Exercise key={lesson.index} item={item} kind={step.exercise} pool={[...lesson.items.values()]} onDone={onDone} />
        <Sheet open={confirmEnd} onClose={() => setConfirmEnd(false)} label="End the lesson?">
          <h2>End the lesson?</h2>
          <p>Your answers so far are saved. The rest comes back next time.</p>
          <div className="row">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setConfirmEnd(false);
                setLesson({ ...lesson, ended: 'early' });
              }}
            >
              End lesson
            </button>
            <button type="button" className="primary" onClick={() => setConfirmEnd(false)} autoFocus>
              Keep going
            </button>
          </div>
        </Sheet>
      </section>
    );
  }

  if (lesson?.ended) return <LessonEnd lesson={lesson} saved={saving.current} onClose={() => setLesson(null)} />;

  return <TodayStart items={items!} onStart={start} />;
}

/* ---------- start screen ---------- */

function TodayStart({ items, onStart }: { items: Item[]; onStart: (quick?: boolean) => void }) {
  const settings = useSettings();
  const reviews = useLive(() => db.reviews.where('day').equals(dayKey()).toArray(), [], null);
  const [busy, setBusy] = useState(false);
  if (!reviews) return null;

  const due = dueItems(items).length;
  const reviewsNow = Math.min(due, settings.reviewCap);
  const unseen = items.filter((i) => i.level === 0 && !i.suspended).length;
  const newCount = Math.min(newAllowance(items, reviews, settings), unseen);
  const paused = overdueCount(items) >= settings.reviewCap;
  const doneToday = reviews.filter((r) => r.scheduled).length;
  const plan = doneToday + reviewsNow + newCount;
  const minutes = Math.max(2, Math.round((reviewsNow * 12 + newCount * 50) / 60));
  const nothing = reviewsNow === 0 && newCount === 0;
  const levels = levelCounts(items);
  const tomorrow = items.filter((i) => !i.suspended && i.level > 0 && +new Date(i.card.due) < +new Date(new Date().setHours(48, 0, 0, 0))).length - due;

  const go = (quick?: boolean) => {
    setBusy(true);
    onStart(quick);
  };

  const parts = [reviewsNow && `${reviewsNow} review${reviewsNow === 1 ? '' : 's'}`, newCount && `${newCount} new`].filter(Boolean).join(' + ');

  return (
    <section className="page today">
      <div className="page-head">
        <h1>Today</h1>
      </div>

      <div className="card hero">
        <Ring value={nothing ? 1 : doneToday} max={nothing ? 1 : plan} label={nothing ? "Today's plan is done" : `${doneToday} of ${plan} done today`}>
          {nothing ? '✓' : `${Math.round((doneToday / Math.max(1, plan)) * 100)}%`}
        </Ring>
        {nothing ? (
          <>
            <div>
              <h2>All done for today</h2>
              <p className="muted">{tomorrow > 0 ? `${tomorrow} review${tomorrow === 1 ? '' : 's'} tomorrow. ` : ''}Play a game or add new words.</p>
            </div>
            <div className="hero-actions">
              <a className="button primary big" href="#/practice">
                <Icon name="gamepad" /> Practice
              </a>
              <a className="button big" href="#/add">
                <Icon name="plus" /> Add words
              </a>
            </div>
          </>
        ) : (
          <>
            <div>
              <h2>{parts}</h2>
              <p className="muted">About {minutes} minutes</p>
            </div>
            <div className="hero-actions">
              <button type="button" className="primary big block" onClick={() => go()} disabled={busy} autoFocus>
                {doneToday ? 'Continue lesson' : 'Start lesson'}
              </button>
              {reviewsNow > 3 && (
                <button type="button" className="ghost block" onClick={() => go(true)} disabled={busy}>
                  <Icon name="timer" size={18} /> Quick 3-minute review
                </button>
              )}
            </div>
            {paused && <p className="muted small hero-note">New words are paused until the review pile is smaller. That keeps lessons short.</p>}
          </>
        )}
      </div>

      {levels.slice(1).some(Boolean) && (
        <>
          <h2 className="section-title">Your words</h2>
          <div className="funnel">
            <a className="funnel-step" href="#/library">
              <b>{levels[1] + levels[2]}</b>
              <span>Learning</span>
            </a>
            <a className="funnel-step" href="#/library">
              <b>{levels[3]}</b>
              <span>Recalled</span>
            </a>
            <a className="funnel-step accent" href="#/progress">
              <b>{levels[4] + levels[5]}</b>
              <span>Can use</span>
            </a>
          </div>
          <p className="muted small funnel-note">Words become “Can use” once you write your own sentence and recall them again on another day.</p>
        </>
      )}

      <InstallCard />
    </section>
  );
}

/** iPhone Safari doesn't offer installing by itself, so explain it once. */
function InstallCard() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('vocab-install-hint') === 'off';
    } catch {
      return true;
    }
  });
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  if (hidden || !ios || standalone) return null;
  return (
    <div className="card install-card">
      <Icon name="download" size={22} />
      <div>
        <b>Put Vocab on your Home Screen</b>
        <p className="muted small">Tap the Share button in Safari, then “Add to Home Screen”. It opens full screen, like an app.</p>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label="Hide this tip"
        onClick={() => {
          try {
            localStorage.setItem('vocab-install-hint', 'off');
          } catch {
            // ignore
          }
          setHidden(true);
        }}
      >
        <Icon name="x" size={20} />
      </button>
    </div>
  );
}

/* ---------- end screen ---------- */

function LessonEnd({ lesson, saved, onClose }: { lesson: Lesson; saved: Promise<unknown>; onClose: () => void }) {
  const [after, setAfter] = useState<{ streak: Streak; words: Item[]; items: Item[] } | null>(null);
  useEffect(() => {
    let live = true;
    saved.then(async () => {
      const [items, reviews] = await Promise.all([db.items.toArray(), db.reviews.toArray()]);
      if (!live) return;
      setAfter({ streak: computeStreak(activityByDay(reviews)), words: pickMessageWords(items, reviews), items });
    });
    return () => {
      live = false;
    };
  }, [saved]);
  usePageTitle('Lesson complete');

  const { answered, right } = lesson;
  const pct = answered ? right / answered : 0;
  const rightCount = useCountUp(right);
  const complete = lesson.ended === 'done';

  const levelUps = useMemo(() => {
    if (!after) return [];
    return after.items
      .filter((i) => (lesson.levelsBefore.get(i.id) ?? 0) < i.level && i.level >= 3)
      .sort((a, b) => b.level - a.level)
      .slice(0, 6);
  }, [after, lesson.levelsBefore]);

  const streak = after?.streak;
  const extended = streak && streak.activeToday && !lesson.streakBefore.activeToday;

  return (
    <section className="page lesson-end">
      {complete && pct >= 0.5 && <Confetti />}
      <div className="end-ring">
        <Ring value={right} max={Math.max(1, answered)} size={132} stroke={12} label={`${right} of ${answered} right`}>
          {answered ? `${rightCount}/${answered}` : '✓'}
        </Ring>
      </div>
      <h1 className="center">{complete ? 'Lesson complete!' : 'Lesson saved'}</h1>
      <p className="center muted">
        {answered ? `${right} of ${answered} answers right${lesson.newWords ? ` · ${lesson.newWords} new word${lesson.newWords === 1 ? '' : 's'}` : ''}` : 'Every step counts.'}
      </p>

      {streak && streak.current > 0 && (
        <div className={'card end-streak' + (extended ? ' ignite' : '')}>
          <Icon name="flame" size={36} />
          <div>
            <b>
              {streak.current} day streak{extended ? '!' : ''}
            </b>
            <p className="muted small">
              {extended ? 'Today counts. See you tomorrow.' : streak.activeToday ? 'Today already counts.' : 'A few more answers today keep it going.'}
              {streak.freezes ? ` ${streak.freezes} freeze${streak.freezes > 1 ? 's' : ''} saved.` : ''}
            </p>
          </div>
        </div>
      )}

      {levelUps.length > 0 && (
        <div className="card">
          <h2>Level ups</h2>
          <ul className="levelup-list">
            {levelUps.map((i) => (
              <li key={i.id}>
                <span>{i.term}</span>
                <span className={i.level >= 4 ? 'chip brand' : 'chip'}>
                  <Icon name="star" size={14} /> {LEVEL_NAMES[i.level]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {after && after.words.length > 0 && <DailyMessage items={after.words} />}

      <button type="button" className="primary big block" onClick={onClose}>
        Done
      </button>
    </section>
  );
}

/** "Write a short message about your day using these words." */
export function DailyMessage({ items }: { items: Item[] }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string[] | null>(null);
  const used = useMemo(() => new Set(items.filter((i) => sentenceUsesTerm(text, i.term)).map((i) => i.id)), [text, items]);

  const save = async () => {
    const chosen = items.filter((i) => used.has(i.id));
    for (const i of chosen) {
      const fresh = await db.items.get(i.id);
      if (fresh) await addSentence(fresh, text.trim());
    }
    setSaved(chosen.map((i) => i.term));
  };

  const copyForAi = async () => {
    const prompt = `I'm learning English (B2, my native language is Russian). Please check my short message. Correct any mistakes, keep my style, and give one short tip. Then tell me if I used these phrases naturally: ${items.map((i) => `"${i.term}"`).join(', ')}.\n\nMy message:\n${text.trim()}`;
    try {
      await navigator.clipboard.writeText(prompt);
      toast('Copied. Paste it into Claude or Gemini.', 'copy');
    } catch {
      toast('Copying is blocked here', 'alert');
    }
  };

  if (saved) {
    return (
      <div className="card">
        <p>
          <Icon name="check" size={18} /> Saved{saved.length ? `. You used ${saved.join(', ')}.` : '.'}
        </p>
        <button type="button" className="ghost" onClick={copyForAi}>
          <Icon name="sparkles" size={18} /> Check with AI
        </button>
      </div>
    );
  }
  return (
    <div className="card">
      <h2>Use them in a message</h2>
      <p className="muted small">Tell a friend about your day or your plans, using these phrases:</p>
      <div className="chips">
        {items.map((i) => (
          <span key={i.id} className={used.has(i.id) ? 'chip ok' : 'chip'}>
            {used.has(i.id) && <Icon name="check" size={14} strokeWidth={3} />}
            {i.term}
          </span>
        ))}
      </div>
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Hi! Today I…" aria-label="Your message" lang="en" />
      <div className="row">
        <button type="button" className="primary" onClick={save} disabled={!text.trim() || used.size === 0}>
          Save message
        </button>
        <button type="button" className="ghost" onClick={copyForAi} disabled={!text.trim()}>
          <Icon name="sparkles" size={18} /> Check with AI
        </button>
      </div>
    </div>
  );
}

/* ---------- first visit ---------- */

function Welcome({ onStart }: { onStart: () => void }) {
  const [goal, setGoal] = useState(7);
  const [packs, setPacks] = useState(() => new Set(DECKS.map((d) => d.id)));
  const [busy, setBusy] = useState(false);
  usePageTitle('Welcome');

  const begin = async () => {
    setBusy(true);
    await saveSettings({ newPerDay: goal });
    for (const d of DECKS) if (packs.has(d.id)) await addDeck(d);
    if (packs.size) onStart();
    else window.location.hash = '#/add';
  };

  return (
    <section className="page welcome">
      <div className="welcome-head">
        <span className="app-mark big-mark" aria-hidden="true">
          <Icon name="message" size={30} strokeWidth={2.2} />
        </span>
        <h1>Learn English phrases you'll actually use</h1>
      </div>
      <ul className="welcome-points">
        <li>
          <Icon name="layers" size={22} />
          <span>
            <b>Phrases, not single words.</b> Collocations and phrasal verbs that natives really say.
          </span>
        </li>
        <li>
          <Icon name="target" size={22} />
          <span>
            <b>Short daily lessons.</b> A few new phrases a day, and reviews right before you'd forget.
          </span>
        </li>
        <li>
          <Icon name="pen" size={22} />
          <span>
            <b>Use them.</b> Write your own sentences, so the words become yours.
          </span>
        </li>
      </ul>

      <div className="card">
        <h2>New phrases a day</h2>
        <div className="segmented" role="group" aria-label="New phrases a day">
          {[5, 7, 10].map((n) => (
            <button key={n} type="button" aria-pressed={goal === n} onClick={() => setGoal(n)}>
              {n}
            </button>
          ))}
        </div>
        <p className="muted small">About {Math.round(goal * 1.2 + 4)} minutes a day. You can change it any time.</p>
      </div>

      <div className="card">
        <h2>Packs to start with</h2>
        <ul className="pack-picks">
          {DECKS.map((d) => (
            <li key={d.id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={packs.has(d.id)}
                  onChange={(e) => {
                    const s = new Set(packs);
                    if (e.target.checked) s.add(d.id);
                    else s.delete(d.id);
                    setPacks(s);
                  }}
                />
                <span>
                  {d.title} <span className="muted small">· {d.items.length}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <button type="button" className="primary big block" onClick={begin} disabled={busy}>
        {packs.size ? 'Start my first lesson' : 'Add my own words'}
      </button>
    </section>
  );
}
