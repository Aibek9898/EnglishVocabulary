import { useEffect, useMemo, useState } from 'react';
import type { Item } from '../lib/types';

interface Tile {
  id: string;
  itemId: string;
  text: string;
  side: 'en' | 'ru';
}

const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);

/** Five English–Russian pairs against the clock. */
export function MatchPairs({ items, onFinish }: { items: Item[]; onFinish: (mistakes: number, seconds: number) => void }) {
  const round = useMemo(() => shuffle(items).slice(0, 5), [items]);
  const tiles = useMemo(() => {
    const en = shuffle(round.map<Tile>((i) => ({ id: `en-${i.id}`, itemId: i.id, text: i.term, side: 'en' })));
    const ru = shuffle(round.map<Tile>((i) => ({ id: `ru-${i.id}`, itemId: i.id, text: i.translation, side: 'ru' })));
    return { en, ru };
  }, [round]);
  const [selected, setSelected] = useState<Tile | null>(null);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [started] = useState(Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (round.length && matched.size === round.length) onFinish(mistakes, Math.round((Date.now() - started) / 1000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched]);

  const click = (t: Tile) => {
    if (matched.has(t.itemId)) return;
    if (!selected || selected.side === t.side) {
      setSelected(t);
      return;
    }
    if (selected.itemId === t.itemId) {
      setMatched(new Set(matched).add(t.itemId));
    } else {
      setMistakes((m) => m + 1);
      setWrong([selected.id, t.id]);
      setTimeout(() => setWrong([]), 500);
    }
    setSelected(null);
  };

  const cls = (t: Tile) =>
    'tile' +
    (matched.has(t.itemId) ? ' done' : '') +
    (selected?.id === t.id ? ' selected' : '') +
    (wrong.includes(t.id) ? ' wrong' : '');

  return (
    <div className="pairs">
      <p className="muted small">
        ⏱ {Math.round((now - started) / 1000)}s · mistakes: {mistakes}
      </p>
      <div className="pairs-grid">
        <div className="pairs-col">
          {tiles.en.map((t) => (
            <button key={t.id} className={cls(t)} onClick={() => click(t)} disabled={matched.has(t.itemId)}>
              {t.text}
            </button>
          ))}
        </div>
        <div className="pairs-col">
          {tiles.ru.map((t) => (
            <button key={t.id} className={cls(t)} onClick={() => click(t)} disabled={matched.has(t.itemId)}>
              {t.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
