import { useEffect, useRef, useState } from 'react';
import { activeAi, AiError, moreExamples, useAi } from '../lib/ai';
import { plainExample } from '../lib/cloze';
import { db } from '../lib/db';
import type { Item, MoreExample } from '../lib/types';
import { Icon } from './Icon';
import { Example } from './ItemCard';
import { Speak } from './Speak';

/**
 * "More examples": the AI teacher writes a few more natural sentences with the
 * word. They are kept with the word, so they're there next time without asking
 * again; the button only shows once an AI key is saved in Settings.
 */
export function MoreExamples({ item }: { item: Item }) {
  const config = useAi();
  const ai = activeAi(config);
  // Local copy: in a lesson the word on screen doesn't refresh from the database.
  const [list, setList] = useState<MoreExample[]>(item.moreExamples ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => setList(item.moreExamples ?? []), [item.id, item.moreExamples]);

  const save = (next: MoreExample[]) => {
    setList(next);
    db.items.update(item.id, { moreExamples: next }).catch(console.error);
  };

  const more = async () => {
    if (!ai || busy) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    setBusy(true);
    setError('');
    try {
      const added = await moreExamples(ai, item, [item.example, ...list.map((e) => e.text)].filter(Boolean), ctrl.signal);
      save([...list, ...added]);
    } catch (e) {
      if (ctrl.signal.aborted) setError('The AI took too long to answer. Try again.');
      else setError(e instanceof AiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  if (!config || (!ai && !list.length)) return null;
  return (
    <section className="more-examples" aria-label="More examples">
      {list.length > 0 && (
        <ul className="more-examples-list">
          {list.map((e, i) => (
            <li key={e.text} className="example-row">
              <p className="example">
                {e.situation && <span className="example-situation">{e.situation}</span>}
                <Example item={{ example: e.text, term: item.term }} />
                {e.ru && (
                  <span className="example-ru" lang="ru">
                    {e.ru}
                  </span>
                )}
              </p>
              <span className="more-examples-actions">
                <Speak text={plainExample(e.text)} label="Listen to the example" small />
                <button
                  type="button"
                  className="icon-btn more-examples-remove"
                  aria-label={`Remove the example “${plainExample(e.text)}”`}
                  onClick={() => save(list.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size={16} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {ai && (
        <button type="button" className="small ai-check-btn" onClick={more} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="sparkles" size={18} />}
          {busy ? 'Writing examples…' : list.length ? 'Even more examples' : 'More examples'}
        </button>
      )}
      {error && (
        <p className="hint-line" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
