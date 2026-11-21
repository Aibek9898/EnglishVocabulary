import '../games.css';
import '../grammar.css';
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Marked } from '../components/AiCheck';
import { Icon } from '../components/Icon';
import { Speak } from '../components/Speak';
import { ActionBar, Confetti, ContinueButton, Sheet, SessionHead, Verdict, toast, useEnter, useFocusMode, usePageTitle, type Tone } from '../components/ui';
import { activeAi, AiError, useAi, type ActiveAi } from '../lib/ai';
import {
  afterLesson,
  afterReview,
  buildReview,
  deleteLesson,
  freshProgress,
  gradeTyped,
  isDue,
  saveLesson,
  shownAnswer,
  updateProgress,
  useGrammar,
  type GChoice,
  type GExercise,
  type GrammarLesson,
  type GrammarProgress,
  type GrammarStore,
  type ReviewItem,
  type TypedExercise,
} from '../lib/grammar';
import { checkWriting, generateLesson, type WritingCheck } from '../lib/grammarAi';
import { allLessons } from '../lib/grammarLessons';

type Run = { kind: 'lesson'; id: string } | { kind: 'review'; id: string; items: ReviewItem[] };

/** Grammar: one topic per lesson, then short spaced reviews. */
export function Grammar() {
  const store = useGrammar();
  const [run, setRun] = useState<Run | null>(null);
  const lessons = useMemo(() => allLessons(store), [store]);
  useFocusMode(!!run);
  usePageTitle('Grammar');
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [run]);

  if (!store) return null;
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const current = run && byId.get(run.id);

  if (run && current) {
    return (
      <section className="page gr-run">
        {run.kind === 'lesson' ? (
          <LessonRun lesson={current} progress={store.progress[current.id]} onExit={() => setRun(null)} />
        ) : (
          <ReviewRun lesson={current} items={run.items} lessons={byId} progress={store.progress[current.id]} onExit={() => setRun(null)} />
        )}
      </section>
    );
  }

  const startReview = (lesson: GrammarLesson) => {
    const p = store.progress[lesson.id] ?? freshProgress();
    const others = lessons.filter((l) => l.id !== lesson.id && store.progress[l.id]?.doneAt).map((l) => ({ lesson: l, p: store.progress[l.id] }));
    setRun({ kind: 'review', id: lesson.id, items: buildReview(lesson, p, others) });
  };

  return <GrammarHome store={store} lessons={lessons} onLearn={(id) => setRun({ kind: 'lesson', id })} onReview={startReview} />;
}

/* ============ the list ============ */

