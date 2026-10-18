import { useState } from 'react';
import type { ItemContent, ItemType } from '../lib/types';

export const EMPTY: ItemContent = {
  term: '',
  type: 'collocation',
  translation: '',
  definition: '',
  example: '',
  exampleRu: '',
  collocations: [],
  pattern: '',
  trap: '',
  tags: [],
  source: '',
};

const TYPES: ItemType[] = ['collocation', 'phrasal-verb', 'idiom', 'phrase', 'word'];

/** Shared form for adding and editing a word or phrase. */
export function ItemForm({
  initial = EMPTY,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ItemContent;
  submitLabel: string;
  onSubmit: (c: ItemContent) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [c, setC] = useState<ItemContent>(initial);
  const [collocations, setCollocations] = useState(initial.collocations.join(', '));
  const [tags, setTags] = useState(initial.tags.join(', '));
  const set = (k: keyof ItemContent) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setC({ ...c, [k]: e.target.value });

  const markTarget = () => {
    // Wrap the term in [brackets] inside the example if it is there and not marked yet.
    if (!c.term || c.example.includes('[')) return;
    const idx = c.example.toLowerCase().indexOf(c.term.toLowerCase());
    if (idx >= 0) {
      setC({ ...c, example: `${c.example.slice(0, idx)}[${c.example.slice(idx, idx + c.term.length)}]${c.example.slice(idx + c.term.length)}` });
    }
  };

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
        await onSubmit({
          ...c,
          term: c.term.trim(),
          translation: c.translation.trim(),
          collocations: split(collocations),
          tags: split(tags).map((t) => t.toLowerCase()),
        });
      }}
    >
      <div className="grid2">
        <label className="field">
          <span>English word or phrase *</span>
          <input value={c.term} onChange={set('term')} required placeholder="come up with sth" autoCapitalize="off" />
        </label>
        <label className="field">
          <span>Russian translation *</span>
          <input value={c.translation} onChange={set('translation')} required placeholder="придумать" />
        </label>
      </div>
      <label className="field">
        <span>Example sentence (put the target in [brackets])</span>
        <input value={c.example} onChange={set('example')} onBlur={markTarget} placeholder="She [came up with] a great idea." />
      </label>
      <label className="field">
        <span>Example in Russian</span>
        <input value={c.exampleRu} onChange={set('exampleRu')} placeholder="Она придумала отличную идею." />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Type</span>
          <select value={c.type} onChange={set('type')}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tags (comma separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="work, ideas" autoCapitalize="off" />
        </label>
      </div>
      <details>
        <summary>More details</summary>
        <label className="field">
          <span>English definition</span>
          <input value={c.definition} onChange={set('definition')} />
        </label>
        <label className="field">
          <span>Other collocations (comma separated)</span>
          <input value={collocations} onChange={(e) => setCollocations(e.target.value)} />
        </label>
        <label className="field">
          <span>Grammar pattern</span>
          <input value={c.pattern} onChange={set('pattern')} placeholder="come up with sth / an idea" />
        </label>
        <label className="field">
          <span>Trap (typical mistake)</span>
          <input value={c.trap} onChange={set('trap')} />
        </label>
        <label className="field">
          <span>Where I met it</span>
          <input value={c.source ?? ''} onChange={set('source')} placeholder="Series, article, work…" />
        </label>
      </details>
      <div className="row">
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
