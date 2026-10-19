import { canSpeak, speak } from '../lib/speech';
import { Icon } from './Icon';

export function Speak({ text, label = 'Listen', small = false }: { text: string; label?: string; small?: boolean }) {
  if (!canSpeak || !text) return null;
  return (
    <button
      type="button"
      className={small ? 'speak-btn small' : 'speak-btn'}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        speak(text);
      }}
    >
      <Icon name="volume" size={small ? 16 : 20} />
    </button>
  );
}
