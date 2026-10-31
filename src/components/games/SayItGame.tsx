import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { activeAi, AiError, checkTranslation, useAi, type ActiveAi, type Feedback } from '../../lib/ai';
import { normalize } from '../../lib/check';
import { EVERYDAY, getSeen, markSeen, matchesReference, pickRound, TOPICS, type Everyday } from '../../lib/everyday';
import { AiFeedback } from '../AiCheck';
import { Icon } from '../Icon';
import { Speak } from '../Speak';
import { ActionBar, ContinueButton, SessionHead, Verdict, useEnter } from '../ui';
import { GameOver, type Miss } from './GameOver';
import { EXIT_LABEL, praise, type GameProps } from './shared';

type Outcome = 'correct' | 'almost' | 'wrong' | 'compare' | 'skipped';

interface Answer {
  item: Everyday;
  text: string;
  outcome: Outcome;
  /** The AI's corrected version, when it changed something. */
  better?: string;
}

/** Say it in English: translate everyday Russian sentences; the AI teacher checks each one. */
export function SayItGame({ onExit, onAgain }: GameProps) {
  const config = useAi();
  const [round, setRound] = useState<{ list: Everyday[]; ai: ActiveAi | null } | null>(null);
  if (!round) {
    return (
      <TopicPicker
        live={!!activeAi(config)}
        onExit={onExit}
        onStart={async (topic) => {
          const ai = activeAi(config);
          setRound({ list: pickRound(EVERYDAY, topic, await getSeen()), ai });
        }}
      />
    );
  }
  return <Play list={round.list} ai={round.ai} onExit={onExit} onAgain={onAgain} />;
}

