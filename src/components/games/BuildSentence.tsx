import { useMemo, useState } from 'react';
import { buildRounds, sameSentence, type BuildRound } from '../../lib/games';
import { Icon } from '../Icon';
import { Example } from '../ItemCard';
import { Speak } from '../Speak';
import { ActionBar, ContinueButton, SessionHead, Verdict, useEnter } from '../ui';
import { GameOver } from './GameOver';
import { EXIT_LABEL, logGame, praise, useKeys, type GameProps } from './shared';

/** Build the sentence: translate the Russian example by tapping English word tiles in order. */
export function BuildSentence({ pool, onExit, onAgain }: GameProps) {
  const [rounds] = useState(() => buildRounds(pool, 8));
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<'correct' | 'wrong' | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [misses, setMisses] = useState<BuildRound[]>([]);

  const round = rounds[index] as BuildRound | undefined;
  const byId = useMemo(() => new Map(round?.tiles.map((t) => [t.id, t]) ?? []), [round]);
  const used = new Set(chosen);

  const add = (id: string) => !verdict && setChosen((c) => (c.includes(id) ? c : [...c, id]));
  const remove = (id: string) => !verdict && setChosen((c) => c.filter((x) => x !== id));
  const check = () => {
    if (!round || verdict || !chosen.length) return;
    const ok = sameSentence(chosen.map((id) => byId.get(id)?.text ?? '').join(' '), round.answer);
    setVerdict(ok ? 'correct' : 'wrong');
    logGame(round.item, 'game', ok ? 'correct' : 'wrong');
    if (ok) setScore((s) => s + 1);
    else setMisses((m) => [...m, round]);
    setCombo((c) => (ok ? c + 1 : 0));
  };
  const next = () => {
    setChosen([]);
    setVerdict(null);
    setIndex((i) => i + 1);
  };

  useEnter(check, !!round && !verdict && chosen.length > 0);
  useKeys(
    (key, e) => {
      if (key === 'Backspace' && chosen.length) {
        e.preventDefault();
        setChosen((c) => c.slice(0, -1));
      }
    },
    !!round && !verdict,
  );

  if (!round) {
    return (
      <GameOver
        score={score}
        max={rounds.length}
        summary={`${score} of ${rounds.length} sentences right`}
        misses={misses.map((r) => ({ key: r.id, text: r.item.term, sub: r.item.translation, subLang: 'ru' }))}
        onAgain={onAgain}
        onExit={onExit}
      />
    );
  }

  return (
    <div className="g-game g-steady">
      <SessionHead done={index} total={rounds.length} combo={combo} onClose={onExit} closeLabel={EXIT_LABEL} label="Game progress" />
      <div className="exercise" key={round.id}>
        <p className="prompt-pill">
          <Icon name="shuffle" size={16} /> Build the sentence
        </p>
        <p className="g-instr">Translate by tapping the words in order.{round.distractors > 0 ? ' Some words are extra.' : ''}</p>
        <p className="prompt-ru g-ru" lang="ru">
          {round.prompt}
        </p>

        <div className={'g-line' + (verdict ? ` is-${verdict}` : '')} role="group" aria-label="Your sentence">
          {chosen.length === 0 && <span className="g-line-hint">Tap the words below</span>}
          {chosen.map((id) => (
            <button
              key={id}
              type="button"
              className="g-tile in-line"
              onClick={() => remove(id)}
              disabled={!!verdict}
              aria-label={`${byId.get(id)?.text}, tap to remove`}
            >
              {byId.get(id)?.text}
            </button>
          ))}
        </div>

        <div className="g-bank" role="group" aria-label="Word tiles">
          {round.tiles.map((t) =>
            used.has(t.id) ? (
              <span key={t.id} className="g-tile is-used" aria-hidden="true">
                {t.text}
              </span>
            ) : (
              <button key={t.id} type="button" className="g-tile" onClick={() => add(t.id)} disabled={!!verdict}>
                {t.text}
              </button>
            ),
          )}
        </div>

        {verdict && (
          <div className="g-reveal">
            <p className="g-fix">
              <span className="g-fix-icon">
                <Icon name="check" size={18} strokeWidth={3} />
              </span>
              <span>
                <Example item={round.item} />
              </span>
              <Speak text={round.answer} label="Listen to the sentence" />
            </p>
          </div>
        )}
      </div>

      <ActionBar
        tone={verdict}
        verdict={
          verdict === 'correct' ? (
            <Verdict tone="correct" title={praise(score)} />
          ) : verdict === 'wrong' ? (
            <Verdict tone="wrong" title="Not quite">
              {round.answer}
            </Verdict>
          ) : null
        }
      >
        {verdict ? (
          <ContinueButton label={index + 1 === rounds.length ? 'See results' : 'Continue'} onClick={next} />
        ) : (
          <>
            <button type="button" className="ghost big" onClick={() => setChosen([])} disabled={!chosen.length}>
              Clear
            </button>
            <button type="button" className="primary big" onClick={check} disabled={!chosen.length}>
              Check
            </button>
          </>
        )}
      </ActionBar>
    </div>
  );
}
