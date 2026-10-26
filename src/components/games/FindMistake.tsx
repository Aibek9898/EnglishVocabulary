import { useState } from 'react';
import { buildMistakeRounds, isRightTap, type MistakeRound } from '../../lib/games';
import { Icon } from '../Icon';
import { Also } from '../ItemCard';
import { Speak } from '../Speak';
import { ActionBar, ContinueButton, SessionHead, Verdict } from '../ui';
import { GameOver } from './GameOver';
import { EXIT_LABEL, logGame, useKeys, type GameProps } from './shared';

/**
 * Find the mistake: a sentence with a typical learner mistake (or, in about
 * 30% of rounds, no mistake). Tap the wrong word or press "No mistake".
 */
export function FindMistake({ pool, onExit, onAgain }: GameProps) {
  const [rounds] = useState(() => buildMistakeRounds(pool, 10));
  const [index, setIndex] = useState(0);
  /** undefined: not answered yet; null: "No mistake"; a number: the word tapped. */
  const [tap, setTap] = useState<number | null | undefined>(undefined);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [misses, setMisses] = useState<MistakeRound[]>([]);

  const round = rounds[index] as MistakeRound | undefined;
  const answered = tap !== undefined;
  const right = !!round && answered && isRightTap(round, tap);

  const answer = (i: number | null) => {
    if (!round || answered) return;
    const ok = isRightTap(round, i);
    setTap(i);
    logGame(round.item, 'game', ok ? 'correct' : 'wrong');
    if (ok) setScore((s) => s + 1);
    else setMisses((m) => [...m, round]);
    setCombo((c) => (ok ? c + 1 : 0));
  };
  const next = () => {
    setTap(undefined);
    setIndex((i) => i + 1);
  };

  useKeys(
    (key) => {
      if (key === 'n' || key === 'N') answer(null);
    },
    !!round && !answered,
  );

  if (!round) {
    return (
      <GameOver
        score={score}
        max={rounds.length}
        summary={`${score} of ${rounds.length} right`}
        misses={misses.map((r) => ({ key: r.id, text: r.item.term, sub: r.item.translation, subLang: 'ru' }))}
        onAgain={onAgain}
        onExit={onExit}
      />
    );
  }

  const rightSentence = round.before + round.right + round.after;
  const wordClass = (i: number) => {
    const t = round.tokens[i];
    let c = 'g-word';
    if (!answered) return c;
    if (round.hasMistake && t.target) c += ' is-wrong';
    if (!round.hasMistake && t.target) c += ' is-right';
    if (tap === i && !t.hot) c += ' is-missed';
    if (tap === i && t.hot) c += ' is-found';
    return c;
  };

  let verdict;
  if (round.hasMistake) {
    verdict = right ? (
      <Verdict tone="correct" title="Well spotted!">
        Not “{round.wrong}” but “{round.right}”.
      </Verdict>
    ) : (
      <Verdict tone="wrong" title={tap === null ? 'There was a mistake' : 'Not that one'}>
        The mistake was “{round.wrong}”.
      </Verdict>
    );
  } else {
    verdict = right ? (
      <Verdict tone="correct" title="Correct, no mistake!">
        “{round.right}” is natural English.
      </Verdict>
    ) : (
      <Verdict tone="wrong" title="This one was correct">
        “{round.right}” is natural English.
      </Verdict>
    );
  }

  return (
    <div className="g-game g-steady">
      <SessionHead done={index} total={rounds.length} combo={combo} onClose={onExit} closeLabel={EXIT_LABEL} label="Game progress" />
      <div className="exercise">
        <p className="prompt-pill warn">
          <Icon name="search" size={16} /> Find the mistake
        </p>
        <p className="g-instr">Tap the wrong word. If the sentence is fine, choose “No mistake”.</p>
        <div className="g-words" role="group" aria-label="Sentence. Tap the wrong word." key={round.id}>
          {round.tokens.map((t, i) => (
            <button key={i} type="button" className={wordClass(i)} onClick={() => answer(i)} disabled={answered}>
              {t.text}
            </button>
          ))}
        </div>

        {answered && (
          <div className="g-reveal">
            <p className="g-fix">
              <span className="g-fix-icon">
                <Icon name="check" size={18} strokeWidth={3} />
              </span>
              <span>
                {round.before}
                {round.wrong && (
                  <>
                    <s>{round.wrong}</s>{' '}
                  </>
                )}
                <b>{round.right}</b>
                {round.after}
              </span>
              <Speak text={rightSentence} label="Listen to the right sentence" />
            </p>
            {round.item.trap && (
              <div className="trap">
                <Icon name="alert" size={18} />
                <div>
                  <b className="g-trap-title">Classic trap for Russian speakers!</b>
                  <span className="block">{round.item.trap}</span>
                </div>
              </div>
            )}
            <p className="g-meaning">
              <b>{round.item.term}</b> — <span lang="ru">{round.item.translation}</span>
            </p>
            <Also item={round.item} />
          </div>
        )}
      </div>

      <ActionBar tone={answered ? (right ? 'correct' : 'wrong') : null} verdict={answered ? verdict : null}>
        {answered ? (
          <ContinueButton label={index + 1 === rounds.length ? 'See results' : 'Continue'} onClick={next} />
        ) : (
          <button type="button" className="big g-nomistake" onClick={() => answer(null)} aria-keyshortcuts="N">
            <Icon name="check" size={20} strokeWidth={2.5} /> No mistake <span className="kbd key-hint">N</span>
          </button>
        )}
      </ActionBar>
    </div>
  );
}
