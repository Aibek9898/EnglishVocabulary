import { liveQuery } from 'dexie';
import { getSettings } from './db';
import { DEFAULT_SETTINGS, type Settings } from './types';

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

// Settings are kept in memory so speak() runs synchronously: iOS only plays
// speech started directly inside a tap, not after an await.
let settings: Settings = DEFAULT_SETTINGS;
if (canSpeak) liveQuery(getSettings).subscribe({ next: (s) => (settings = s), error: () => {} });

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!canSpeak) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
}

function pickVoice(name: string) {
  const voices = englishVoices();
  return (
    voices.find((v) => v.name === name) ??
    voices.find((v) => v.lang === 'en-US' && v.localService) ??
    voices.find((v) => v.lang === 'en-GB') ??
    voices[0]
  );
}

export function speak(text: string, rate?: number) {
  if (!canSpeak || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(settings.voiceName);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? 'en-US';
  u.rate = rate ?? settings.speechRate;
  speechSynthesis.speak(u);
}

/** Call inside a tap (e.g. "Start lesson") so later automatic speech is allowed on iOS. */
export function unlockSpeech() {
  if (!canSpeak) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}
