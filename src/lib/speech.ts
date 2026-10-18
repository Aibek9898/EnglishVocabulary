import { getSettings } from './db';

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

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

export async function speak(text: string, rate?: number) {
  if (!canSpeak || !text) return;
  const settings = await getSettings();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(settings.voiceName);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? 'en-US';
  u.rate = rate ?? settings.speechRate;
  speechSynthesis.speak(u);
}
