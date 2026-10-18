import { useEffect, useMemo, useRef, useState } from 'react';
import { checkAnswer, type Verdict } from '../lib/check';
import { firstLetterHint, parseCloze, plainExample, sentenceUsesTerm } from '../lib/cloze';
import { speak } from '../lib/speech';
import type { ExerciseKind, Item, Result } from '../lib/types';
import { ItemCard } from './ItemCard';
import { Speak } from './Speak';

export interface ExerciseProps {
  item: Item;
  kind: ExerciseKind;
  /** Other items, used for multiple-choice distractors. */
  pool: Item[];
  onDone: (result: Result, sentence?: string) => void;
}

const shuffle = <T,>(list: T[]): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const VERDICT_TEXT: Record<Verdict, string> = {
  correct: 'Correct!',
  almost: 'Almost! Check the spelling.',
  wrong: 'Not quite.',
};

export function Exercise(props: ExerciseProps) {
  const { kind } = props;
  // key forces a fresh state for every new step
  const key = `${props.item.id}-${kind}`;
  if (kind === 'intro') return <Intro key={key} {...props} />;
  if (kind === 'choice') return <Choice key={key} {...props} />;
  if (kind === 'sentence') return <Sentence key={key} {...props} />;
  return <Typed key={key} {...props} />;
}

function Intro({ item, onDone }: ExerciseProps) {
  useEffect(() => {
    speak(item.term);
  }, [item.term]);
  return (
    <div className="exercise">
      <p className="prompt-label">New {item.type === 'word' ? 'word' : 'phrase'}</p>
      <ItemCard item={item} />
      <NextButton label="Got it" onClick={() => onDone('done')} />
    </div>
  );
}

function Choice({ item, pool, onDone }: ExerciseProps) {
  const [toEnglish] = useState(() => Math.random() < 0.5);
  const options = useMemo(() => {
    const others = pool.filter((p) => p.id !== item.id && p.translation !== item.translation && p.term !== item.term);
    const sameType = shuffle(others.filter((o) => o.type === item.type));
    const rest = shuffle(others.filter((o) => o.type !== item.type));
    return shuffle([item, ...[...sameType, ...rest].slice(0, 3)]);
  }, [item, pool]);
  const [picked, setPicked] = useState<string | null>(null);
  const correct = picked === item.id;
  const label = (o: Item) => (toEnglish ? o.term : o.translation);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picked === null && /^[1-4]$/.test(e.key) && options[+e.key - 1]) setPicked(options[+e.key - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked, options]);

  return (
    <div className="exercise">
      <p className="prompt-label">{toEnglish ? 'Choose the English phrase' : 'What does it mean?'}</p>
      <div className="prompt">
        {toEnglish ? (
          <span className="prompt-main">{item.translation}</span>
        ) : (
          <>
            <span className="prompt-main">{item.term}</span> <Speak text={item.term} />
          </>
        )}
        {!toEnglish && item.example && <p className="example muted">{plainExample(item.example)}</p>}
        {toEnglish && item.definition && <p className="muted">{item.definition}</p>}
      </div>
      <div className="options">
        {options.map((o, i) => (
          <button
            key={o.id}
            className={
              'option' + (picked !== null && o.id === item.id ? ' right' : '') + (picked === o.id && !correct ? ' wrong' : '')
            }
            disabled={picked !== null}
            onClick={() => setPicked(o.id)}
          >
            <span className="kbd">{i + 1}</span> {label(o)}
          </button>
        ))}
      </div>
      {picked !== null && (
        <Feedback verdict={correct ? 'correct' : 'wrong'} item={item} onNext={() => onDone(correct ? 'correct' : 'wrong')} />
      )}
    </div>
  );
}

