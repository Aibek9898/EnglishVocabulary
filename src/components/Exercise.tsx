import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { checkAnswer, detectCyrillic, normalize, type Verdict as Check } from '../lib/check';
import { firstLetterHint, maskTerm, parseCloze, plainExample, sentenceUsesTerm, wordBlanks } from '../lib/cloze';
import { db } from '../lib/db';
import { diffWords } from '../lib/diff';
import { wrongForms } from '../lib/mistakes';
import { canSpeak, speak } from '../lib/speech';
import type { ExerciseKind, Item, Result } from '../lib/types';
import { AiCheck } from './AiCheck';
import { Icon, type IconName } from './Icon';
import { Example, ItemCard } from './ItemCard';
import { Speak } from './Speak';
import { ActionBar, ContinueButton, Verdict, type Tone } from './ui';

export interface ExerciseProps {
  item: Item;
  kind: ExerciseKind;
  /** Other items, used for multiple-choice distractors. */
  pool: Item[];
  /** `sentence` is the learner's own sentence, for the 'sentence' step. */
  onDone: (result: Result, sentence?: string) => void;
  /** Lets the learner write their own translation and example from the word card. */
  onEdit?: (item: Item) => void;
  /** Lets the learner drop a new word they don't want to learn. */
  onRemove?: (item: Item) => void;
}

export function Exercise(props: ExerciseProps) {
  // A fresh state for every step, even when the same item and kind repeat.
  const key = `${props.item.id}-${props.kind}`;
  switch (props.kind) {
    case 'intro':
      return <Intro key={key} {...props} />;
    case 'choice':
      return <Choice key={key} {...props} />;
    case 'sentence':
      return <Sentence key={key} {...props} />;
    case 'say':
      return <Say key={key} {...props} />;
    default:
      return <Typed key={key} {...props} />;
  }
}

/* ---------- helpers ---------- */

const shuffle = <T,>(list: T[]): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const PRAISE = ['Correct!', 'Nice!', 'Exactly!', 'Well done!', 'Spot on!'];
const praise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];

function Pill({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <p className="prompt-pill">
      <Icon name={icon} size={16} />
      {children}
    </p>
  );
}

const TYPE_NAME: Record<string, string> = { 'phrasal-verb': 'phrasal verb', idiom: 'idiom', word: 'word' };

/** Up to `n` other items with a different `key`, same tag first, then same type. */
function pickOthers(item: Item, pool: Item[], n: number, key: (i: Item) => string): Item[] {
  const seen = new Set([normalize(key(item))]);
  // Another meaning of the same phrase is not a wrong answer.
  const others = pool.filter((p) => p.id !== item.id && normalize(p.term) !== normalize(item.term));
  const out: Item[] = [];
  const ordered = [
    ...shuffle(others.filter((o) => o.tags.some((t) => item.tags.includes(t)) && o.type === item.type)),
    ...shuffle(others.filter((o) => o.type === item.type)),
    ...shuffle(others),
  ];
  for (const o of ordered) {
    const k = normalize(key(o));
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(o);
    if (out.length >= n) break;
  }
  return out;
}

/** Wrong answers that are a known learner mistake for this item. */
function isKnownMistake(item: Item, value: string): boolean {
  const v = normalize(value);
  return !!v && [...(item.wrong ?? []), ...wrongForms(item)].some((w) => normalize(w) === v);
}

function AnswerDiff({ value, expected }: { value: string; expected: string }) {
  const { yours, answer } = diffWords(value, expected);
  const words = (list: { text: string; same: boolean }[], Tag: 's' | 'b') =>
    list.flatMap((w, i) => [i ? ' ' : '', w.same ? w.text : <Tag key={i}>{w.text}</Tag>]);
  return (
    <div className="diff">
      <p>
        <span className="diff-label">You wrote</span> {words(yours, 's')}
      </p>
      <p>
        <span className="diff-label">Answer</span> {words(answer, 'b')}
      </p>
    </div>
  );
}

/** Keeps focus (and the phone keyboard) in the answer box when a bar button is tapped. */
const keepFocus = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

/* ---------- new word ---------- */

