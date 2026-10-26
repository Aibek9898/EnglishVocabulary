import { useState } from 'react';
import { markExample, parseCloze, plainExample } from '../lib/cloze';
import { db } from '../lib/db';
import { packOriginal } from '../lib/decks';
import { anotherMeaning, cleanMeaning, editPatch, MEANING_KEYS, type Meaning } from '../lib/edit';
import { makeItem } from '../lib/srs';
import type { Item, ItemContent } from '../lib/types';
import { Icon } from './Icon';
import { toast } from './ui';

const BLANK: Meaning = { translation: '', definition: '', example: '', exampleRu: '' };
const meaningOf = (c: ItemContent): Meaning => ({ translation: c.translation, definition: c.definition, example: c.example, exampleRu: c.exampleRu });
const changed = (a: string, b: string) => a.trim() !== b.trim();

/**
 * Sheet content for writing your own translation and example for a card, or
 * adding another meaning of the same phrase as its own card. `onSave` stores
 * the changes, so a lesson can keep its copy of the card in step.
 */
export function EditMeaning({ item, onSave, onDone }: { item: Item; onSave: (patch: Partial<Item>) => unknown; onDone: () => void }) {
  const [mode, setMode] = useState<'edit' | 'another'>('edit');
  const original = packOriginal(item);

  if (mode === 'another') {
    return (
      <>
        <h2>Another meaning of “{item.term}”</h2>
        <p className="muted small">It becomes a separate card, so you learn each meaning with its own example.</p>
        <MeaningForm
          key="another"
          term={item.term}
          initial={BLANK}
          submitLabel="Add card"
          onCancel={() => setMode('edit')}
          onSubmit={async (m) => {
            await db.items.add(makeItem(anotherMeaning(item, m), 'own'));
            toast('Added. It comes with your next new words.', 'plus');
            onDone();
          }}
        />
      </>
    );
  }

  return (
    <>
      <h2>Your translation and example</h2>
      <p className="muted small">Lessons and games will use your version of “{item.term}”.</p>
      <MeaningForm
        key="edit"
        term={item.term}
        initial={meaningOf(item)}
        original={original && meaningOf(original)}
        submitLabel="Save"
        onCancel={onDone}
        onSubmit={async (m) => {
          const patch = editPatch(item, cleanMeaning(m, item.term, item), original);
          if (Object.keys(patch).length) await onSave(patch);
          toast('Saved. Lessons will use your version.');
          onDone();
        }}
      />
      <button type="button" className="link-btn another-meaning" onClick={() => setMode('another')}>
        <Icon name="plus" size={18} /> It has another meaning? Add it as a separate card
      </button>
    </>
  );
}

function MeaningForm({
  term,
  initial,
  original,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  term: string;
  initial: Meaning;
  original?: Meaning;
  submitLabel: string;
  onSubmit: (m: Meaning) => Promise<void>;
  onCancel: () => void;
}) {
  const [m, setM] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Meaning) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setM({ ...m, [k]: e.target.value });

  const example = m.example.trim();
  const cloze = example ? parseCloze(markExample(example, term), term) : null;
  const newSentence = changed(plainExample(m.example), plainExample(initial.example));
  const staleRu = !!initial.exampleRu.trim() && newSentence && !changed(m.exampleRu, initial.exampleRu);
  const staleDefinition = !!initial.definition.trim() && changed(m.translation, initial.translation) && !changed(m.definition, initial.definition);
  const canRestore = original && MEANING_KEYS.some((k) => changed(m[k], original[k]));

  return (
    <form
      className="form meaning-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(m);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Translation</span>
        <input value={m.translation} onChange={set('translation')} required lang="ru" placeholder="e.g. сбить с толку" autoFocus />
        <small>The meaning you want to learn. Lessons ask you for this one.</small>
      </label>
      <label className="field">
        <span>Example sentence</span>
        <textarea
          value={m.example}
          onChange={set('example')}
          rows={2}
          lang="en"
          placeholder={`A sentence with “${term}”`}
          autoCapitalize="sentences"
        />
        {cloze ? (
          <small className="meaning-preview">
            Exercises hide this part: {cloze.before}
            <mark>{cloze.answer}</mark>
            {cloze.after}
          </small>
        ) : (
          example && (
            <small className="hint-line">
              I can't find “{term}” in it. Put the words to learn in [square brackets], e.g. “It really [tripped me up]”.
            </small>
          )
        )}
      </label>
      <label className="field">
        <span>Sentence in Russian</span>
        <input value={m.exampleRu} onChange={set('exampleRu')} lang="ru" placeholder="e.g. Последний вопрос меня подловил." />
        {staleRu && <small className="hint-line">This translates the old sentence. Write a new one, or it will be left empty.</small>}
      </label>
      <label className="field">
        <span>English explanation (optional)</span>
        <input value={m.definition} onChange={set('definition')} placeholder="In simple English" />
        {staleDefinition ? (
          <small className="hint-line">This may explain the old meaning. Change it or clear it.</small>
        ) : (
          <small>Some exercises show it instead of the translation.</small>
        )}
      </label>
      {canRestore && (
        <button type="button" className="link-btn small" onClick={() => original && setM(original)}>
          <Icon name="reset" size={16} /> Back to the original from the pack
        </button>
      )}
      <div className="row">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy || !m.translation.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