function TopicPicker({ live, onStart, onExit }: { live: boolean; onStart: (topic: string | null) => void; onExit: () => void }) {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  const count = (id: string | null) => (id ? EVERYDAY.filter((e) => e.topic === id).length : EVERYDAY.length);
  return (
    <div className="g-game">
      <div className="g-head-plain">
        <SessionHead done={0} total={1} onClose={onExit} closeLabel={EXIT_LABEL} label="Say it in English" />
      </div>
      <h1 className="g-title">Say it in English</h1>
      <p className="g-instr">Things people say every day, in Russian. Write how you'd say each one in English.</p>
      {live ? (
        <p className="g-live-note">
          <Icon name="sparkles" size={18} /> The AI teacher checks every answer: is it right, does it sound natural, and how would a native speaker say it.
        </p>
      ) : (
        <p className="muted small ai-hint">
          <Icon name="sparkles" size={16} /> Without an AI you compare with the usual translations. Connect an AI teacher in <a href="#/settings?section=ai">Settings</a> to get
          every answer checked.
        </p>
      )}
      <div className="say-topics">
        {[{ id: null as string | null, label: 'All topics' }, ...TOPICS].map((t) => (
          <button key={t.id ?? 'all'} type="button" className={'say-topic' + (t.id ? '' : ' all')} onClick={() => onStart(t.id)} disabled={!count(t.id)}>
            <b>{t.label}</b>
            <span>{count(t.id)} phrases</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function verdictOf(feedback: Feedback | string): Outcome {
  if (typeof feedback === 'string' || !feedback.score) return 'compare';
  return feedback.score >= 4 ? 'correct' : feedback.score === 3 ? 'almost' : 'wrong';
}

function Play({ list, ai, onExit, onAgain }: { list: Everyday[]; ai: ActiveAi | null; onExit: () => void; onAgain: () => void }) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<Feedback | string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [combo, setCombo] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const item = list[index] as Everyday | undefined;
  const score = answers.filter((a) => a.outcome === 'correct').length;

  const finish = (result: Outcome, fb: Feedback | string | null = null) => {
    if (!item) return;
    setOutcome(result);
    setFeedback(fb);
    const better = fb && typeof fb !== 'string' && fb.corrected && normalize(fb.corrected) !== normalize(text) ? fb.corrected : undefined;
    setAnswers((a) => [...a, { item, text: text.trim(), outcome: result, better }]);
    setCombo((c) => (result === 'correct' ? c + 1 : 0));
    markSeen([item.id]).catch(console.error);
  };

  const check = async () => {
    const answer = text.trim();
    if (!item || !answer || busy || outcome) return;
    if (!ai) {
      finish(matchesReference(answer, item.en) ? 'correct' : 'compare');
      return;
    }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    setBusy(true);
    setError('');
    try {
      const fb = await checkTranslation(ai, item.ru, item.en, answer, ctrl.signal);
      finish(verdictOf(fb), fb);
    } catch (e) {
      if (abort.current !== ctrl) return;
      setError(ctrl.signal.aborted ? 'The AI took too long to answer.' : e instanceof AiError ? e.message : 'Something went wrong.');
    } finally {
      clearTimeout(timer);
      if (abort.current === ctrl) setBusy(false);
    }
  };

  /** "Mine was right": the learner's version means the same, the list just didn't have it. */
  const markRight = () => {
    setOutcome('correct');
    setAnswers((a) => a.map((x, i) => (i === a.length - 1 ? { ...x, outcome: 'correct' } : x)));
    setCombo((c) => c + 1);
  };

  const next = () => {
    abort.current?.abort();
    abort.current = null;
    setText('');
    setHint(false);
    setBusy(false);
    setError('');
    setFeedback(null);
    setOutcome(null);
    setIndex((i) => i + 1);
  };

  useEnter(next, !!outcome);
  useEffect(() => {
    if (outcome || !item) return;
    // On phones the keyboard would cover the sentence, so only focus with a real keyboard.
    if (typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches) input.current?.focus({ preventScroll: true });
  }, [index, outcome, item]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (outcome) next();
      else check();
    }
  };

  if (!item) {
    const misses: Miss[] = answers
      .filter((a) => a.outcome !== 'correct')
      .map((a) => ({ key: a.item.id, text: a.better ?? a.item.en[0], sub: a.item.ru, subLang: 'ru', struck: a.text && a.outcome !== 'skipped' ? a.text : undefined }));
    return (
      <GameOver
        score={score}
        max={list.length}
        summary={`${score} of ${list.length} said ${ai ? 'naturally' : 'like the usual translation'}`}
        misses={misses}
        missesTitle="Worth another look"
        onAgain={onAgain}
        onExit={onExit}
      />
    );
  }

  const tone = outcome === 'correct' ? 'correct' : outcome === 'almost' || outcome === 'compare' ? 'almost' : outcome ? 'wrong' : null;
  const title =
    outcome === 'correct'
      ? praise(score)
      : outcome === 'almost'
        ? 'Almost'
        : outcome === 'compare'
          ? 'Compare with these'
          : outcome === 'skipped'
            ? 'Here is how to say it'
            : 'Not quite';

  return (
    <div className="g-game g-steady">
      <SessionHead done={index} total={list.length} combo={combo} onClose={onExit} closeLabel={EXIT_LABEL} label="Game progress" />
      <div className="exercise" key={item.id}>
        <p className="prompt-pill">
          <Icon name="message" size={16} /> Say it in English
        </p>
        <p className="prompt-ru g-ru say-ru" lang="ru">
          {item.ru}
        </p>
        <label className="field">
          <span className="sr-only">Your English</span>
          <textarea
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
            onKeyDown={onKey}
            rows={2}
            lang="en"
            placeholder="In English…"
            readOnly={!!outcome}
            autoCapitalize="sentences"
          />
        </label>
        {!outcome && item.hint && (
          <p className="say-hint">
            {hint ? (
              <span>
                <Icon name="bulb" size={16} /> {item.hint}
              </span>
            ) : (
              <button type="button" className="link-btn" onClick={() => setHint(true)}>
                <Icon name="bulb" size={16} /> Show a hint
              </button>
            )}
          </p>
        )}
        {error && (
          <div className="g-chat-error" role="alert">
            <p className="hint-line">{error}</p>
            <button type="button" className="small" onClick={check}>
              <Icon name="reset" size={16} /> Try again
            </button>
            <button type="button" className="small ghost" onClick={() => finish('compare')}>
              Show the answer
            </button>
          </div>
        )}

        {outcome && (
          <div className="say-result">
            {feedback && <AiFeedback feedback={feedback} original={text.trim()} lang={ai?.lang ?? 'ru'} />}
            <section className="say-refs" aria-label="How people usually say it">
              <h4>{feedback ? 'The usual way' : 'How people usually say it'}</h4>
              <ul>
                {item.en.map((en) => (
                  <li key={en}>
                    <span>{en}</span>
                    <Speak text={en} label={`Listen: ${en}`} small />
                  </li>
                ))}
              </ul>
              {item.hint && (
                <p className="muted small">
                  <Icon name="bulb" size={14} /> {item.hint}
                </p>
              )}
            </section>
          </div>
        )}
      </div>

      <ActionBar tone={tone} verdict={outcome ? <Verdict tone={tone ?? 'almost'} title={title} /> : null}>
        {outcome ? (
          <>
            {outcome === 'compare' && text.trim() && (
              <button type="button" className="ghost big" onClick={markRight}>
                Mine was right
              </button>
            )}
            <ContinueButton label={index + 1 === list.length ? 'See results' : 'Continue'} onClick={next} />
          </>
        ) : (
          <>
            <button type="button" className="ghost big" onClick={() => finish('skipped')} disabled={busy}>
              Show answer
            </button>
            <button type="button" className="primary big" onClick={check} disabled={!text.trim() || busy}>
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
