import { useState } from 'react';
import { ItemForm } from '../components/ItemForm';
import { termKey } from '../lib/content';
import { db } from '../lib/db';
import { addContents } from '../lib/decks';
import { AI_PROMPT, parseImport } from '../lib/importer';
import type { ItemContent } from '../lib/types';

export function AddWords({ tab }: { tab: string }) {
  return (
    <section className="page">
      <h1>Add words</h1>
      <div className="tabs">
        <a className={tab !== 'ai' ? 'tab on' : 'tab'} href="#/add">
          One by one
        </a>
        <a className={tab === 'ai' ? 'tab on' : 'tab'} href="#/add?tab=ai">
          From an AI chat
        </a>
      </div>
      {tab === 'ai' ? <FromAi /> : <Manual />}
    </section>
  );
}

function Manual() {
  const [formKey, setFormKey] = useState(0);
  const [msg, setMsg] = useState('');
  return (
    <div className="card">
      {msg && <p className="ok-msg">{msg}</p>}
      <ItemForm
        key={formKey}
        submitLabel="Add"
        onSubmit={async (c) => {
          const n = await addContents([{ ...c, tags: c.tags.length ? c.tags : ['my'] }], 'own');
          setMsg(n ? `✓ Added “${c.term}”. It will appear in your next session.` : `“${c.term}” is already in your library.`);
          setFormKey((k) => k + 1);
        }}
      />
    </div>
  );
}

function FromAi() {
  const [topic, setTopic] = useState('');
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ items: ItemContent[]; skipped: number; existing: Set<string> } | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState('');

  const prompt = AI_PROMPT + (topic.trim() || '(use the words and phrases from our conversation above)');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked on plain http; the text stays selectable below.
    }
  };

  const check = async () => {
    const result = parseImport(text);
    const existing = new Set((await db.items.toArray()).map((i) => termKey(i.term)));
    setParsed({ ...result, existing });
    setChosen(new Set(result.items.map((_, i) => i).filter((i) => !existing.has(termKey(result.items[i].term)))));
    setMsg('');
  };

  const add = async () => {
    if (!parsed) return;
    const list = parsed.items.filter((_, i) => chosen.has(i)).map((c) => ({ ...c, source: c.source || 'AI chat' }));
    const n = await addContents(list, 'own');
    setMsg(`✓ Added ${n} item${n === 1 ? '' : 's'} to your library.`);
    setParsed(null);
    setText('');
  };

  return (
    <>
      <div className="card">
        <h3>1. Copy the prompt into Claude or Gemini</h3>
        <p className="muted small">
          Paste it at the end of a chat where you met new words, or write a topic and the AI will pick phrases for it.
        </p>
        <label className="field">
          <span>Topic or text (optional)</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. job interviews, or paste a paragraph" />
        </label>
        <details>
          <summary>See the prompt</summary>
          <pre className="prompt-box">{prompt}</pre>
        </details>
        <button className="primary" onClick={copy}>
          {copied ? '✓ Copied' : 'Copy prompt'}
        </button>
      </div>
      <div className="card">
        <h3>2. Paste the AI's answer here</h3>
        <p className="muted small">
          The JSON it returns works best. Simple lines like “make a decision - принять решение” work too.
        </p>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder='[ { "term": "…", "translation": "…" } ]' />
        <button className="primary" onClick={check} disabled={!text.trim()}>
          Check
        </button>
        {msg && <p className="ok-msg">{msg}</p>}
      </div>
      {parsed && (
        <div className="card">
          <h3>3. Choose what to add</h3>
          {parsed.items.length === 0 ? (
            <p className="hint">I couldn't find any words in this text. Make sure you pasted the whole answer.</p>
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
                        <b>{c.term}</b> <span className="muted">— {c.translation}</span>
                        {dup && <span className="chip">already added</span>}
                        {c.example && <span className="small muted block">{c.example.replace(/[[\]]/g, '')}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {parsed.skipped > 0 && <p className="muted small">{parsed.skipped} entries had no term or translation and were skipped.</p>}
              <button className="primary" onClick={add} disabled={chosen.size === 0}>
                Add {chosen.size} to my library
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
