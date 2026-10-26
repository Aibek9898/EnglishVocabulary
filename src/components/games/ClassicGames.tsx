import { useState } from 'react';
import { formatTime, hasCloze, pickDistinct } from '../../lib/games';
import type { Item, Result } from '../../lib/types';
import { Exercise } from '../Exercise';
import { Icon } from '../Icon';
import { Also, Example } from '../ItemCard';
import { MatchPairs } from '../MatchPairs';
import { Speak } from '../Speak';
import { ActionBar, ContinueButton, SessionHead } from '../ui';
import { GameOver, type Miss } from './GameOver';
import { EXIT_LABEL, logGame, plural, useKeys, type GameProps } from './shared';

const ROUND = 10;

const missOf = (i: Item): Miss => ({ key: i.id, text: i.term, sub: i.translation, subLang: 'ru' });

/**
 * Quick quiz, Typing sprint and Dictation: ten lesson exercises in a row.
 * The Exercise component brings its own action bar, so this only adds the
 * session head and the end screen.
 */
export function LessonGame({ kind, pool, all, onExit, onAgain }: GameProps & { kind: 'choice' | 'cloze' | 'dictation' }) {
  const [round] = useState(() => pickDistinct(kind === 'cloze' ? pool.filter(hasCloze) : pool, ROUND));
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [misses, setMisses] = useState<Item[]>([]);

  if (index >= round.length) {
    return (
      <GameOver
        score={score}
        max={round.length}
        summary={`${score} of ${round.length} right`}
        misses={misses.map(missOf)}
        onAgain={onAgain}
        onExit={onExit}
      />
    );
  }

  const item = round[index];
  const onDone = (result: Result) => {
    logGame(item, kind, result);
    const right = result === 'correct' || result === 'almost' || result === 'done';
    if (right) setScore((s) => s + 1);
    else setMisses((m) => [...m, item]);
    setCombo((c) => (right ? c + 1 : 0));
    setIndex((i) => i + 1);
  };

  return (
    <div className="g-game">
      <SessionHead done={index} total={round.length} combo={combo} onClose={onExit} closeLabel={EXIT_LABEL} label="Game progress" />
      <Exercise key={index} item={item} kind={kind} pool={all} onDone={onDone} />
    </div>
  );
}

/** Match pairs: ten words on two boards of five (or one board with a small set). */
export function PairsGame({ pool, onExit, onAgain }: GameProps) {
  const [items] = useState(() => pickDistinct(pool, pool.length >= 10 ? 10 : 5));
  const [matched, setMatched] = useState(0);
  const [result, setResult] = useState<{ mistakes: number; seconds: number; missed: string[] } | null>(null);

  if (result) {
    const missed = items.filter((i) => result.missed.includes(i.id));
    const firstTry = items.length - missed.length;
    return (
      <GameOver
        score={firstTry}
        max={items.length}
        title={result.mistakes === 0 ? 'Flawless!' : undefined}
        summary={`${items.length} pairs in ${formatTime(result.seconds)} · ${plural(result.mistakes, 'mistake')}`}
        misses={missed.map(missOf)}
        onAgain={onAgain}
        onExit={onExit}
      />
    );
  }

  return (
    <div className="g-game">
      <SessionHead done={matched} total={items.length} onClose={onExit} closeLabel={EXIT_LABEL} label="Pairs matched" />
      <MatchPairs
        items={items}
        onProgress={setMatched}
        onFinish={(mistakes, seconds, missed) => {
          for (const i of items) logGame(i, 'pairs', missed.includes(i.id) ? 'wrong' : 'correct');
          setResult({ mistakes, seconds, missed });
        }}
      />
    </div>
  );
}

/** Flashcards: Russian on the front, the phrase on the back; the learner says whether they knew it. */
export function Flashcards({ pool, onExit, onAgain }: GameProps) {
  const [cards] = useState(() => pickDistinct(pool, ROUND));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [learning, setLearning] = useState<Item[]>([]);

  const item = cards[index] as Item | undefined;
  const flip = () => setFlipped(true);
  const answer = (knew: boolean) => {
    if (!item || !flipped) return;
    logGame(item, 'flashcard', knew ? 'correct' : 'wrong');
    if (knew) setKnown((k) => k + 1);
    else setLearning((l) => [...l, item]);
    setFlipped(false);
    setIndex((i) => i + 1);
  };

  useKeys(
    (key, e) => {
      // A focused button handles Space itself.
      if (!flipped && key === ' ' && !(e.target as HTMLElement | null)?.closest?.('button')) {
        e.preventDefault();
        flip();
      } else if (flipped && (key === '1' || key === 'ArrowLeft')) answer(false);
      else if (flipped && (key === '2' || key === 'ArrowRight')) answer(true);
    },
    !!item,
  );

  if (!item) {
    return (
      <GameOver
        score={known}
        max={cards.length}
        summary={`You knew ${known} of ${cards.length}`}
        misses={learning.map(missOf)}
        missesTitle="Still learning"
        onAgain={onAgain}
        onExit={onExit}
      />
    );
  }

  return (
    <div className="g-game">
      <SessionHead done={index} total={cards.length} onClose={onExit} closeLabel={EXIT_LABEL} label="Cards done" />
      <div className="exercise">
        <p className="prompt-pill">
          <Icon name="layers" size={16} /> Flashcards
        </p>
        <p className="g-instr">Say the English phrase to yourself, then flip the card.</p>
        {!flipped ? (
          <button type="button" className="g-card" onClick={flip} key={`f${index}`}>
            <span className="g-card-ru" lang="ru">
              {item.translation}
            </span>
            <span className="g-card-hint">
              <Icon name="reset" size={16} /> Tap to flip
            </span>
          </button>
        ) : (
          <div className="g-card back g-flip-in" key={`b${index}`} data-term={item.term}>
            <div className="g-card-term">
              <span>{item.term}</span>
              <Speak text={item.term} />
            </div>
            <p className="g-card-sub" lang="ru">
              {item.translation}
            </p>
            {item.definition && <p className="g-card-def">{item.definition}</p>}
            {item.example && (
              <p className="g-card-example">
                <Example item={item} />
              </p>
            )}
            <Also item={item} className="g-card-also" />
          </div>
        )}
      </div>
      <ActionBar>
        {!flipped ? (
          <ContinueButton key="show" label="Show answer" onClick={flip} />
        ) : (
          <>
            <button type="button" className="big g-still" onClick={() => answer(false)}>
              <span className="kbd key-hint">1</span> Still learning
            </button>
            <ContinueButton key="knew" label="Got it" onClick={() => answer(true)} />
          </>
        )}
      </ActionBar>
    </div>
  );
}
