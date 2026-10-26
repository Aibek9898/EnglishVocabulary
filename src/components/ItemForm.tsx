import { useState } from 'react';
import { guessType } from '../lib/content';
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
  const [wrong, setWrong] = useState((initial.wrong ?? []).join(', '));
  // Guess the type from the term until the learner picks one.
  const [typeTouched, setTypeTouched] = useState(!!initial.term);
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
          ipa: c.ipa?.replace(/^[[/]+|[\]/]+$/g, '').trim() || undefined,
          translation: c.translation.trim(),
          collocations: split(collocations),
          wrong: split(wrong),
          tags: split(tags).map((t) => t.toLowerCase()),
        });
      }}
    >
      <div className="grid2">
        <label className="field">
          <span>English word or phrase</span>
          <input
            value={c.term}
            onChange={(e) => setC({ ...c, term: e.target.value, type: typeTouched ? c.type : guessType(e.target.value || 'x') })}
            required
            placeholder="e.g. come up with sth"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Russian translation</span>
          <input value={c.translation} onChange={set('translation')} required placeholder="e.g. придумать" lang="ru" />
        </label>
      </div>
      <label className="field">
        <span>Example sentence</span>
        <input value={c.example} onChange={set('example')} onBlur={markTarget} placeholder="e.g. She came up with a great idea." autoCapitalize="sentences" />
        <small>The phrase gets marked automatically. Use [brackets] if the sentence changes its form, e.g. “She [came up with] it”.</small>
      </label>
      <label className="field">
        <span>Example in Russian</span>
        <input value={c.exampleRu} onChange={set('exampleRu')} placeholder="e.g. Она придумала отличную идею." lang="ru" />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Type</span>
          <select
            value={c.type}
            onChange={(e) => {
              setTypeTouched(true);
              setC({ ...c, type: e.target.value as ItemType });
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('-', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tags</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. work, ideas" autoCapitalize="off" />
        </label>
      </div>
      <details>
        <summary>More details</summary>
        <label className="field">
          <span>Transcription</span>
          <input value={c.ipa ?? ''} onChange={set('ipa')} placeholder="e.g. kʌm ʌp wɪð" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        <label className="field">
          <span>English definition</span>
          <input value={c.definition} onChange={set('definition')} placeholder="e.g. to think of an idea or a plan" />
        </label>
        <label className="field">
          <span>Other collocations</span>
          <input value={collocations} onChange={(e) => setCollocations(e.target.value)} placeholder="e.g. come up with a plan, come up with an excuse" />
        </label>
        <label className="field">
          <span>Grammar pattern</span>
          <input value={c.pattern} onChange={set('pattern')} placeholder="come up with sth / an idea" />
        </label>
        <label className="field">
          <span>Trap</span>
          <input value={c.trap} onChange={set('trap')} placeholder="e.g. Not 'come up on' an idea" />
        </label>
        <label className="field">
          <span>Wrong versions</span>
          <input value={wrong} onChange={(e) => setWrong(e.target.value)} placeholder="e.g. came up on" autoCapitalize="off" />
          <small>Typical mistakes, in the same form as in the example. Games use them.</small>
        </label>
        <label className="field">
          <span>Where I met it</span>
          <input value={c.source ?? ''} onChange={set('source')} placeholder="e.g. a series, an article, a meeting" />
        </label>
      </details>
      <div className="row">
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary" disabled={!c.term.trim() || !c.translation.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
