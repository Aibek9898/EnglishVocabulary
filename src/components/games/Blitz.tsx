import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { blitzDeck, formatTime, type Statement } from '../../lib/games';
import { Icon } from '../Icon';
import { ActionBar, ContinueButton, SessionHead } from '../ui';
import { GameOver } from './GameOver';
import { EXIT_LABEL, logGame, plural, useKeys, useLater, type GameProps } from './shared';

const SECONDS = 60;
const BEST_KEY = 'vocab-blitz-best';
/** How far a card must be dragged to count as an answer. */
const SWIPE = 80;

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(n: number) {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    // Private mode or blocked storage: the best score just isn't kept.
  }
}

/** Natural or not? One sentence at a time for 60 seconds: natural English, or a typical mistake. */
export function Blitz({ pool, onExit, onAgain }: GameProps) {
  const [phase, setPhase] = useState<'ready' | 'play' | 'over'>('ready');
  const [queue, setQueue] = useState<Statement[]>(() => blitzDeck(pool));
  const [pos, setPos] = useState(0);
  const [endAt, setEndAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [combo, setCombo] = useState(0);
  const [misses, setMisses] = useState<Statement[]>([]);
  const [flash, setFlash] = useState<boolean | null>(null);
  const [best, setBest] = useState(readBest);
  const [newBest, setNewBest] = useState(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; id: number } | null>(null);
  const decks = useRef(0);
  const later = useLater();

  const left = phase === 'play' ? Math.max(0, Math.ceil((endAt - now) / 1000)) : SECONDS;
  const current = queue[pos];

  useEffect(() => {
    if (phase !== 'play') return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'play' || now < endAt) return;
    setPhase('over');
    if (score > best) {
      saveBest(score);
      setNewBest(true);
      setBest(score);
    }
  }, [phase, now, endAt, score, best]);

  const start = () => {
    const t = Date.now();
    setEndAt(t + SECONDS * 1000);
    setNow(t);
    setPhase('play');
  };

  const answer = (natural: boolean) => {
    if (phase !== 'play' || flash !== null || !current || Date.now() >= endAt) return;
    const ok = current.natural === natural;
    logGame(current.item, 'game', ok ? 'correct' : 'wrong');
    setAnswered((n) => n + 1);
    if (ok) setScore((s) => s + 1);
    else setMisses((m) => [...m, current]);
    setCombo((c) => (ok ? c + 1 : 0));
    setFlash(ok);
    later(
      () => {
        setFlash(null);
        setDx(0);
        if (pos + 1 >= queue.length) setQueue((q) => [...q, ...blitzDeck(pool, Math.random, ++decks.current)]);
        setPos((p) => p + 1);
      },
      ok ? 260 : 520,
    );
  };

  useKeys(
    (key) => {
      if (key === 'ArrowRight' || key === 'l' || key === 'L') answer(true);
      else if (key === 'ArrowLeft' || key === 'a' || key === 'A') answer(false);
    },
    phase === 'play',
  );

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (flash !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { x: e.clientX, id: e.pointerId };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (Math.abs(dx) >= SWIPE && flash === null) {
      answer(dx > 0);
      // Let the card fly off in the direction of the swipe.
      setDx(dx > 0 ? 640 : -640);
    } else setDx(0);
  };
  const onCancel = () => {
    drag.current = null;
    setDragging(false);
    setDx(0);
  };

  if (phase === 'over') {
    return (
      <GameOver
        score={score}
        unit={score === 1 ? 'point' : 'points'}
        title="Time's up!"
        summary={answered ? `${score} of ${plural(answered, 'sentence')} right` : 'No answers this time.'}
        extra={
          newBest ? (
            <span className="chip gold">
              <Icon name="star" size={14} /> New best score!
            </span>
          ) : (
            <span className="chip">
              <Icon name="star" size={14} /> Best: {best}
            </span>
          )
        }
        misses={misses.map((s, k) =>
          s.natural
            ? { key: `${s.id}-${k}`, text: s.right, note: 'This one was natural.' }
            : { key: `${s.id}-${k}`, struck: s.text, text: s.right },
        )}
        onAgain={onAgain}
        onExit={onExit}
      />
    );
  }

  if (phase === 'ready') {
    return (
      <div className="g-game">
        <div className="g-head-plain">
          <SessionHead done={0} total={SECONDS} onClose={onExit} closeLabel={EXIT_LABEL} label="Time" />
        </div>
        <div className="g-intro">
          <span className="game-icon flame">
            <Icon name="timer" size={32} />
          </span>
          <h1>Natural or not?</h1>
          <p className="g-instr">Is each sentence natural English? Answer as many as you can in 60 seconds.</p>
          <ul className="g-howto">
            <li>
              <span className="g-howto-icon yes">
                <Icon name="check" size={18} strokeWidth={3} />
              </span>
              <span>
                <b>Natural</b>
                <span className="g-howto-sub">Swipe right or press →</span>
              </span>
            </li>
            <li>
              <span className="g-howto-icon no">
                <Icon name="x" size={18} strokeWidth={3} />
              </span>
              <span>
                <b>Mistake</b>
                <span className="g-howto-sub">Swipe left or press ←</span>
              </span>
            </li>
          </ul>
          {best > 0 && (
            <span className="chip gold">
              <Icon name="star" size={14} /> Best: {best}
            </span>
          )}
        </div>
        <ActionBar>
          <ContinueButton label="Start" onClick={start} />
        </ActionBar>
      </div>
    );
  }

  const tilt = Math.max(-1, Math.min(1, dx / 160));
  return (
    <div className="g-game g-blitz">
      <div className="g-head-plain">
        <SessionHead done={left} total={SECONDS} combo={combo} onClose={onExit} closeLabel={EXIT_LABEL} label="Time left" />
      </div>
      <div className="g-blitz-stats">
        <span className={'g-timer' + (left <= 10 ? ' is-low' : '')} role="timer" aria-label={`${left} seconds left`}>
          <Icon name="timer" size={18} />
          {formatTime(left)}
        </span>
        <span className="g-score" aria-label={`Score: ${score}`}>
          <Icon name="star" size={16} />
          {score}
        </span>
      </div>

      <div className="g-stage">
        {current && (
          <div
            key={`${current.id}-${pos}`}
            className={
              'g-statement' +
              (dragging ? ' is-dragging' : '') +
              (flash === true ? ' is-right' : flash === false ? ' is-wrong shake' : '')
            }
            style={dx ? { transform: `translateX(${dx}px) rotate(${tilt * 6}deg)` } : undefined}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onCancel}
          >
            <span className="g-swipe-tag yes" style={{ opacity: Math.max(0, tilt) }} aria-hidden="true">
              Natural
            </span>
            <span className="g-swipe-tag no" style={{ opacity: Math.max(0, -tilt) }} aria-hidden="true">
              Mistake
            </span>
            <p className="g-statement-text">{current.text}</p>
            {flash !== null && (
              <span className={'g-statement-mark' + (flash ? ' yes' : ' no')} aria-hidden="true">
                <Icon name={flash ? 'check' : 'x'} size={22} strokeWidth={3} />
              </span>
            )}
          </div>
        )}
      </div>
      <p className="g-swipe-hint">Swipe right if it sounds natural, left if it has a mistake.</p>

      <div className="g-judges">
        <ActionBar
          verdict={
            <span className="sr-only">
              {flash === null ? '' : flash ? `Right. Score ${score}.` : `Wrong. Score ${score}.`}
            </span>
          }
        >
          <button type="button" className="g-judge no" onClick={() => answer(false)} aria-keyshortcuts="ArrowLeft A">
            <span className="kbd key-hint">←</span>
            <Icon name="x" size={22} strokeWidth={3} /> Mistake
          </button>
          <button type="button" className="g-judge yes" onClick={() => answer(true)} aria-keyshortcuts="ArrowRight L">
            <Icon name="check" size={22} strokeWidth={3} /> Natural
            <span className="kbd key-hint">→</span>
          </button>
        </ActionBar>
      </div>
    </div>
  );
}
