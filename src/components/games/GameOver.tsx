import { useEffect, type ReactNode } from 'react';
import { scoreTitle } from '../../lib/games';
import { Speak } from '../Speak';
import { ActionBar, Confetti, ContinueButton, Ring, useCountUp } from '../ui';

/** One line of the "Missed" list. */
export interface Miss {
  key: string;
  /** The right phrase or sentence, in bold. */
  text: string;
  /** Usually the Russian translation. */
  sub?: string;
  subLang?: 'ru';
  /** What was shown wrongly, struck through above the right version. */
  struck?: string;
  /** A short note under the line. */
  note?: string;
  /** What the speak button reads; defaults to `text`. */
  speak?: string;
}

/**
 * The shared end screen of every game: a ring (or a big number when there is
 * no maximum), a title, the missed words with a speak button each, and
 * "Play again" / "Other games".
 */
export function GameOver({
  score,
  max,
  unit,
  title,
  summary,
  extra,
  misses = [],
  missesTitle = 'Missed',
  children,
  onAgain,
  onExit,
}: {
  score: number;
  /** Omit for open-ended games (shows a big number instead of a ring). */
  max?: number;
  /** Shown after the big number, e.g. "points". */
  unit?: string;
  title?: string;
  summary: ReactNode;
  /** Chips under the summary, e.g. a best score. */
  extra?: ReactNode;
  misses?: Miss[];
  missesTitle?: string;
  children?: ReactNode;
  onAgain: () => void;
  onExit: () => void;
}) {
  const n = useCountUp(score);
  const hasMax = max !== undefined && max > 0;
  const heading = title ?? scoreTitle(score, max ?? 0);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="g-game g-over">
      {hasMax && score >= max! && max! >= 3 && <Confetti />}
      <div className="g-over-hero">
        <div className="end-ring">
          {hasMax ? (
            <Ring value={score} max={max!} size={132} stroke={12} label={`${score} of ${max}`}>
              {`${n}/${max}`}
            </Ring>
          ) : (
            <div className="g-bignum" role="img" aria-label={`${score}${unit ? ` ${unit}` : ''}`}>
              <span aria-hidden="true">{n}</span>
              {unit && <small aria-hidden="true">{unit}</small>}
            </div>
          )}
        </div>
        <h1 className="g-over-title">{heading}</h1>
        <p className="g-over-summary">{summary}</p>
        {extra && <div className="chips g-over-extra">{extra}</div>}
      </div>

      {children}

      {misses.length > 0 && (
        <section className="g-misses" aria-label={missesTitle}>
          <h2 className="section-title">
            {missesTitle} · {misses.length}
          </h2>
          <ul className="result-list g-miss-list">
            {misses.map((m) => (
              <li key={m.key}>
                <div className="g-miss-text">
                  {m.struck && (
                    <s className="g-miss-struck">
                      <span className="sr-only">Wrong: </span>
                      {m.struck}
                    </s>
                  )}
                  <span>
                    <b>{m.text}</b>
                    {m.sub && (
                      <>
                        {' — '}
                        <span className="g-miss-sub" lang={m.subLang}>
                          {m.sub}
                        </span>
                      </>
                    )}
                  </span>
                  {m.note && <span className="g-miss-note">{m.note}</span>}
                </div>
                <Speak text={m.speak ?? m.text} label={`Listen: ${m.speak ?? m.text}`} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ActionBar>
        <button type="button" className="ghost big" onClick={onExit}>
          Other games
        </button>
        <ContinueButton label="Play again" onClick={onAgain} />
      </ActionBar>
    </div>
  );
}