function Intro({ item, onDone, onEdit, onRemove }: ExerciseProps) {
  useEffect(() => {
    speak(item.term);
  }, [item.term]);
  return (
    <>
      <div className="exercise">
        <Pill icon="sparkles">New {TYPE_NAME[item.type] ?? 'phrase'}</Pill>
        <ItemCard item={item} onEdit={onEdit && (() => onEdit(item))} />
      </div>
      <ActionBar>
        {onRemove && (
          <button type="button" className="ghost big" onClick={() => onRemove(item)}>
            <Icon name="trash" size={18} /> Remove word
          </button>
        )}
        <ContinueButton label="Got it" onClick={() => onDone('done')} />
      </ActionBar>
    </>
  );
}

/* ---------- multiple choice (recognition, never scheduled) ---------- */

interface Option {
  text: string;
  right: boolean;
}

function Choice({ item, pool, onDone, onEdit }: ExerciseProps) {
  const cloze = parseCloze(item.example, item.term);
  const [mode] = useState<'meaning' | 'form' | 'term'>(() => {
    if (Math.random() < 0.5) return 'meaning';
    return cloze && wrongForms(item).length ? 'form' : 'term';
  });
  const options = useMemo<Option[]>(() => {
    if (mode === 'meaning') {
      const others = pickOthers(item, pool, 3, (i) => i.translation);
      return shuffle([{ text: item.translation, right: true }, ...others.map((o) => ({ text: o.translation, right: false }))]);
    }
    if (mode === 'form' && cloze) {
      const wrong = wrongForms(item, pool.map((p) => p.term)).slice(0, 2);
      const answerOf = (i: Item) => parseCloze(i.example, i.term)?.answer ?? i.term;
      const fill = pickOthers(item, pool, 3 - wrong.length, answerOf).map(answerOf);
      return shuffle([{ text: cloze.answer, right: true }, ...[...wrong, ...fill].map((text) => ({ text, right: false }))]);
    }
    const others = pickOthers(item, pool, 3, (i) => i.term);
    return shuffle([{ text: item.term, right: true }, ...others.map((o) => ({ text: o.term, right: false }))]);
    // Options are fixed for the life of the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;
  const correct = done && picked >= 0 && options[picked].right;
  const pickedText = done && picked >= 0 ? options[picked].text : '';
  const trap = done && !correct && mode !== 'meaning' && isKnownMistake(item, pickedText);

  useEffect(() => {
    if (done) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) {
        e.preventDefault();
        setPicked(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, options.length]);

  const rightText = options.find((o) => o.right)!.text;

  return (
    <>
      <div className="exercise">
        <Pill icon={mode === 'meaning' ? 'book' : 'target'}>
          {mode === 'meaning' ? 'What does it mean?' : mode === 'form' ? 'Choose the right phrase' : 'Choose the English phrase'}
        </Pill>
        <div className="prompt">
          {mode === 'meaning' && (
            <>
              <div className="prompt-line">
                <span className="prompt-main">{item.term}</span>
                <Speak text={item.term} />
              </div>
              {item.example && <p className="prompt-sub">{plainExample(item.example)}</p>}
            </>
          )}
          {mode === 'form' && cloze && (
            <>
              <p className="cloze">
                {cloze.before}
                <span className={done ? 'gap revealed' : 'gap'}>{done ? cloze.answer : '   '}</span>
                {cloze.after}
              </p>
              <p className="prompt-sub" lang="ru">
                {item.translation}
              </p>
            </>
          )}
          {mode === 'term' && (
            <>
              <span className="prompt-main" lang="ru">
                {item.translation}
              </span>
              {item.definition && <p className="prompt-sub">{maskTerm(item.definition, item.term)}</p>}
            </>
          )}
        </div>
        <div className="options" role="group" aria-label="Answers">
          {options.map((o, i) => (
            <button
              key={i}
              type="button"
              className={'option' + (done && o.right ? ' right' : '') + (picked === i && !o.right ? ' wrong' : '')}
              disabled={done}
              onClick={() => setPicked(i)}
              lang={mode === 'meaning' ? 'ru' : undefined}
            >
              <span className="kbd key-hint" aria-hidden="true">
                {i + 1}
              </span>
              <span>{o.text}</span>
              {done && (o.right || picked === i) && (
                <span className="option-mark">
                  <Icon name={o.right ? 'check' : 'x'} size={20} strokeWidth={3} label={o.right ? 'Right answer' : 'Your answer'} />
                </span>
              )}
            </button>
          ))}
        </div>
        {done && !correct && (
          <div className="details-panel">
            <ItemCard item={item} compact heading="h3" onEdit={onEdit && (() => onEdit(item))} />
          </div>
        )}
      </div>
      <ActionBar
        tone={done ? (correct ? 'correct' : 'wrong') : null}
        verdict={
          done &&
          (correct ? (
            <Verdict tone="correct" title={praise()}>
              {item.term} · <span lang="ru">{item.translation}</span>
            </Verdict>
          ) : (
            <Verdict tone="wrong" title={trap ? 'Classic trap for Russian speakers!' : picked === -1 ? "Here's the answer" : 'Not quite'}>
              Answer: <b>{rightText}</b>
            </Verdict>
          ))
        }
      >
        {done ? (
          <ContinueButton onClick={() => onDone(correct ? 'correct' : 'wrong')} />
        ) : (
          <button type="button" className="ghost big" onClick={() => setPicked(-1)}>
            I don't know
          </button>
        )}
      </ActionBar>
    </>
  );
}

/* ---------- typed answers: gap, translation, recall, dictation ---------- */

function Typed({ item, kind: requested, onDone, onEdit }: ExerciseProps) {
  const cloze = parseCloze(item.example, item.term);
  let kind = requested;
  // Without a usable example a gap-fill becomes plain recall.
  if ((kind === 'cloze' || kind === 'cloze-ru') && !cloze) kind = 'recall';
  if (kind === 'cloze-ru' && !item.exampleRu) kind = 'cloze';
  const useCloze = (kind === 'cloze' || kind === 'cloze-ru') && !!cloze;
  const expected = useCloze ? cloze!.answer : item.term;
  // New words get word-length blanks and the translation as scaffolding.
  const scaffold = item.level <= 1;

  const formId = useId();
  const [value, setValue] = useState('');
  const [hint, setHint] = useState(false);
  const [verdict, setVerdict] = useState<Check | 'gaveup' | null>(null);
  const [cyrillic, setCyrillic] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Focus inside the same tap that moved on, so the phone keyboard stays up.
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (kind === 'dictation') speak(item.term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result: Result =
    verdict === 'correct' || verdict === 'almost' ? (hint ? 'hinted' : verdict) : 'wrong';
  const tone: Tone | null = !verdict ? null : verdict === 'gaveup' ? 'wrong' : result === 'hinted' ? 'hinted' : (verdict as Tone);

  const check = () => {
    if (verdict || !value.trim()) return;
    if (detectCyrillic(value)) {
      setCyrillic(true);
      return;
    }
    setVerdict(checkAnswer(value, expected, { ignorePlaceholders: !useCloze, accepted: item.accepted }));
  };

  const acceptMine = () => {
    const accepted = [...new Set([...(item.accepted ?? []), value.trim()])];
    db.items.update(item.id, { accepted }).catch(console.error);
    onDone('correct');
  };

  const trap = verdict === 'wrong' && isKnownMistake(item, value);
  const blanks = hint ? firstLetterHint(expected) : scaffold ? wordBlanks(expected) : '   ';

  const pill: [IconName, string] =
    kind === 'dictation'
      ? ['headphones', 'Type what you hear']
      : kind === 'cloze-ru'
        ? ['pen', 'Translate the missing part']
        : kind === 'cloze'
          ? ['pen', 'Fill the gap in English']
          : ['keyboard', 'Type it in English'];

  let verdictNode: ReactNode = null;
  if (verdict === 'correct' && !hint) {
    verdictNode = (
      <Verdict tone="correct" title={praise()}>
        {useCloze || kind === 'dictation' ? <span lang="ru">{item.translation}</span> : plainExample(item.example)}
      </Verdict>
    );
  } else if (verdict === 'correct' || (verdict === 'almost' && hint)) {
    verdictNode = (
      <Verdict tone="hinted" title="Right, with a hint">
        It comes back soon, so you can get it on your own.
      </Verdict>
    );
  } else if (verdict === 'almost') {
    verdictNode = (
      <Verdict tone="almost" title="Almost! Check the spelling.">
        <AnswerDiff value={value} expected={expected} />
      </Verdict>
    );
  } else if (verdict === 'wrong') {
    verdictNode = (
      <Verdict tone="wrong" title={trap ? 'Classic trap for Russian speakers!' : 'Not quite'}>
        <AnswerDiff value={value} expected={expected} />
      </Verdict>
    );
  } else if (verdict === 'gaveup') {
    verdictNode = (
      <Verdict tone="wrong" title="Here's the answer">
        <b>{expected}</b>
      </Verdict>
    );
  }

  return (
    <>
      <div className="exercise">
        <Pill icon={pill[0]}>{pill[1]}</Pill>
        <div className="prompt">
          {kind === 'dictation' && (
            <div className="dictation-buttons">
              <button type="button" className="speak-big" onClick={() => speak(item.term)} {...keepFocus} aria-label="Play again">
                <Icon name="volume" size={32} />
              </button>
              <button type="button" className="ghost small" onClick={() => speak(item.term, 0.65)} {...keepFocus}>
                Slower
              </button>
            </div>
          )}
          {kind === 'recall' && (
            <>
              <span className="prompt-main" lang="ru">
                {item.translation}
              </span>
              {item.definition && <p className="prompt-sub">{maskTerm(item.definition, item.term)}</p>}
              {hint && !verdict && <p className="hint-line">Starts with: {firstLetterHint(item.term)}</p>}
            </>
          )}
          {kind === 'cloze-ru' && (
            <p className="prompt-ru" lang="ru">
              {item.exampleRu}
            </p>
          )}
          {useCloze && (
            <>
              <p className="cloze">
                {cloze!.before}
                <span className={verdict ? 'gap revealed' : 'gap'} aria-label={verdict ? undefined : 'gap'}>
                  {verdict ? cloze!.answer : value || blanks}
                </span>
                {cloze!.after}
              </p>
              {kind === 'cloze' && (
                <p className="prompt-sub" lang={scaffold || !item.definition ? 'ru' : undefined}>
                  {scaffold || !item.definition ? item.translation : maskTerm(item.definition, item.term)}
                </p>
              )}
            </>
          )}
          {kind === 'dictation' && hint && !verdict && <p className="hint-line">Starts with: {firstLetterHint(item.term)}</p>}
        </div>
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            if (verdict) onDone(result);
            else check();
          }}
        >
          <input
            ref={input}
            className={'answer' + (tone ? ` ${tone}` : '')}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setCyrillic(false);
            }}
            onKeyDown={(e) => {
              // Holding Enter must not check and then skip ahead.
              if (e.key === 'Enter' && e.repeat) e.preventDefault();
            }}
            readOnly={!!verdict}
            placeholder="Type in English"
            aria-label="Your answer in English"
            lang="en"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint={verdict ? 'next' : 'go'}
          />
        </form>
        {cyrillic && (
          <p className="hint-line" role="alert">
            <Icon name="keyboard" size={18} /> That's Russian. Switch to the English keyboard.
          </p>
        )}
        {verdict && tone !== 'correct' && (
          <div className="details-panel">
            <ItemCard item={item} compact heading="h3" onEdit={onEdit && (() => onEdit(item))} />
          </div>
        )}
      </div>
      <ActionBar tone={tone} verdict={verdictNode}>
        {!verdict ? (
          <>
            {hint ? (
              <button type="button" className="ghost big" onClick={() => setVerdict('gaveup')} {...keepFocus}>
                Show answer
              </button>
            ) : (
              <button type="button" className="ghost big" onClick={() => setHint(true)} {...keepFocus}>
                Show first letter
              </button>
            )}
            <button type="submit" form={formId} className="primary big" disabled={!value.trim()} {...keepFocus}>
              Check
            </button>
          </>
        ) : (
          <>
            {verdict === 'wrong' && (
              <button type="button" className="ghost big" onClick={acceptMine} {...keepFocus}>
                I was right
              </button>
            )}
            <button type="submit" form={formId} className="primary big" {...keepFocus}>
              Continue
            </button>
          </>
        )}
      </ActionBar>
    </>
  );
}

