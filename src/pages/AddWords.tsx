import { useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { ItemForm } from '../components/ItemForm';
import { toast, usePageTitle } from '../components/ui';
import { plainExample } from '../lib/cloze';
import { termKey } from '../lib/content';
import { db } from '../lib/db';
import { addContents } from '../lib/decks';
import { AI_PROMPT, parseImport } from '../lib/importer';
import type { ItemContent } from '../lib/types';

export function AddWords({ tab }: { tab: string }) {
  usePageTitle('Add words');
  return (
    <section className="page">
      <div className="page-head">
        <h1>Add words</h1>
      </div>
      <nav className="tabs" aria-label="How to add">
        <a className="tab" href="#/add" aria-current={tab !== 'ai' ? 'page' : undefined}>
          One by one
        </a>
        <a className="tab" href="#/add?tab=ai" aria-current={tab === 'ai' ? 'page' : undefined}>
          From an AI chat
        </a>
      </nav>
      {tab === 'ai' ? <FromAi /> : <Manual />}
    </section>
  );
}

function Manual() {
  const [formKey, setFormKey] = useState(0);
  return (
    <div className="card">
      <ItemForm
        key={formKey}
        submitLabel="Add word"
        onSubmit={async (c) => {
          const n = await addContents([{ ...c, tags: c.tags.length ? c.tags : ['my'] }], 'own');
          if (n) toast(`Added “${c.term}”. It comes up in your next lesson.`);
          else toast(`“${c.term}” is already in your library`, 'info');
          setFormKey((k) => k + 1);
        }}
      />
    </div>
  );
}

type Mode = 'chat' | 'topic';

function FromAi() {
  const [mode, setMode] = useState<Mode>('chat');
  const [topic, setTopic] = useState('');
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ items: ItemContent[]; skipped: number; existing: Set<string> } | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [added, setAdded] = useState<number | null>(null);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  const ask =
    mode === 'topic'
      ? topic.trim()
        ? `Topic: ${topic.trim()}`
        : '(choose a useful everyday topic for me)'
      : '(use the words and phrases from our conversation above)';
  const prompt = AI_PROMPT + ask;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('yes');
      setTimeout(() => setCopied(null), 2500);
    } catch {
      // Clipboard can be blocked; show the text so it can be copied by hand.
      setCopied('failed');
      setTimeout(() => promptBox.current?.select(), 0);
    }
  };

  const preview = async () => {
    const result = parseImport(text);
    const existing = new Set((await db.items.toArray()).map((i) => termKey(i.term)));
    setParsed({ ...result, existing });
    setChosen(new Set(result.items.map((_, i) => i).filter((i) => !existing.has(termKey(result.items[i].term)))));
  };

  const add = async () => {
    if (!parsed) return;
    const list = parsed.items.filter((_, i) => chosen.has(i)).map((c) => ({ ...c, source: c.source || 'AI chat' }));
    const n = await addContents(list, 'own');
    setAdded(n);
    setParsed(null);
    setText('');
  };

  if (added !== null) {
    return (
      <div className="card center success-card">
        <span className="empty-icon ok">
          <Icon name="check" size={28} strokeWidth={3} />
        </span>
        <h2>
          {added} word{added === 1 ? '' : 's'} added
        </h2>
        <p className="muted">They come in at your daily pace, a few at a time.</p>
        <div className="row center">
          <a className="button primary" href="#/today">
            Start a lesson
          </a>
          <button type="button" onClick={() => setAdded(null)}>
            Add more
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="choice-cards" role="group" aria-label="Where the words come from">
        <button type="button" className="choice-card" aria-pressed={mode === 'chat'} onClick={() => setMode('chat')}>
          <Icon name="chat" size={22} />
          <b>I have a chat</b>
          <span>You met new words while talking to Claude or Gemini.</span>
        </button>
        <button type="button" className="choice-card" aria-pressed={mode === 'topic'} onClick={() => setMode('topic')}>
          <Icon name="sparkles" size={22} />
          <b>Pick a topic</b>
          <span>The AI suggests useful phrases for a topic.</span>
        </button>
      </div>

      <div className="card">
        <h3>
          <span className="step-num">1</span>
          {mode === 'chat' ? 'Copy this prompt to the end of that chat' : 'Copy this prompt into Claude or Gemini'}
        </h3>
        {mode === 'topic' && (
          <label className="field">
            <span>Topic</span>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. job interviews, renting a flat, small talk" />
          </label>
        )}
        <button type="button" className="primary" onClick={copy}>
          <Icon name={copied === 'yes' ? 'check' : 'copy'} size={18} /> {copied === 'yes' ? 'Copied' : 'Copy prompt'}
        </button>
        {copied === 'failed' && <p className="hint-line">Copying is blocked here. Select the text below and copy it.</p>}
        <details open={copied === 'failed' || undefined}>
          <summary>See the prompt</summary>
          <textarea ref={promptBox} className="prompt-box" readOnly rows={10} value={prompt} />
        </details>
      </div>

      <div className="card">
        <h3>
          <span className="step-num">2</span>Paste the AI's answer
        </h3>
        <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the whole answer here" aria-label="The AI's answer" />
        <p className="muted small">Simple lines like “make a decision - принять решение” work too.</p>
        <button type="button" className="primary" onClick={preview} disabled={!text.trim()}>
          Preview words
        </button>
      </div>

      {parsed && (
        <div className="card">
          <h3>
            <span className="step-num">3</span>Choose what to add
          </h3>
          {parsed.items.length === 0 ? (
            <p className="hint-line">I couldn't find any words in this text. Check that you pasted the whole answer.</p>
          ) : (
            <>
              <ul className="import-list">
                {parsed.items.map((c, i) => {
                  const dup = parsed.existing.has(termKey(c.term));
                  return (
                    <li key={i}>
                      <label>
                        <input
                          type="checkbox"
                          checked={chosen.has(i)}
                          onChange={(e) => {
                            const s = new Set(chosen);
                            if (e.target.checked) s.add(i);
                            else s.delete(i);
                            setChosen(s);
                          }}
                        />
                        <span>
                          <b>{c.term}</b>{' '}
                          <span className="muted" lang="ru">
                            — {c.translation}
                          </span>
                          {dup && <span className="chip">already added</span>}
                          {c.tags.includes('my-mistakes') && <span className="chip gold">my mistake</span>}
                          {c.example && <span className="small muted block">{plainExample(c.example)}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {parsed.skipped > 0 && <p className="muted small">{parsed.skipped} entries had no term or translation and were skipped.</p>}
              <button type="button" className="primary block" onClick={add} disabled={chosen.size === 0}>
                Add {chosen.size} word{chosen.size === 1 ? '' : 's'}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