function Typed({ item, kind: requested, onDone }: ExerciseProps) {
  const cloze = parseCloze(item.example, item.term);
  // Without a usable example sentence a gap-fill becomes plain recall.
  const kind = (requested === 'cloze' || requested === 'cloze-ru') && !cloze ? 'recall' : requested;
  const useCloze = (kind === 'cloze' || kind === 'cloze-ru') && cloze;
  const expected = useCloze ? cloze.answer : item.term;
  const [value, setValue] = useState('');
  const [hint, setHint] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    if (kind === 'dictation') speak(item.term);
  }, [kind, item.term]);

  const submit = () => {
    if (verdict) return;
    let v = checkAnswer(value, expected, { ignorePlaceholders: !useCloze });
    // A hint still counts, but only as a hard recall.
    if (hint && v === 'correct') v = 'almost';
    setVerdict(v);
  };

  const result: Result = verdict ?? 'wrong';
  const label =
    kind === 'dictation'
      ? 'Listen and type what you hear'
      : kind === 'cloze-ru'
        ? 'Translate the missing part'
        : kind === 'cloze'
          ? 'Fill in the gap'
          : 'Type the English phrase';

  return (
    <div className="exercise">
      <p className="prompt-label">{label}</p>
      <div className="prompt">
        {kind === 'dictation' && (
          <button className="big-speak" onClick={() => speak(item.term)}>
            🔊 Play again
          </button>
        )}
        {kind === 'recall' && (
          <>
            <span className="prompt-main">{item.translation}</span>
            {item.definition && <p className="muted">{item.definition}</p>}
          </>
        )}
        {kind === 'cloze-ru' && item.exampleRu && <p className="prompt-ru">{item.exampleRu}</p>}
        {useCloze && (
          <p className="cloze">
            {cloze.before}
            <span className="gap">{verdict ? cloze.answer : hint ? firstLetterHint(cloze.answer) : '_____'}</span>
            {cloze.after}
          </p>
        )}
        {kind === 'cloze' && <p className="muted">{item.translation}</p>}
        {hint && !useCloze && <p className="hint">Hint: {firstLetterHint(item.term)}</p>}
      </div>
      <form
        className="answer-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (verdict) onDone(result);
          else submit();
        }}
      >
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Type your answer"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          readOnly={!!verdict}
          className={verdict ? `answer ${verdict}` : 'answer'}
        />
        {!verdict && (
          <>
            <button type="button" className="ghost" onClick={() => setHint(true)} disabled={hint}>
              Hint
            </button>
            <button type="submit" className="primary">
              Check
            </button>
          </>
        )}
      </form>
      {verdict && (
        <Feedback verdict={verdict} item={item} expected={expected} onNext={() => onDone(result)} onAccept={verdict === 'wrong' ? () => onDone('almost') : undefined} />
      )}
    </div>
  );
}

function Sentence({ item, onDone }: ExerciseProps) {
  const [text, setText] = useState('');
  const [warn, setWarn] = useState(false);
  const save = () => {
    if (!text.trim()) return;
    if (!warn && !sentenceUsesTerm(text, item.term)) {
      setWarn(true);
      return;
    }
    onDone('done', text);
  };
  return (
    <div className="exercise">
      <p className="prompt-label">Use it: write your own sentence</p>
      <div className="prompt">
        <span className="prompt-main">{item.term}</span> <Speak text={item.term} />
        <p className="muted">{item.translation}</p>
        <p className="muted small">Write about your life, your work or your plans. Personal sentences are remembered best.</p>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setWarn(false);
        }}
        rows={3}
        placeholder={`e.g. ${plainExample(item.example)}`}
        autoFocus
      />
      {warn && <p className="hint">I can't find “{item.term}” in your sentence. Save it anyway?</p>}
      <div className="row">
        <button className="ghost" onClick={() => onDone('wrong')}>
          Skip
        </button>
        <button className="primary" onClick={save} disabled={!text.trim()}>
          {warn ? 'Save anyway' : 'Save sentence'}
        </button>
      </div>
    </div>
  );
}

function Feedback({
  verdict,
  item,
  expected,
  onNext,
  onAccept,
}: {
  verdict: Verdict;
  item: Item;
  expected?: string;
  onNext: () => void;
  onAccept?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // On a phone the feedback can be below the fold.
    box.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, []);
  return (
    <div ref={box} className={`feedback ${verdict}`}>
      <p className="verdict">
        {VERDICT_TEXT[verdict]}
        {verdict !== 'correct' && expected && (
          <>
            {' '}
            Answer: <b>{expected}</b>
          </>
        )}
      </p>
      <ItemCard item={item} compact />
      <div className="row">
        {onAccept && (
          <button className="ghost" onClick={onAccept} title="Use this if your answer was also right">
            I was right
          </button>
        )}
        <NextButton onClick={onNext} />
      </div>
    </div>
  );
}

function NextButton({ onClick, label = 'Next' }: { onClick: () => void; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Focus without scrolling so Enter moves on, but the feedback stays in view.
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement !== ref.current) {
        onClick();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClick]);
  return (
    <button ref={ref} className="primary" onClick={onClick}>
      {label} →
    </button>
  );
}
