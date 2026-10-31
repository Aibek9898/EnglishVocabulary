import { useEffect, useRef, useState } from 'react';
import { activeAi, AiError, checkText, useAi, type Feedback, type Target } from '../lib/ai';
import { normalize } from '../lib/check';
import { diffWords } from '../lib/diff';
import { savePhrase } from '../lib/saved';
import { Icon } from './Icon';
import { toast } from './ui';

const SCORE: Record<number, string> = {
  5: 'Natural and correct',
  4: 'Correct, a bit unnatural',
  3: 'Small mistakes',
  2: 'Several mistakes',
  1: 'Hard to understand',
  0: 'Checked',
};

/**
 * "Check with AI": sends the learner's text to their AI teacher and shows the
 * feedback. Renders nothing until a key is saved in Settings, unless `hint`.
 * `onUse` lets the learner take the corrected version; `context` tells the
 * teacher what the text is (e.g. a role-play chat).
 */
export function AiCheck({
  text,
  targets,
  onUse,
  context,
  from,
  hint = false,
}: {
  text: string;
  targets: Target[];
  onUse?: (text: string) => void;
  context?: string;
  /** The word the text is about, kept with phrases saved from the feedback. */
  from?: string;
  hint?: boolean;
}) {
  const config = useAi();
  const ai = activeAi(config);
  const [result, setResult] = useState<{ text: string; feedback: Feedback | string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  if (!config) return null;
  if (!ai) {
    return hint ? (
      <p className="muted small ai-hint">
        <Icon name="sparkles" size={16} /> Connect an AI teacher in <a href="#/settings?section=ai">Settings</a> to check your sentences here.
      </p>
    ) : null;
  }

  const trimmed = text.trim();
  // Took the teacher's version: the feedback still applies, nothing to re-check.
  const adopted = !!result && typeof result.feedback !== 'string' && !!trimmed && normalize(result.feedback.corrected) === normalize(trimmed);
  const stale = !!result && !adopted && normalize(result.text) !== normalize(trimmed);

  const run = async () => {
    if (!trimmed || busy) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    setBusy(true);
    setError('');
    try {
      const feedback = await checkText(ai, trimmed, targets, { context, signal: ctrl.signal });
      setResult({ text: trimmed, feedback });
    } catch (e) {
      if (ctrl.signal.aborted) setError('The AI took too long to answer. Try again.');
      else setError(e instanceof AiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  return (
    <div className="ai-check">
      <div className="ai-check-bar">
        <button type="button" className="small ai-check-btn" onClick={run} disabled={!trimmed || busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="sparkles" size={18} />}
          {busy ? 'Checking…' : result && !stale ? 'Check again' : 'Check with AI'}
        </button>
        {stale && !busy && <span className="muted small">You changed the text. Check it again?</span>}
        {adopted && !busy && normalize(result.text) !== normalize(trimmed) && (
          <span className="small ai-adopted">
            <Icon name="check" size={16} /> Using the corrected version
          </span>
        )}
      </div>
      {error && (
        <p className="hint-line" role="alert">
          {error}
        </p>
      )}
      {result && !busy && (
        <AiFeedback feedback={result.feedback} original={result.text} lang={ai.lang} onUse={onUse && !stale && !adopted ? onUse : undefined} from={from} />
      )}
    </div>
  );
}

/** The corrected text with the changed words in bold, line by line when the lines still match up. */
export function Marked({ original, corrected }: { original: string; corrected: string }) {
  const split = (t: string) => t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const a = split(original);
  const b = split(corrected);
  const pairs = a.length === b.length ? b.map((line, i) => [a[i], line]) : [[original, corrected]];
  return pairs.map(([from, to], n) => (
    <span key={n} className="ai-line">
      {diffWords(from, to).answer.flatMap((w, i) => [i ? ' ' : '', w.same ? w.text : <b key={i}>{w.text}</b>])}
    </span>
  ));
}

export function AiFeedback({
  feedback,
  original,
  lang,
  onUse,
  from,
}: {
  feedback: Feedback | string;
  original: string;
  lang: 'ru' | 'en';
  onUse?: (text: string) => void;
  from?: string;
}) {
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const explain = lang === 'ru' ? 'ru' : 'en';

  if (typeof feedback === 'string') {
    return (
      <div className="ai-feedback" aria-live="polite">
        <p className="ai-raw">{feedback}</p>
      </div>
    );
  }
  const f = feedback;
  const changed = !!f.corrected && normalize(f.corrected) !== normalize(original);
  const tone = f.score >= 4 ? 'good' : f.score === 3 ? 'ok' : f.score ? 'bad' : '';

  const save = async (word: string) => {
    const added = await savePhrase(word, from);
    setSaved((s) => new Set(s).add(word));
    toast(added ? 'Saved to Library → Saved' : 'Already saved', 'bookmark');
  };

  return (
    <div className="ai-feedback" aria-live="polite" data-term={from}>
      <div className={'ai-score ' + tone}>
        <b>{SCORE[f.score] ?? SCORE[0]}</b>
        {f.score > 0 && (
          <span className="ai-dots" aria-label={`${f.score} of 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <i key={n} className={n <= f.score ? 'on' : ''} />
            ))}
          </span>
        )}
      </div>
      {f.summary && <p lang={explain}>{f.summary}</p>}

      {changed && (
        <section className="ai-block">
          <h4>Better</h4>
          <p className="ai-corrected">
            <Marked original={original} corrected={f.corrected} />
          </p>
          {onUse && (
            <button type="button" className="small" onClick={() => onUse(f.corrected)}>
              <Icon name="check" size={16} /> Use this version
            </button>
          )}
        </section>
      )}

      {f.mistakes.length > 0 && (
        <section className="ai-block">
          <h4>Mistakes</h4>
          <ul className="ai-list">
            {f.mistakes.map((m, i) => (
              <li key={i}>
                <span>
                  {m.wrong && <s>{m.wrong}</s>}
                  {m.wrong && m.right && ' → '}
                  {m.right && <b>{m.right}</b>}
                </span>
                {m.why && (
                  <span className="ai-why" lang={explain}>
                    {m.why}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {f.phrases.length > 0 && (
        <section className="ai-block">
          <h4>Your phrases</h4>
          <ul className="ai-list">
            {f.phrases.map((p, i) => (
              <li key={i}>
                <span>
                  <Icon name={p.ok ? 'check' : 'alert'} size={16} className={p.ok ? 'ok-mark' : 'warn-mark'} label={p.ok ? 'Used well' : 'Needs work'} /> <b>{p.phrase}</b>
                </span>
                {p.comment && (
                  <span className="ai-why" lang={explain}>
                    {p.comment}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {f.alternatives.length > 0 && (
        <section className="ai-block">
          <h4>Other ways to say it</h4>
          <ul className="ai-list">
            {f.alternatives.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      {f.words.length > 0 && (
        <section className="ai-block">
          <h4>Words you could use</h4>
          <ul className="ai-list ai-words">
            {f.words.map((w) => (
              <li key={w.word}>
                <span className="ai-word">
                  <b>{w.word}</b>
                  {w.meaning && (
                    <span className="muted" lang={explain}>
                      {' '}
                      — {w.meaning}
                    </span>
                  )}
                  <button
                    type="button"
                    className="icon-btn ai-save"
                    onClick={() => save(w.word)}
                    disabled={saved.has(w.word)}
                    aria-label={saved.has(w.word) ? `“${w.word}” saved` : `Save “${w.word}” to learn later`}
                  >
                    <Icon name={saved.has(w.word) ? 'check' : 'bookmark'} size={18} />
                  </button>
                </span>
                {w.example && <span className="ai-example">{w.example}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {f.tip && (
        <p className="ai-tip" lang={explain}>
          <Icon name="bulb" size={18} /> {f.tip}
        </p>
      )}
    </div>
  );
}
