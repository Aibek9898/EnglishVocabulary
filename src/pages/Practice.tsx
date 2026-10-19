import '../games.css';
import { useEffect, useMemo, useState } from 'react';
import { Blitz } from '../components/games/Blitz';
import { BuildSentence } from '../components/games/BuildSentence';
import { Flashcards, LessonGame, PairsGame } from '../components/games/ClassicGames';
import { FindMistake } from '../components/games/FindMistake';
import { RolePlay } from '../components/games/RolePlay';
import type { GameProps } from '../components/games/shared';
import { VerbSorter } from '../components/games/VerbSorter';
import { Icon, type IconName } from '../components/Icon';
import { useFocusMode, usePageTitle } from '../components/ui';
import { db, useLive } from '../lib/db';
import { allTags, defaultScope, gameBlocker, scopeItems, type GameId, type Scope } from '../lib/games';
import { canSpeak } from '../lib/speech';
import type { Item } from '../lib/types';

interface GameMeta {
  id: GameId;
  title: string;
  text: string;
  icon: IconName;
  tone: 'brand' | 'flame' | 'ok' | 'gold' | 'ice' | 'bad';
}

const GAMES: GameMeta[] = [
  { id: 'blitz', title: 'Natural or not?', text: 'Spot the mistakes in 60 seconds.', icon: 'timer', tone: 'flame' },
  { id: 'sorter', title: 'Make, do, take, have', text: 'Pick the right verb for each phrase.', icon: 'target', tone: 'gold' },
  { id: 'mistake', title: 'Find the mistake', text: 'Tap the word that sounds wrong.', icon: 'search', tone: 'bad' },
  { id: 'build', title: 'Build the sentence', text: 'Translate with word tiles.', icon: 'shuffle', tone: 'ok' },
  { id: 'roleplay', title: 'Role-play', text: 'Chat your way through real life.', icon: 'chat', tone: 'ice' },
  { id: 'pairs', title: 'Match pairs', text: 'Phrases and meanings, against the clock.', icon: 'link', tone: 'brand' },
  { id: 'quiz', title: 'Quick quiz', text: '10 multiple-choice questions.', icon: 'zap', tone: 'gold' },
  { id: 'typing', title: 'Typing sprint', text: 'Fill 10 gaps from memory.', icon: 'keyboard', tone: 'ice' },
  { id: 'dictation', title: 'Dictation', text: 'Listen and type 10 phrases.', icon: 'headphones', tone: 'ok' },
  { id: 'flashcards', title: 'Flashcards', text: 'Flip through at your own pace.', icon: 'layers', tone: 'brand' },
];

/** Free practice: games log activity for the streak but never change the review schedule. */
export function Practice() {
  const items = useLive(() => db.items.toArray(), [], null as Item[] | null);
  const [chosen, setChosen] = useState<Scope | null>(null);
  const [game, setGame] = useState<GameId | null>(null);
  const [runId, setRunId] = useState(0);

  const meta = GAMES.find((g) => g.id === game);
  useFocusMode(!!game);
  usePageTitle(meta ? meta.title : 'Practice');
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [game]);

  const tags = useMemo(() => (items ? allTags(items) : []), [items]);
  // "Started" by default; "Everything" when fewer than 5 words are started. A tag that is gone falls back too.
  const scope: Scope =
    chosen && (!chosen.startsWith('tag:') || tags.includes(chosen.slice(4))) ? chosen : items ? defaultScope(items) : 'started';
  const pool = useMemo(() => (items ? scopeItems(items, scope) : []), [items, scope]);
  const startedCount = useMemo(() => (items ? scopeItems(items, 'started').length : 0), [items]);

  if (!items) return null;

  if (game) {
    return (
      <section className="page practice-run">
        <GameRun
          key={runId}
          game={game}
          pool={pool}
          all={items}
          onAgain={() => setRunId((n) => n + 1)}
          onExit={() => {
            setGame(null);
            setRunId((n) => n + 1);
          }}
        />
      </section>
    );
  }

  const scopes: { id: Scope; label: string }[] = [
    { id: 'started', label: `Started (${startedCount})` },
    { id: 'weak', label: 'Weak' },
    { id: 'all', label: 'Everything' },
    ...tags.map((t) => ({ id: `tag:${t}`, label: t })),
  ];
  const games = GAMES.filter((g) => g.id !== 'dictation' || canSpeak);

  return (
    <section className="page practice">
      <div className="page-head">
        <h1>Practice</h1>
      </div>
      <p className="g-explainer">Games don't change your review schedule. They count towards your streak.</p>

      <div className="filter-chips" role="group" aria-label="Words to play with">
        {scopes.map((s) => (
          <button key={s.id} type="button" className="filter-chip" aria-pressed={scope === s.id} onClick={() => setChosen(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="g-scope-note">
        {pool.length === 0
          ? 'No words here yet. Some games still work with built-in phrases.'
          : `Playing with ${pool.length} ${pool.length === 1 ? 'word' : 'words'}.`}
      </p>

      <div className="game-grid">
        {games.map((g) => {
          const reason = gameBlocker(g.id, pool);
          return (
            <button key={g.id} type="button" className="game-card" disabled={!!reason} onClick={() => setGame(g.id)}>
              <span className={`game-icon ${g.tone}`}>
                <Icon name={g.icon} size={22} />
              </span>
              <b>{g.title}</b>
              {reason ? (
                <span className="g-reason">
                  <Icon name="lock" size={14} /> {reason}
                </span>
              ) : (
                <span>{g.text}</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GameRun({ game, pool, all, onAgain, onExit }: { game: GameId; pool: Item[]; all: Item[]; onAgain: () => void; onExit: () => void }) {
  // Snapshot the words: saving progress mid-game must not reshuffle the round.
  const [props] = useState<GameProps>(() => ({ pool, all: all.filter((i) => !i.suspended), onAgain, onExit }));
  const p = { ...props, onAgain, onExit };
  switch (game) {
    case 'blitz':
      return <Blitz {...p} />;
    case 'sorter':
      return <VerbSorter {...p} />;
    case 'mistake':
      return <FindMistake {...p} />;
    case 'build':
      return <BuildSentence {...p} />;
    case 'roleplay':
      return <RolePlay {...p} />;
    case 'pairs':
      return <PairsGame {...p} />;
    case 'quiz':
      return <LessonGame kind="choice" {...p} />;
    case 'typing':
      return <LessonGame kind="cloze" {...p} />;
    case 'dictation':
      return <LessonGame kind="dictation" {...p} />;
    case 'flashcards':
      return <Flashcards {...p} />;
  }
}