function dueText(p: GrammarProgress | undefined): string {
  if (!p?.doneAt) return p ? 'In progress' : 'New';
  if (!p.due) return 'Done';
  const days = Math.round((p.due - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return 'Review today';
  return days === 1 ? 'Review tomorrow' : `Review in ${days} days`;
}

function GrammarHome({ store, lessons, onLearn, onReview }: { store: GrammarStore; lessons: GrammarLesson[]; onLearn: (id: string) => void; onReview: (l: GrammarLesson) => void }) {
  const due = lessons.filter((l) => isDue(store.progress[l.id]));
  const [removing, setRemoving] = useState<GrammarLesson | null>(null);
  return (
    <section className="page grammar">
      <div className="page-head">
        <h1>Grammar</h1>
      </div>
      <p className="g-explainer">One topic at a time: read, notice, a short rule, practice, then short reviews over the next weeks.</p>

      {due.length > 0 && (
        <div className="gr-due">
          {due.map((l) => (
            <button key={l.id} type="button" className="gr-due-card" onClick={() => onReview(l)}>
              <span className="game-icon flame">
                <Icon name="reset" size={22} />
              </span>
              <span>
                <b>Review: {l.title}</b>
                <span>6 questions, about 3 minutes</span>
              </span>
              <Icon name="right" size={20} />
            </button>
          ))}
        </div>
      )}

      <h2 className="gr-h2 gr-first">Lessons</h2>
      <ul className="gr-list">
        {lessons.map((l) => {
          const p = store.progress[l.id];
          const status = dueText(p);
          return (
            <li key={l.id} className="gr-item">
              <button type="button" className="gr-item-main" onClick={() => onLearn(l.id)}>
                <span className={'game-icon ' + (p?.doneAt ? 'ok' : 'brand')}>
                  <Icon name={p?.doneAt ? 'check' : 'cap'} size={22} />
                </span>
                <span className="gr-item-text">
                  <b>{l.title}</b>
                  <span lang="ru">{l.subtitle}</span>
                  <span className="gr-tags">
                    <span className={'gr-tag' + (status === 'Review today' ? ' due' : '')}>{status}</span>
                    {p?.score !== undefined && <span className="gr-tag">Check {Math.round(p.score * 100)}%</span>}
                    {l.source === 'ai' && (
                      <span className="gr-tag">
                        <Icon name="sparkles" size={12} /> AI
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <div className="gr-item-actions">
                {p?.doneAt && (
                  <button type="button" className="small ghost" onClick={() => onReview(l)}>
                    Review now
                  </button>
                )}
                {l.source === 'ai' && (
                  <button type="button" className="icon-btn" aria-label={`Delete the lesson ${l.title}`} onClick={() => setRemoving(l)}>
                    <Icon name="trash" size={18} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <NewLesson onCreated={onLearn} />

      <Sheet open={!!removing} onClose={() => setRemoving(null)} label="Delete the lesson">
        <h2>Delete “{removing?.title}”?</h2>
        <p>The lesson and its reviews go away on this device and on synced devices. You can always make a new one on the same topic.</p>
        <div className="row">
          <button type="button" className="ghost" onClick={() => setRemoving(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (removing) await deleteLesson(removing.id);
              setRemoving(null);
              toast('Lesson deleted', 'trash');
            }}
          >
            Delete
          </button>
        </div>
      </Sheet>
    </section>
  );
}

const TOPIC_IDEAS = ['Present Perfect vs Past Simple', 'Past Perfect Continuous', 'Cleft sentences', 'Mixed conditionals', 'I wish / If only', 'Inversion after negative adverbs'];

/** Type a topic: the AI writes a lesson in the same format, saved on this device. */
function NewLesson({ onCreated }: { onCreated: (id: string) => void }) {
  const config = useAi();
  const ai = activeAi(config);
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<0 | 1 | 2>(0);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const create = async () => {
    if (!ai || !topic.trim() || busy) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 300_000);
    setError('');
    setBusy(1);
    try {
      const lesson = await generateLesson(ai, topic, notes, ctrl.signal, (s) => setBusy(s));
      await saveLesson(lesson);
      setTopic('');
      setNotes('');
      toast('Lesson ready', 'sparkles');
      onCreated(lesson.id);
    } catch (e) {
      if (abort.current !== ctrl) return;
      setError(ctrl.signal.aborted ? 'The AI took too long. Try again.' : e instanceof AiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      clearTimeout(timer);
      if (abort.current === ctrl) setBusy(0);
    }
  };

  return (
    <form
      className="card gr-new"
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <h2>
        <Icon name="sparkles" /> New lesson
      </h2>
      <p className="muted small">Something from class, or a topic you want to learn. The AI teacher writes a lesson in the same format, and it stays in your list.</p>
      <label className="field">
        <span>Topic</span>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Past Perfect Continuous" disabled={!!busy} lang="en" autoCapitalize="sentences" />
      </label>
      {!topic && (
        <div className="filter-chips gr-ideas" role="group" aria-label="Ideas">
          {TOPIC_IDEAS.map((t) => (
            <button key={t} type="button" className="filter-chip" onClick={() => setTopic(t)} disabled={!!busy}>
              {t}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span>What to focus on (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          disabled={!!busy}
          placeholder="e.g. We did this in class on Thursday. I mix it up with Past Simple."
        />
      </label>
      {error && (
        <p className="hint-line" role="alert">
          {error}
        </p>
      )}
      {ai ? (
        <div className="gr-new-go">
          <button type="submit" className="primary" disabled={!topic.trim() || !!busy}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" /> {busy === 1 ? 'Writing the rules…' : 'Writing the exercises…'}
              </>
            ) : (
              <>
                <Icon name="sparkles" size={18} /> Create the lesson
              </>
            )}
          </button>
          {busy ? (
            <button type="button" className="ghost" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          ) : null}
          {busy ? <small className="muted">Usually 1–2 minutes. Keep this page open.</small> : null}
        </div>
      ) : (
        <p className="muted small ai-hint">
          <Icon name="sparkles" size={16} />
          <span>
            Connect an AI teacher (OpenAI, OpenRouter or DeepSeek) in <a href="#/settings?section=ai">Settings</a> to create lessons.
          </span>
        </p>
      )}
    </form>
  );
}

/* ============ a lesson ============ */

const STEPS = ['Read', 'Notice', 'Rule', 'Practice', 'Use it', 'Check'] as const;

function LessonRun({ lesson, progress, onExit }: { lesson: GrammarLesson; progress?: GrammarProgress; onExit: () => void }) {
  const ai = activeAi(useAi());
  const done = !!progress?.doneAt;
  // An unfinished lesson continues where it stopped; a finished one starts over.
  const [step, setStep] = useState(() => (!done && progress?.step) || 0);
  const [result, setResult] = useState<{ score: number; missed: string[] } | null>(null);
  const [reported, setReported] = useState<string[]>([]);

  const go = (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0 });
    if (!done) updateProgress(lesson.id, (p) => ({ ...p, step: n })).catch(console.error);
  };
  const report = (id: string) => {
    setReported((r) => [...r, id]);
    updateProgress(lesson.id, (p) => ({ ...p, bad: [...new Set([...(p.bad ?? []), id])] })).catch(console.error);
    toast("Thanks. This question won't be asked again.", 'check');
  };
  const items = (list: GExercise[]) => list.filter((e) => !(progress?.bad ?? []).includes(e.id)).map((ex) => ({ lessonId: lesson.id, ex }));
  const lessons = new Map([[lesson.id, lesson]]);

  const head = <SessionHead done={step} total={STEPS.length} onClose={onExit} label="Lesson progress" />;

  if (result) return <LessonDone lesson={lesson} result={result} onExit={onExit} />;

  switch (step) {
    case 0:
      return (
        <QuestionsStep key="read" head={head} pill="Read" intro={<LessonText text={lesson.text} marked={false} />} questions={[lesson.gist]} title={lesson.title} onDone={() => go(1)} />
      );
    case 1:
      return (
        <QuestionsStep
          key="notice"
          head={head}
          pill="Notice"
          intro={
            <>
              <p className="g-instr">Look at the highlighted parts. Think about what they mean.</p>
              <LessonText text={lesson.text} marked />
            </>
          }
          questions={lesson.notice}
          onDone={() => go(2)}
        />
      );
    case 2:
      return (
        <div className="g-game">
          {head}
          <p className="prompt-pill">
            <Icon name="bulb" size={16} /> The rule
          </p>
          <RuleCard lesson={lesson} />
          <ActionBar>
            <ContinueButton label="Practise" onClick={() => go(3)} />
          </ActionBar>
        </div>
      );
    case 3:
    case 4:
    case 5: {
      const stage = step === 3 ? lesson.practice : step === 4 ? lesson.produce : lesson.check;
      return (
        <Runner
          key={step}
          title={STEPS[step]}
          items={items(stage)}
          lessons={lessons}
          ai={ai}
          strict={step === 5}
          stepHead={{ done: step, total: STEPS.length }}
          reported={reported}
          onReport={(id) => report(id)}
          onExit={onExit}
          onFinish={(res) => {
            if (step < 5) return go(step + 1);
            const counted = res.filter((r) => !r.skipped);
            const score = counted.length ? counted.filter((r) => r.ok).length / counted.length : 1;
            const missed = res.filter((r) => !r.ok && !r.skipped).map((r) => r.id);
            setResult({ score, missed });
            updateProgress(lesson.id, (p) => afterLesson(p, score, missed)).catch(console.error);
          }}
        />
      );
    }
  }
  return null;
}

function LessonDone({ lesson, result, onExit }: { lesson: GrammarLesson; result: { score: number; missed: string[] }; onExit: () => void }) {
  const pct = Math.round(result.score * 100);
  const all = [...lesson.check];
  const missed = all.filter((e) => result.missed.includes(e.id));
  return (
    <div className="g-game gr-done">
      {pct >= 80 && <Confetti />}
      <h1 className="g-title">{pct >= 80 ? 'Lesson done!' : 'Lesson done'}</h1>
      <p className="g-instr">
        Check: <b>{pct}%</b>. {pct >= 80 ? 'Great result.' : 'The reviews will bring back what was hard.'} First review tomorrow, then after 3, 7, 14 and 30 days.
      </p>
      <section className="card gr-summary" aria-label="To remember">
        <h2>
          <Icon name="star" size={20} /> To remember
        </h2>
        <ul lang="ru">
          {lesson.summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
      {missed.length > 0 && (
        <section className="card gr-summary" aria-label="Worth another look">
          <h2>Worth another look</h2>
          <ul>
            {missed.map((e) => (
              <li key={e.id}>
                <b>{shownAnswer(e)}</b>
                <br />
                <span className="muted small" lang="ru">
                  {e.why}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ActionBar>
        <ContinueButton label="Back to Grammar" onClick={onExit} />
      </ActionBar>
    </div>
  );
}

/* ============ a review ============ */

function ReviewRun({ lesson, items, lessons, progress, onExit }: { lesson: GrammarLesson; items: ReviewItem[]; lessons: Map<string, GrammarLesson>; progress?: GrammarProgress; onExit: () => void }) {
  const ai = activeAi(useAi());
  const [result, setResult] = useState<{ score: number; next: number } | null>(null);
  const [reported, setReported] = useState<string[]>([]);
  if (result) {
    const pct = Math.round(result.score * 100);
    const days = Math.max(1, Math.round((result.next - new Date().setHours(0, 0, 0, 0)) / 86_400_000));
    return (
      <div className="g-game gr-done">
        {pct >= 80 && <Confetti />}
        <h1 className="g-title">Review done: {pct}%</h1>
        <p className="g-instr">
          Next review of “{lesson.title}” {days === 1 ? 'tomorrow' : `in ${days} days`}.
          {pct < 60 ? ' It was hard this time, so it comes back sooner.' : ''}
        </p>
        <section className="card gr-summary" aria-label="To remember">
          <h2>
            <Icon name="star" size={20} /> To remember
          </h2>
          <ul lang="ru">
            {lesson.summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
        <ActionBar>
          <ContinueButton label="Back to Grammar" onClick={onExit} />
        </ActionBar>
      </div>
    );
  }
  return (
    <Runner
      title={`Review · ${lesson.title}`}
      items={items}
      lessons={lessons}
      ai={ai}
      strict
      reported={reported}
      onReport={(id, lessonId) => {
        setReported((r) => [...r, id]);
        updateProgress(lessonId, (p) => ({ ...p, bad: [...new Set([...(p.bad ?? []), id])] })).catch(console.error);
        toast("Thanks. This question won't be asked again.", 'check');
      }}
      onExit={onExit}
      onFinish={(res) => {
        const mine = res.filter((r) => r.lessonId === lesson.id && !r.skipped);
        const score = mine.length ? mine.filter((r) => r.ok).length / mine.length : 1;
        const now = Date.now();
        const seen = Object.fromEntries(res.filter((r) => r.lessonId === lesson.id).map((r) => [r.id, now]));
        const next = afterReview({ ...(progress ?? freshProgress()), seen: { ...progress?.seen, ...seen } }, score, now);
        updateProgress(lesson.id, (p) => ({ ...afterReview({ ...p, seen: { ...p.seen, ...seen } }, score, now), missed: mine.filter((r) => !r.ok).map((r) => r.id) })).catch(console.error);
        setResult({ score, next: next.due ?? now });
      }}
    />
  );
}

/* ============ building blocks ============ */

/** The lesson text: [targets] plain or highlighted, one line per speaker. */
function LessonText({ text, marked }: { text: string; marked: boolean }) {
  return (
    <div className={'gr-text' + (marked ? ' marked' : '')} lang="en">
      {text.split('\n').map((line, i) => {
        const m = line.match(/^([A-Z][\w .'-]{0,20}):\s*(.*)$/);
        const body = m ? m[2] : line;
        return (
          <p key={i}>
            {m && <b className="gr-speaker">{m[1]}: </b>}
            <Highlighted text={body} marked={marked} />
          </p>
        );
      })}
    </div>
  );
}

function Highlighted({ text, marked = true }: { text: string; marked?: boolean }) {
  const parts = text.split(/(\[[^\]]+\])/);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('[') && p.endsWith(']') ? marked ? <mark key={i}>{p.slice(1, -1)}</mark> : <Fragment key={i}>{p.slice(1, -1)}</Fragment> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

function RuleCard({ lesson, only }: { lesson: GrammarLesson; only?: number }) {
  const points = only === undefined ? lesson.points.map((p, i) => [p, i] as const) : lesson.points[only] ? [[lesson.points[only], only] as const] : [];
  return (
    <div className="gr-rules">
      {only === undefined && (
        <h1 className="g-title">
          {lesson.title}
          <span className="gr-sub" lang="ru">
            {lesson.subtitle}
          </span>
        </h1>
      )}
      {points.map(([p, i]) => (
        <section key={i} className="card gr-point">
          <h2>
            <span className="gr-num">{i + 1}</span> {p.title}
          </h2>
          <p className="gr-form">{p.form}</p>
          <p lang="ru">{p.ru}</p>
          <ul className="gr-examples">
            {p.examples.map((e) => (
              <li key={e.en}>
                <span className="gr-ex-en">
                  <span>
                    <Highlighted text={e.en} />
                  </span>
                  <Speak text={e.en.replace(/[[\]]/g, '')} label="Listen" small />
                </span>
                <span className="muted small" lang="ru">
                  {e.ru}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {only === undefined && lesson.traps.length > 0 && (
        <section className="card gr-traps">
          <h2>
            <Icon name="alert" size={20} /> Traps for Russian speakers
          </h2>
          <ul>
            {lesson.traps.map((t) => (
              <li key={t.wrong}>
                <s>{t.wrong}</s>
                <b>{t.right}</b>
                <span className="muted small" lang="ru">
                  {t.why}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Read / Notice: a text, then meaning questions one by one. */
function QuestionsStep({ head, pill, intro, questions, title, onDone }: { head: ReactNode; pill: string; intro: ReactNode; questions: GChoice[]; title?: string; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const q = questions[i];
  useEnter(() => next(), picked !== null);
  const next = () => {
    if (i + 1 >= questions.length) return onDone();
    setI(i + 1);
    setPicked(null);
  };
  if (!q) {
    onDone();
    return null;
  }
  const right = picked === q.answer;
  return (
    <div className="g-game g-steady">
      {head}
      <p className="prompt-pill">
        <Icon name={pill === 'Read' ? 'book' : 'search'} size={16} /> {pill}
        {questions.length > 1 ? ` · ${i + 1} of ${questions.length}` : ''}
      </p>
      {title && <h1 className="g-title">{title}</h1>}
      {intro}
      <p className="gr-q">{q.q}</p>
      <Options q={q} picked={picked} onPick={setPicked} />
      <ActionBar
        tone={picked === null ? null : right ? 'correct' : 'wrong'}
        verdict={
          picked !== null && (
            <Verdict tone={right ? 'correct' : 'wrong'} title={right ? 'Yes!' : 'Not quite'}>
              <span lang="ru">{q.why}</span>
            </Verdict>
          )
        }
      >
        {picked === null ? (
          <button type="button" className="ghost big" onClick={() => setPicked(-1)}>
            Show answer
          </button>
        ) : (
          <ContinueButton onClick={next} />
        )}
      </ActionBar>
    </div>
  );
}

function Options({ q, picked, onPick }: { q: GChoice; picked: number | null; onPick: (i: number) => void }) {
  const done = picked !== null;
  useEffect(() => {
    if (done) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length) onPick(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, q, onPick]);
  return (
    <div className="options" role="group" aria-label="Answers">
      {q.options.map((o, i) => (
        <button key={i} type="button" className={'option' + (done && i === q.answer ? ' right' : '') + (picked === i && i !== q.answer ? ' wrong' : '')} disabled={done} onClick={() => onPick(i)}>
          <span className="kbd key-hint" aria-hidden="true">
            {i + 1}
          </span>
          <span lang={/[а-яё]/i.test(o) ? 'ru' : 'en'}>{o}</span>
          {done && (i === q.answer || picked === i) && (
            <span className="option-mark">
              <Icon name={i === q.answer ? 'check' : 'x'} size={20} strokeWidth={3} label={i === q.answer ? 'Right answer' : 'Your answer'} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export interface RunResult {
  id: string;
  lessonId: string;
  /** Right on the first try. */
  ok: boolean;
  skipped?: boolean;
}

/**
 * Exercises one by one. In practice a wrong typed answer gets a hint and a
 * second try; in the check and reviews (strict) there's one try. Every answer
 * shows why.
 */
function Runner({
  title,
  items,
  lessons,
  ai,
  strict = false,
  stepHead,
  reported,
  onReport,
  onFinish,
  onExit,
}: {
  title: string;
  items: ReviewItem[];
  lessons: Map<string, GrammarLesson>;
  ai: ActiveAi | null;
  strict?: boolean;
  stepHead?: { done: number; total: number };
  reported: string[];
  onReport: (id: string, lessonId: string) => void;
  onFinish: (results: RunResult[]) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<RunResult[]>([]);
  const item = items[index];
  useEffect(() => {
    if (!item) onFinish(results);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  if (!item) return null;
  const lesson = lessons.get(item.lessonId)!;
  return (
    <div className="g-game g-steady">
      <SessionHead done={index} total={items.length} onClose={onExit} label={stepHead ? `${title}: progress` : 'Progress'} />
      <ExerciseView
        key={`${item.lessonId}:${item.ex.id}`}
        ex={item.ex}
        lesson={lesson}
        pill={`${title} · ${index + 1} of ${items.length}`}
        other={item.lessonId !== items[0].lessonId ? lesson.title : undefined}
        ai={ai}
        strict={strict}
        reported={reported.includes(item.ex.id)}
        onReport={() => onReport(item.ex.id, item.lessonId)}
        onNext={(r) => {
          setResults((list) => [...list, { id: item.ex.id, lessonId: item.lessonId, ...r }]);
          setIndex((i) => i + 1);
          window.scrollTo({ top: 0 });
        }}
      />
    </div>
  );
}

const KIND_LABEL: Record<GExercise['kind'], string> = {
  choice: 'Choose',
  gap: 'Fill the gap',
  transform: 'Rewrite',
  fix: 'Right or wrong?',
  translate: 'Say it in English',
  write: 'About you',
};

type Outcome = 'correct' | 'almost' | 'wrong' | 'skipped' | 'self';

function ExerciseView({
  ex,
  lesson,
  pill,
  other,
  ai,
  strict,
  reported,
  onReport,
  onNext,
}: {
  ex: GExercise;
  lesson: GrammarLesson;
  pill: string;
  other?: string;
  ai: ActiveAi | null;
  strict: boolean;
  reported: boolean;
  onReport: () => void;
  onNext: (r: { ok: boolean; skipped?: boolean }) => void;
}) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  /** fix: what the learner said about the sentence. */
  const [judged, setJudged] = useState<'right' | 'wrong' | null>(null);
  const [tries, setTries] = useState(0);
  const [hint, setHint] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [okFirst, setOkFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<WritingCheck | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const typing = ex.kind === 'gap' || ex.kind === 'transform' || ex.kind === 'translate' || (ex.kind === 'fix' && judged === 'wrong' && !ex.correct);
  useEffect(() => {
    if (!typing || outcome) return;
    if (typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches) input.current?.focus({ preventScroll: true });
  }, [typing, outcome]);

  const finish = (o: Outcome, first = o === 'correct' || o === 'almost') => {
    setOutcome(o);
    setOkFirst(first && tries === 0);
  };

  const submitTyped = () => {
    if (!text.trim() || outcome) return;
    const v = gradeTyped(text, ex as TypedExercise);
    if (v !== 'wrong') return finish(v);
    if (!strict && tries === 0) {
      setTries(1);
      setHint(true);
      return;
    }
    finish('wrong', false);
  };

  const submitWrite = async () => {
    if (ex.kind !== 'write' || !text.trim() || busy || outcome) return;
    if (!ai) return finish('self', false);
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    setBusy(true);
    setError('');
    try {
      const c = await checkWriting(ai, lesson.title, ex.q, text, ctrl.signal);
      setCheck(c);
      finish(c.ok ? (c.score >= 4 ? 'correct' : 'almost') : 'wrong');
    } catch (e) {
      if (abort.current !== ctrl) return;
      setError(ctrl.signal.aborted ? 'The AI took too long to answer.' : e instanceof AiError ? e.message : 'Something went wrong.');
    } finally {
      clearTimeout(timer);
      if (abort.current === ctrl) setBusy(false);
    }
  };

  const pick = (i: number) => {
    if (ex.kind !== 'choice' || outcome) return;
    setPicked(i);
    finish(i === ex.answer ? 'correct' : i < 0 ? 'skipped' : 'wrong');
  };

  const judge = (says: 'right' | 'wrong') => {
    if (ex.kind !== 'fix' || outcome) return;
    setJudged(says);
    if (says === 'right') return finish(ex.correct ? 'correct' : 'wrong', ex.correct);
    if (ex.correct) return finish('wrong', false);
    setText(ex.q);
  };

  const next = () => onNext({ ok: okFirst, skipped: outcome === 'skipped' });
  useEnter(next, !!outcome);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (outcome) next();
      else if (ex.kind === 'write') submitWrite();
      else submitTyped();
    }
  };

  const point = ex.point !== undefined ? lesson.points[ex.point] : undefined;
  const tone: Tone | null = outcome === 'correct' || (outcome === 'self' && okFirst) ? 'correct' : outcome === 'almost' || outcome === 'self' ? 'almost' : outcome ? 'wrong' : hint ? 'hinted' : null;
  const answer = shownAnswer(ex);
  const title =
    outcome === 'correct'
      ? tries
        ? 'Right this time'
        : 'Correct!'
      : outcome === 'almost'
        ? ex.kind === 'write'
          ? 'Almost'
          : 'Almost: check the spelling'
        : outcome === 'self'
          ? 'Compare with the model'
          : outcome === 'skipped'
            ? "Here's the answer"
            : outcome === 'wrong'
              ? 'Not quite'
              : 'Not yet: try again';

  const showAnswer = outcome && outcome !== 'correct' && ex.kind !== 'write';

  return (
    <div className="exercise gr-ex">
      <p className="prompt-pill">
        <Icon name="cap" size={16} /> {pill}
      </p>
      {other && <p className="gr-other muted small">Mixed in from “{other}”</p>}
      <p className="gr-kind">{KIND_LABEL[ex.kind]}</p>

      {ex.kind === 'choice' && (
        <>
          <p className="gr-q">{ex.q}</p>
          <Options q={ex} picked={picked} onPick={pick} />
        </>
      )}

      {ex.kind === 'gap' && (
        <p className="gr-q">
          {ex.q.split(/_{2,}/).map((part, i, all) => (
            <Fragment key={i}>
              {part}
              {i < all.length - 1 && <span className="gr-blank">{ex.hint ? `(${ex.hint})` : '…'}</span>}
            </Fragment>
          ))}
        </p>
      )}

      {ex.kind === 'transform' && <p className="gr-q">{ex.q}</p>}
      {ex.kind === 'translate' && (
        <p className="gr-q gr-ru" lang="ru">
          {ex.q}
        </p>
      )}
      {ex.kind === 'write' && (
        <p className="gr-q" lang="ru">
          {ex.q}
        </p>
      )}

      {ex.kind === 'fix' && (
        <>
          <p className="gr-q gr-sentence">{ex.q}</p>
          {judged === null && !outcome && (
            <div className="options gr-judge" role="group" aria-label="Is the sentence right?">
              <button type="button" className="option" onClick={() => judge('right')}>
                <Icon name="check" size={20} /> It's right
              </button>
              <button type="button" className="option" onClick={() => judge('wrong')}>
                <Icon name="pen" size={20} /> It has a mistake
              </button>
            </div>
          )}
          {judged === 'wrong' && !ex.correct && <p className="g-instr">Fix it: change the sentence below.</p>}
        </>
      )}

      {(typing || ex.kind === 'write') && (
        <label className="field gr-field">
          <span className="sr-only">Your answer</span>
          {ex.kind === 'transform' && ex.start && <span className="gr-start">{ex.start} …</span>}
          <textarea
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
            onKeyDown={onKey}
            rows={ex.kind === 'gap' ? 1 : 2}
            lang="en"
            placeholder={ex.kind === 'gap' ? 'The missing words…' : ex.kind === 'transform' && ex.start ? 'The rest of the sentence…' : 'In English…'}
            readOnly={!!outcome}
            autoCapitalize={ex.kind === 'gap' || (ex.kind === 'transform' && ex.start) ? 'off' : 'sentences'}
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
      )}

      {hint && !outcome && point && (
        <div className="gr-hint" role="status">
          <Icon name="bulb" size={18} />
          <span>
            <b>{point.title}:</b> {point.form}
          </span>
        </div>
      )}

      {ex.kind === 'write' && !ai && !outcome && (
        <p className="muted small ai-hint">
          <Icon name="sparkles" size={16} />
          <span>
            With an AI teacher in <a href="#/settings?section=ai">Settings</a>, your sentence gets checked. Without it you compare with a model.
          </span>
        </p>
      )}

      {error && (
        <div className="g-chat-error" role="alert">
          <p className="hint-line">{error}</p>
          <button type="button" className="small" onClick={submitWrite}>
            <Icon name="reset" size={16} /> Try again
          </button>
          <button type="button" className="small ghost" onClick={() => finish('self', false)}>
            Show the model
          </button>
        </div>
      )}

      {outcome && (
        <div className="gr-feedback">
          {check && (
            <div className="gr-ai">
              <p className="gr-ai-title">
                <Icon name="sparkles" size={16} /> AI teacher · {check.score}/5
              </p>
              {check.corrected.trim() !== text.trim() && (
                <p className="gr-corrected">
                  <Marked original={text.trim()} corrected={check.corrected} />
                </p>
              )}
              {check.note && <p lang={ai?.lang === 'en' ? 'en' : 'ru'}>{check.note}</p>}
            </div>
          )}
          {showAnswer && (
            <p className="gr-answer">
              <span className="muted small">Answer</span>
              <b>{answer}</b>
            </p>
          )}
          {ex.kind === 'write' && (
            <p className="gr-answer">
              <span className="muted small">Model answer</span>
              <b>{ex.model}</b>
            </p>
          )}
          {ex.kind === 'translate' && ex.answers.length > 1 && (
            <p className="muted small">Also right: {ex.answers.slice(1, 4).join(' · ')}</p>
          )}
          {ex.why && (
            <p className="gr-why" lang="ru">
              <Icon name="bulb" size={16} /> {ex.why}
            </p>
          )}
          {outcome !== 'correct' && point && (
            <details className="gr-rule-peek">
              <summary>Rule: {point.title}</summary>
              <RuleCard lesson={lesson} only={ex.point} />
            </details>
          )}
          {!reported ? (
            <button type="button" className="link-btn small gr-report" onClick={onReport}>
              This question looks wrong
            </button>
          ) : (
            <p className="muted small">Reported. It won't be asked again.</p>
          )}
        </div>
      )}

      <ActionBar tone={outcome ? tone : hint ? 'hinted' : null} verdict={(outcome || hint) && tone ? <Verdict tone={tone} title={title} /> : null}>
        {outcome ? (
          <>
            {outcome === 'self' && (
              <>
                <button type="button" className="ghost big" onClick={() => onNext({ ok: false })}>
                  Mine was different
                </button>
                <button type="button" className="primary big" onClick={() => onNext({ ok: true })}>
                  Mine was right
                </button>
              </>
            )}
            {outcome !== 'self' && <ContinueButton onClick={next} />}
          </>
        ) : ex.kind === 'choice' || (ex.kind === 'fix' && judged === null) ? (
          <button type="button" className="ghost big" onClick={() => (ex.kind === 'choice' ? pick(-1) : finish('skipped', false))}>
            Show answer
          </button>
        ) : (
          <>
            <button type="button" className="ghost big" onClick={() => finish('skipped', false)} disabled={busy}>
              {ex.kind === 'write' ? 'Skip' : 'Show answer'}
            </button>
            <button type="button" className="primary big" onClick={ex.kind === 'write' ? submitWrite : submitTyped} disabled={!text.trim() || busy}>
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Checking…
                </>
              ) : (
                'Check'
              )}
            </button>
          </>
        )}
      </ActionBar>
    </div>
  );
}

