import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { db } from '../../lib/db';
import { aiCheckPrompt, pickTargets, repliesToSave, scoreTitle, usedTargets, type ChatLine } from '../../lib/games';
import { SCENARIOS, type Scenario } from '../../lib/scenarios';
import { sentenceUsesTerm } from '../../lib/cloze';
import { addSentence } from '../../lib/srs';
import { Icon } from '../Icon';
import { Speak } from '../Speak';
import { ActionBar, ContinueButton, SessionHead, prefersReducedMotion, toast } from '../ui';
import { GameOver } from './GameOver';
import type { Item } from '../../lib/types';
import { logGame, plural, type GameProps } from './shared';
import { activeAi, useAi } from '../../lib/ai';
import { AiCheck } from '../AiCheck';

/** Role-play: pick an everyday situation, then answer the partner's questions in your own words. */
export function RolePlay(props: GameProps) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  if (!scenario) return <ScenarioPicker onPick={setScenario} onExit={props.onExit} />;
  return <Chat key={scenario.id} scenario={scenario} {...props} />;
}

function ScenarioPicker({ onPick, onExit }: { onPick: (s: Scenario) => void; onExit: () => void }) {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  return (
    <div className="g-game">
      <div className="g-head-plain">
        <SessionHead done={0} total={1} onClose={onExit} closeLabel="End role-play" label="Role-play" />
      </div>
      <h1 className="g-title">Role-play</h1>
      <p className="g-instr">Pick a situation. Your partner speaks first; answer in your own words and try to use your target phrases.</p>
      <ul className="g-scenarios">
        {SCENARIOS.map((s) => (
          <li key={s.id}>
            <button type="button" className="g-scenario" onClick={() => onPick(s)}>
              <span className="game-icon ice">
                <Icon name={s.icon} size={22} />
              </span>
              <span className="g-scenario-text">
                <b>{s.title}</b>
                <span>{s.setting}</span>
              </span>
              <Icon name="right" size={20} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chat({ scenario, pool, all, onExit, onAgain }: GameProps & { scenario: Scenario }) {
  const [targets] = useState(() => pickTargets(pool.length >= 3 ? pool : all, scenario.tags, 4));
  const [lines, setLines] = useState<ChatLine[]>([{ who: 'partner', text: scenario.lines[0] }]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [ended, setEnded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const replies = useMemo(() => lines.filter((l) => l.who === 'me').map((l) => l.text), [lines]);
  const used = useMemo(() => usedTargets(replies, targets), [replies, targets]);
  const finished = replies.length >= scenario.lines.length && !typing;

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'end' });
  }, [lines.length, typing]);
  useEffect(() => {
    // On phones the keyboard would cover the first question, so only focus with a real keyboard.
    if (typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches) inputRef.current?.focus({ preventScroll: true });
  }, []);

  const send = () => {
    const text = draft.trim();
    if (!text || typing || finished) return;
    const turn = replies.length + 1;
    setLines((l) => [...l, { who: 'me', text }]);
    setDraft('');
    if (inputRef.current) inputRef.current.style.height = '';
    const reply = turn < scenario.lines.length ? scenario.lines[turn] : scenario.closing;
    setTyping(true);
    const delay = prefersReducedMotion() ? 250 : Math.min(1600, 600 + reply.length * 12);
    timer.current = setTimeout(() => {
      setLines((l) => [...l, { who: 'partner', text: reply }]);
      setTyping(false);
    }, delay);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends on a keyboard; Shift+Enter (and Enter on touch screens) adds a new line.
    const touch = typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (!touch || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  };

  const end = () => {
    clearTimeout(timer.current);
    setTyping(false);
    for (const t of targets) if (used.has(t.id)) logGame(t, 'game', 'correct');
    setEnded(true);
  };

  if (ended) return <ChatEnd scenario={scenario} targets={targets} lines={lines} used={used} onAgain={onAgain} onExit={onExit} />;

  return (
    <div className="g-game g-chat-page">
      <SessionHead done={replies.length} total={scenario.lines.length} onClose={onExit} closeLabel="End role-play" label="Conversation progress" />
      <div className="g-chat-head">
        <span className="game-icon ice">
          <Icon name={scenario.icon} size={22} />
        </span>
        <div>
          <h1 className="g-chat-title">{scenario.title}</h1>
          <p className="g-chat-setting">
            {scenario.setting} You're talking to the <b>{scenario.partner.toLowerCase()}</b>.
          </p>
        </div>
      </div>

      {targets.length > 0 && (
        <div className="g-targets">
          <span className="g-targets-label">
            Try to use · {used.size}/{targets.length}
          </span>
          <ul className="chips">
            {targets.map((t) => (
              <li key={t.id} className={used.has(t.id) ? 'chip ok' : 'chip'} title={t.translation}>
                {used.has(t.id) && <Icon name="check" size={14} strokeWidth={3} />}
                {t.term}
                {used.has(t.id) && <span className="sr-only"> (used)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="g-chat" role="log" aria-live="polite" aria-label="Conversation">
        {lines.map((l, i) =>
          l.who === 'partner' ? (
            <div key={i} className="g-msg partner">
              <span className="g-avatar" aria-hidden="true">
                <Icon name={scenario.icon} size={16} />
              </span>
              <div className="g-bubble">
                <span className="g-who">{scenario.partner}</span>
                {l.text}
              </div>
              <Speak text={l.text} label="Listen" />
            </div>
          ) : (
            <div key={i} className="g-msg me">
              <div className="g-bubble">
                <span className="sr-only">You: </span>
                {l.text}
              </div>
              {targets.some((t) => sentenceUsesTerm(l.text, t.term)) && (
                <div className="g-msg-used">
                  {targets
                    .filter((t) => sentenceUsesTerm(l.text, t.term))
                    .map((t) => (
                      <span key={t.id} className="chip ok">
                        <Icon name="check" size={12} strokeWidth={3} /> {t.term}
                      </span>
                    ))}
                </div>
              )}
            </div>
          ),
        )}
        {typing && (
          <div className="g-msg partner">
            <span className="g-avatar" aria-hidden="true">
              <Icon name={scenario.icon} size={16} />
            </span>
            <div className="g-bubble g-typing">
              <span className="sr-only">{scenario.partner} is typing</span>
              <i aria-hidden="true" />
              <i aria-hidden="true" />
              <i aria-hidden="true" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {replies.length > 0 && !finished && (
        <div className="g-finish">
          <button type="button" className="link-btn" onClick={end}>
            Finish now
          </button>
        </div>
      )}

      <div className="g-composer-bar">
        <ActionBar>
          {finished ? (
            <ContinueButton label="See my results" onClick={end} />
          ) : (
            <form
              className="g-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                ref={inputRef}
                value={draft}
                rows={1}
                maxLength={600}
                placeholder="Type your reply…"
                aria-label="Your reply"
                onKeyDown={onKey}
                onChange={(e) => {
                  setDraft(e.target.value);
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight + 3, 144)}px`;
                }}
              />
              <button type="submit" className="primary g-send" aria-label="Send" disabled={!draft.trim() || typing}>
                <Icon name="arrow" size={22} strokeWidth={2.5} />
              </button>
            </form>
          )}
        </ActionBar>
      </div>
    </div>
  );
}

function ChatEnd({
  scenario,
  targets,
  lines,
  used,
  onAgain,
  onExit,
}: {
  scenario: Scenario;
  targets: Item[];
  lines: ChatLine[];
  used: Set<string>;
  onAgain: () => void;
  onExit: () => void;
}) {
  const replies = lines.filter((l) => l.who === 'me').map((l) => l.text);
  const toSave = repliesToSave(replies, targets);
  const ai = activeAi(useAi());
  const chat = `A role-play chat: ${scenario.title}. ${scenario.setting} The text below is the student's replies, one per line. The whole chat was:\n${lines
    .map((l) => `${l.who === 'me' ? 'Student' : scenario.partner}: ${l.text.trim()}`)
    .join('\n')}`;
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyText, setCopyText] = useState<string | null>(null);
  const copyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (copyText === null) return;
    copyRef.current?.focus();
    copyRef.current?.select();
  }, [copyText]);

  const save = async () => {
    if (busy || saved !== null) return;
    setBusy(true);
    let n = 0;
    for (const { item, text } of toSave) {
      try {
        const fresh = await db.items.get(item.id);
        if (!fresh) continue;
        await addSentence(fresh, text);
        n++;
      } catch (e) {
        console.error(e);
      }
    }
    setBusy(false);
    setSaved(n);
    toast(n ? `Saved ${plural(n, 'sentence')}` : 'Nothing saved', n ? 'check' : 'alert');
  };

  const copy = async () => {
    const text = aiCheckPrompt(scenario, targets, lines);
    try {
      if (!navigator.clipboard) throw new Error('No clipboard');
      await navigator.clipboard.writeText(text);
      toast('Copied. Paste it into Claude or Gemini.', 'copy');
    } catch {
      setCopyText(text);
    }
  };

  const hasTargets = targets.length > 0;
  return (
    <GameOver
      score={hasTargets ? used.size : replies.length}
      max={hasTargets ? targets.length : undefined}
      unit={hasTargets ? undefined : replies.length === 1 ? 'reply' : 'replies'}
      title={hasTargets ? scoreTitle(used.size, targets.length) : 'Nice chat!'}
      summary={hasTargets ? `You used ${used.size} of ${targets.length} target phrases.` : `You answered ${plural(replies.length, 'question')}.`}
      extra={
        used.size
          ? targets
              .filter((t) => used.has(t.id))
              .map((t) => (
                <span key={t.id} className="chip ok">
                  <Icon name="check" size={14} strokeWidth={3} /> {t.term}
                </span>
              ))
          : undefined
      }
      misses={targets.filter((t) => !used.has(t.id)).map((t) => ({ key: t.id, text: t.term, sub: t.translation, subLang: 'ru' }))}
      missesTitle="Not used this time"
      onAgain={onAgain}
      onExit={onExit}
    >
      <section className="card g-transcript" aria-labelledby="g-transcript-title">
        <h2 id="g-transcript-title">
          <Icon name={scenario.icon} size={20} /> {scenario.title}
        </h2>
        <ol className="g-transcript-list">
          {lines.map((l, i) => (
            <li key={i} className={l.who}>
              <span className="g-transcript-who">{l.who === 'me' ? 'You' : scenario.partner}</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ol>
        <div className="g-transcript-actions">
          <button type="button" onClick={save} disabled={!toSave.length || busy || saved !== null}>
            <Icon name={saved !== null ? 'check' : 'pen'} size={18} />
            {saved !== null ? `Saved ${plural(saved, 'sentence')}` : toSave.length ? `Save to my sentences (${toSave.length})` : 'Save to my sentences'}
          </button>
          {!ai && (
            <button type="button" onClick={copy} disabled={!replies.length}>
              <Icon name="copy" size={18} /> Copy for AI check
            </button>
          )}
        </div>
        <p className="g-transcript-note">
          {toSave.length
            ? 'Saving adds each reply that uses a target phrase to that word, once per word.'
            : 'Use a target phrase in a reply to save it as your own sentence.'}
        </p>
        {replies.length > 0 && <AiCheck text={replies.join('\n')} targets={targets.map((t) => ({ term: t.term, translation: t.translation }))} context={chat} />}
        {copyText !== null && (
          <div className="g-copy-fallback">
            <p>
              <b>Press Ctrl+C / long-press to copy.</b>
            </p>
            <textarea ref={copyRef} readOnly value={copyText} rows={8} aria-label="Text to copy" onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
      </section>
    </GameOver>
  );
}
