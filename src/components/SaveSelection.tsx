import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cleanPhrase, isSaveable, savePhrase } from '../lib/saved';
import { Icon } from './Icon';

interface Picked {
  text: string;
  from?: string;
  /** An open dialog the selection is in: the button must live there to be on top. */
  host: Element;
}

/** The selected text on the page, if it is a word or a short phrase outside a text field. */
function readSelection(): Picked | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return null;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el || el.closest('input, textarea, [contenteditable="true"], .save-pill')) return null;
  const text = cleanPhrase(sel.toString());
  if (!isSaveable(text)) return null;
  const from = el.closest('[data-term]')?.getAttribute('data-term') ?? undefined;
  return { text, from, host: el.closest('dialog[open]') ?? document.body };
}

/**
 * Select any word or phrase on the site and a "Save" button appears at the
 * bottom; saved phrases wait in Library → Saved until they become cards.
 */
export function SaveSelection() {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [done, setDone] = useState<'saved' | 'there' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onChange = () => {
      clearTimeout(timer.current);
      const next = readSelection();
      // Show quickly; hide a little later, because tapping the button clears the selection on phones.
      timer.current = setTimeout(
        () => {
          setPicked(next);
          if (next) setDone(null);
        },
        next ? 150 : 400,
      );
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      clearTimeout(timer.current);
    };
  }, []);

  if (!picked) return null;

  const save = async () => {
    const added = await savePhrase(picked.text, picked.from);
    setDone(added ? 'saved' : 'there');
    window.getSelection()?.removeAllRanges();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setPicked(null);
      setDone(null);
    }, 1400);
  };

  const short = picked.text.length > 28 ? picked.text.slice(0, 26) + '…' : picked.text;
  return createPortal(
    <button
      type="button"
      className={'save-pill' + (done ? ' done' : '')}
      onPointerDown={(e) => e.preventDefault()}
      onClick={done ? undefined : save}
      aria-live="polite"
    >
      <Icon name={done ? 'check' : 'bookmark'} size={18} />
      {done === 'saved' ? 'Saved to Library → Saved' : done === 'there' ? 'Already saved' : <>Save “{short}”</>}
    </button>,
    picked.host,
  );
}
