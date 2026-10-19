import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime, shuffle } from '../lib/games';
import type { Item } from '../lib/types';
import { Icon } from './Icon';

interface Tile {
  id: string;
  itemId: string;
  text: string;
  side: 'en' | 'ru';
}

const BOARD = 5;

/**
 * English–Russian pairs against the clock, five pairs per board. With more
 * than five items the next board appears when one is cleared; the timer runs
 * across boards.
 */
export function MatchPairs({
  items,
  onFinish,
  onProgress,
}: {
  items: Item[];
  /** `missed` holds the ids of words the learner tried to match wrongly. */
  onFinish: (mistakes: number, seconds: number, missed: string[]) => void;
  /** Called with the number of pairs matched so far. */
  onProgress?: (matched: number) => void;
}) {
  const boards = useMemo(() => {
    const list = shuffle(items);
    const out: Item[][] = [];
    for (let i = 0; i < list.length; i += BOARD) out.push(list.slice(i, i + BOARD));
    return out;
  }, [items]);
  const [board, setBoard] = useState(0);
  const round = boards[board] ?? [];
  const tiles = useMemo(
    () => ({
      en: shuffle(round.map<Tile>((i) => ({ id: `en-${i.id}`, itemId: i.id, text: i.term, side: 'en' }))),
      ru: shuffle(round.map<Tile>((i) => ({ id: `ru-${i.id}`, itemId: i.id, text: i.translation, side: 'ru' }))),
    }),
    [round],
  );
  const [selected, setSelected] = useState<Tile | null>(null);
  const [matched, setMatched] = useState<Set<string>>(() => new Set());
  const [flash, setFlash] = useState<{ ids: string[]; ok: boolean } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [missed, setMissed] = useState<Set<string>>(() => new Set());
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [finished, setFinished] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [finished]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };

  const click = (t: Tile) => {
    if (matched.has(t.itemId) || finished) return;
    if (!selected || selected.side === t.side) {
      setSelected(selected?.id === t.id ? null : t);
      return;
    }
    setSelected(null);
    if (selected.itemId === t.itemId) {
      const next = new Set(matched).add(t.itemId);
      setMatched(next);
      onProgress?.(next.size);
      setFlash({ ids: [selected.id, t.id], ok: true });
      const boardDone = round.every((i) => next.has(i.id));
      later(() => {
        setFlash(null);
        if (!boardDone) return;
        if (board + 1 < boards.length) setBoard(board + 1);
        else {
          setFinished(true);
          onFinish(mistakes, Math.round((Date.now() - started) / 1000), [...missed]);
        }
      }, 360);
    } else {
      setMistakes((m) => m + 1);
      setMissed(new Set(missed).add(selected.itemId));
      setFlash({ ids: [selected.id, t.id], ok: false });
      later(() => setFlash(null), 450);
    }
  };

  const cls = (t: Tile) => {
    const inFlash = flash?.ids.includes(t.id);
    if (inFlash) return flash!.ok ? 'tile matched' : 'tile wrong';
    if (matched.has(t.itemId)) return 'tile done';
    return selected?.id === t.id ? 'tile selected' : 'tile';
  };

  const column = (list: Tile[], lang?: 'ru') =>
    list.map((t) => (
      <button
        key={t.id}
        type="button"
        className={cls(t)}
        lang={lang}
        onClick={() => click(t)}
        disabled={matched.has(t.itemId) && !flash?.ids.includes(t.id)}
        aria-pressed={selected?.id === t.id}
      >
        {t.text}
      </button>
    ));

  return (
    <div className="pairs">
      <p className="g-instr">Tap an English phrase, then its meaning.</p>
      <div className="g-pairs-meta">
        <span className="chip" role="timer" aria-label={`Time: ${formatTime((now - started) / 1000)}`}>
          <Icon name="timer" size={16} />
          {formatTime((now - started) / 1000)}
        </span>
        <span className={mistakes ? 'chip bad' : 'chip'}>
          <Icon name="x" size={16} strokeWidth={2.5} />
          {mistakes} {mistakes === 1 ? 'mistake' : 'mistakes'}
        </span>
        {boards.length > 1 && (
          <span className="chip brand g-pairs-board">
            Board {board + 1} of {boards.length}
          </span>
        )}
      </div>
      <div className="pairs-grid" key={board}>
        <div className="pairs-col" role="group" aria-label="English">
          {column(tiles.en)}
        </div>
        <div className="pairs-col" role="group" aria-label="Russian">
          {column(tiles.ru, 'ru')}
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        {flash ? (flash.ok ? 'Match!' : 'Not a pair') : ''}
      </div>
    </div>
  );
}