/* ---------- say it aloud (self-graded, for well-known words) ---------- */

function Say({ item, onDone }: ExerciseProps) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <div className="exercise">
        <Pill icon="mic">Say it out loud</Pill>
        <div className="prompt">
          <span className="prompt-main" lang="ru">
            {item.translation}
          </span>
          {item.definition && <p className="prompt-sub">{maskTerm(item.definition, item.term)}</p>}
          {!shown && <p className="muted small">Say the English phrase, then check yourself.</p>}
        </div>
        {shown && (
          <div className="answer-block">
            <div className="prompt-line">
              <span className="prompt-main">{item.term}</span>
              <Speak text={item.term} />
            </div>
            {item.example && (
              <p className="example">
                <Example item={item} />
              </p>
            )}
          </div>
        )}
      </div>
      <ActionBar>
        {!shown ? (
          <ContinueButton
            key="show"
            label="Show answer"
            onClick={() => {
              setShown(true);
              if (canSpeak) speak(item.term);
            }}
          />
        ) : (
          <>
            <button type="button" className="ghost big" onClick={() => onDone('wrong')}>
              I didn't remember
            </button>
            <ContinueButton key="said" label="I said it" onClick={() => onDone('correct')} />
          </>
        )}
      </ActionBar>
    </>
  );
}

