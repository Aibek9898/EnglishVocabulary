import { useState } from 'react';
import { LIGHT_VERBS, sorterCards, type LightVerb, type SorterCard } from '../../lib/games';
import { Icon } from '../Icon';
import { Speak } from '../Speak';
import { ActionBar, ContinueButton, SessionHead, Verdict } from '../ui';
import { GameOver } from './GameOver';
import { EXIT_LABEL, logGame, praise, useKeys, type GameProps } from './shared';

/** Make / do / take / have: 12 phrases, pick the verb that goes with each. */
export function VerbSorter({ pool, all, onExit, onAgain }: GameProps) {
  const [cards] = useState(() => sorterCards(pool, all, 12));
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<LightVerb | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [misses, setMisses] = useState<SorterCard[]>([]);

  const card = cards[index] as SorterCard | undefined;
  const right = !!card && picked === card.verb;
  const itemOf = (c: SorterCard) => all.find((i) => i.id === c.itemId);

  const answer = (verb: LightVerb) => {
    if (!card || picked) return;
    const ok = verb === card.verb;
    setPicked(verb);
    logGame(itemOf(card), 'game', ok ? 'correct' : 'wrong');
    if (ok) setScore((s) => s + 1);
    else setMisses((m) => [...m, card]);
    setCombo((c) => (ok ? c + 1 : 0));
  };
  const next = () => {
    setPicked(null);
    setIndex((i) => i + 1);
  };

  useKeys(
    (key) => {
      const n = Number(key);
      if (n >= 1 && n <= 4) answer(LIGHT_VERBS[n - 1]);
    },
    !!card && !picked,
  );

  if (!card) {
    return (
      <GameOver
        score={score}
        max={cards.length}
        summary={`${score} of ${cards.length} verbs right`}
        misses={misses.map((c) => ({ key: c.id, text: `${c.verb} ${c.phrase}`, sub: c.translation, subLang: 'ru' }))}
        onAgain={onAgain}
        onExit={onExit}
      />
    );
  }

  const full = `${card.verb} ${card.phrase}`;
  return (
    <div className="g-game">
      <SessionHead done={index} total={cards.length} combo={combo} onClose={onExit} closeLabel={EXIT_LABEL} label="Game progress" />
      <div className="exercise">
        <p className="prompt-pill">
          <Icon name="target" size={16} /> Make, do, take or have?
        </p>
        <p className="g-instr">Choose the verb that goes with the phrase.</p>
        <div className={'g-sorter-card' + (picked ? (right ? ' is-right pop' : ' is-wrong shake') : '')} key={card.id}>
          <p className="g-sorter-phrase">
            <span className={'g-slot' + (picked ? ' ok' : '')}>
              {picked ? (
                card.verb
              ) : (
                <>
                  <span aria-hidden="true">___</span>
                  <span className="sr-only">blank</span>
                </>
              )}
            </span>{' '}
            {card.phrase}
          </p>
          {picked && (
            <p className="g-sorter-meta">
              <span lang="ru">{card.translation}</span>
              <Speak text={full} label={`Listen: ${full}`} />
            </p>
          )}
        </div>
        <div className="g-verbs" role="group" aria-label="Verbs">
          {LIGHT_VERBS.map((v, i) => {
            const state = picked ? (v === card.verb ? ' right' : v === picked ? ' wrong' : '') : '';
            return (
              <button
                key={v}
                type="button"
                className={'option g-verb' + state}
                onClick={() => answer(v)}
                disabled={!!picked}
                aria-keyshortcuts={String(i + 1)}
              >
                <span className="kbd key-hint">{i + 1}</span>
                {v}
                {state === ' right' && (
                  <span className="option-mark">
                    <Icon name="check" size={20} strokeWidth={3} />
                  </span>
                )}
                {state === ' wrong' && (
                  <span className="option-mark">
                    <Icon name="x" size={20} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {picked && (
        <ActionBar
          tone={right ? 'correct' : 'wrong'}
          verdict={
            right ? (
              <Verdict tone="correct" title={praise(score)}>
                “{full}”
              </Verdict>
            ) : (
              <Verdict tone="wrong" title={`It's “${full}”`}>
                Not “{picked} {card.phrase}”.
              </Verdict>
            )
          }
        >
          <ContinueButton label={index + 1 === cards.length ? 'See results' : 'Continue'} onClick={next} />
        </ActionBar>
      )}
    </div>
  );
}
