import { canSpeak, speak } from '../lib/speech';

export function Speak({ text, label = 'Listen' }: { text: string; label?: string }) {
  if (!canSpeak) return null;
  return (
    <button
      type="button"
      className="icon-btn"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        speak(text);
      }}
    >
      🔊
    </button>
  );
}