/* ---------- write your own sentence ---------- */

function sentenceFrame(item: Item): string {
  const t = item.tags;
  if (t.includes('work')) return 'Write about your job, a colleague or a recent meeting.';
  if (t.includes('travel')) return 'Write about a trip you took or one you are planning.';
  if (t.includes('money')) return 'Write about something you bought, saved for or want to buy.';
  if (t.includes('health')) return 'Write about how you feel or how you look after yourself.';
  if (t.some((x) => ['feelings', 'opinions', 'relationships'].includes(x))) return 'Write about someone you know, or how you felt recently.';
  if (item.type === 'phrasal-verb') return 'Write about something you did this week.';
  return 'Write about your life, your work or your plans.';
}

function Sentence({ item, onDone }: ExerciseProps) {
  const [text, setText] = useState('');
  const [warn, setWarn] = useState(false);
  const uses = sentenceUsesTerm(text, item.term);
  const save = () => {
    if (!text.trim()) return;
    if (!uses && !warn) {
      setWarn(true);
      return;
    }
    onDone('done', text.trim());
  };
  return (
    <>
      <div className="exercise">
        <Pill icon="pen">Use it in your own sentence</Pill>
        <div className="prompt">
          <div className="prompt-line">
            <span className="prompt-main">{item.term}</span>
            <Speak text={item.term} />
          </div>
          <p className="prompt-sub" lang="ru">
            {item.translation}
          </p>
        </div>
        <label className="field">
          <span>{sentenceFrame(item)}</span>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setWarn(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              }
            }}
            rows={3}
            lang="en"
            placeholder="Personal sentences are remembered best."
            autoFocus
          />
        </label>
        {text.trim() && uses && (
          <p className="chip ok">
            <Icon name="check" size={14} strokeWidth={3} /> Uses “{item.term}”
          </p>
        )}
        {warn && <p className="hint-line">I can't find “{item.term}” in your sentence. Save it anyway?</p>}
        <AiCheck
          text={text}
          targets={[{ term: item.term, translation: item.translation }]}
          onUse={(t) => {
            setText(t);
            setWarn(false);
          }}
          from={item.term}
        />
      </div>
      <ActionBar>
        <button type="button" className="ghost big" onClick={() => onDone('done')}>
          Skip
        </button>
        <button type="button" className="primary big" onClick={save} disabled={!text.trim()}>
          {warn ? 'Save anyway' : 'Save sentence'}
        </button>
      </ActionBar>
    </>
  );
}
