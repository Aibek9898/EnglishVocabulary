import { useMemo, useState } from 'react';
import { Exercise } from '../components/Exercise';
import { ItemCard } from '../components/ItemCard';
import { MatchPairs } from '../components/MatchPairs';
import { parseCloze } from '../lib/cloze';
import { db, useLive } from '../lib/db';
import { canSpeak } from '../lib/speech';
import { recordResult } from '../lib/srs';
import type { ExerciseKind, Item, Result } from '../lib/types';

type Game = 'pairs' | 'quiz' | 'typing' | 'dictation' | 'flashcards';

const GAMES: { id: Game; title: string; text: string; icon: string }[] = [
  { id: 'pairs', icon: '🧩', title: 'Match pairs', text: 'Five English–Russian pairs against the clock.' },
  { id: 'quiz', icon: '⚡', title: 'Quick quiz', text: '10 multiple-choice questions.' },
  { id: 'typing', icon: '⌨️', title: 'Typing sprint', text: '10 gaps to fill from memory.' },
  { id: 'dictation', icon: '🎧', title: 'Dictation', text: 'Listen and type 10 phrases.' },
  { id: 'flashcards', icon: '🃏', title: 'Flashcards', text: 'Flip through cards at your own pace.' },
];

const ROUND = 10;

/** Free practice: games log activity for your streak but never change the review schedule. */
export function Practice() {
  const items = useLive(() => db.items.toArray(), [], [] as Item[]);
  const [scope, setScope] = useState('learned');
  const [game, setGame] = useState<Game | null>(null);
  const [runId, setRunId] = useState(0);

  const tags = useMemo(() => [...new Set(items.flatMap((i) => i.tags))].sort(), [items]);
  const pool = useMemo(() => {
    const active = items.filter((i) => !i.suspended);
    if (scope === 'learned') return active.filter((i) => i.level > 0);
    if (scope === 'all') return active;
    if (scope === 'weak') return active.filter((i) => i.level > 0 && (i.level <= 2 || i.card.lapses >= 2));
    return active.filter((i) => i.tags.includes(scope));
  }, [items, scope]);

  if (game) {
    return (
      <section className="page">
        <div className="session-bar">
          <button className="ghost small" onClick={() => setGame(null)}>
            ← Games
          </button>
          <span className="muted small">{GAMES.find((g) => g.id === game)?.title}</span>
        </div>
        <GameRun key={runId} game={game} pool={pool} all={items} onAgain={() => setRunId((n) => n + 1)} onExit={() => setGame(null)} />
      </section>
    );
  }

  return (
    <section className="page">
      <h1>Practice</h1>
      <label className="field inline">
        <span>Words:</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="learned">Words I've started ({items.filter((i) => i.level > 0).length})</option>
          <option value="weak">Weak words</option>
          <option value="all">Everything in my library</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              Tag: {t}
            </option>
          ))}
        </select>
      </label>
      {pool.length < 5 ? (
        <div className="card">
          <p className="muted">
            You need at least 5 words here to play. {scope === 'learned' ? 'Do a session on Today first, or choose “Everything”.' : ''}
          </p>
        </div>
      ) : (
        <div className="game-grid">
          {GAMES.filter((g) => g.id !== 'dictation' || canSpeak).map((g) => (
            <button key={g.id} className="game-card" onClick={() => setGame(g.id)}>
              <span className="game-icon">{g.icon}</span>
              <b>{g.title}</b>
              <span className="muted small">{g.text}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function GameRun({ game, pool, all, onAgain, onExit }: { game: Game; pool: Item[]; all: Item[]; onAgain: () => void; onExit: () => void }) {
  const round = useMemo(() => [...pool].sort(() => Math.random() - 0.5).slice(0, ROUND), [pool]);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [pairsResult, setPairsResult] = useState<string | null>(null);

  const kind: ExerciseKind =
    game === 'quiz' ? 'choice' : game === 'dictation' ? 'dictation' : 'cloze';

  if (game === 'pairs') {
    if (pairsResult) return <GameOver text={pairsResult} onAgain={onAgain} onExit={onExit} />;
    return (
      <MatchPairs
        items={round.slice(0, 5)}
        onFinish={async (mistakes, seconds) => {
          for (const i of round.slice(0, 5)) await recordResult(i, 'pairs', 'correct', false);
          setPairsResult(`Done in ${seconds}s with ${mistakes} mistake${mistakes === 1 ? '' : 's'}.`);
        }}
      />
    );
  }

  if (game === 'flashcards') return <Flashcards items={round} onExit={onExit} />;

  if (index >= round.length) {
    return <GameOver text={`${score} / ${round.length} right`} onAgain={onAgain} onExit={onExit} />;
  }
  const item = round[index];
  const thisKind = kind === 'cloze' && !parseCloze(item.example, item.term) ? 'recall' : kind;
  return (
    <>
      <p className="muted small">
        {index + 1} / {round.length} · score {score}
      </p>
      <Exercise
        key={index}
        item={item}
        kind={thisKind}
        pool={all}
        onDone={async (result: Result) => {
          await recordResult(item, thisKind, result, false);
          if (result !== 'wrong') setScore((s) => s + 1);
          setIndex((i) => i + 1);
        }}
      />
    </>
  );
}

function Flashcards({ items, onExit }: { items: Item[]; onExit: () => void }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const item = items[index];
  const go = (d: number) => {
    setFlipped(false);
    setIndex((i) => (i + d + items.length) % items.length);
  };
  return (
    <div className="exercise">
      <p className="muted small">
        {index + 1} / {items.length} · tap the card to flip
      </p>
      <button className="flashcard" onClick={() => setFlipped(!flipped)}>
        {flipped ? <ItemCard item={item} /> : <span className="prompt-main">{item.translation}</span>}
      </button>
      <div className="row">
        <button className="ghost" onClick={() => go(-1)}>
          ← Back
        </button>
        <button
          className="primary"
          onClick={async () => {
            await recordResult(item, 'flashcard', 'done', false);
            if (index === items.length - 1) onExit();
            else go(1);
          }}
        >
          {index === items.length - 1 ? 'Finish' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

function GameOver({ text, onAgain, onExit }: { text: string; onAgain: () => void; onExit: () => void }) {
  return (
    <div className="card center">
      <p className="big">🏁 {text}</p>
      <div className="row center">
        <button className="primary" onClick={onAgain} autoFocus>
          Play again
        </button>
        <button className="ghost" onClick={onExit}>
          Other games
        </button>
      </div>
    </div>
  );
}
