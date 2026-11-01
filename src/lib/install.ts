import { useSyncExternalStore } from 'react';

/** Chrome's install prompt (not in the TypeScript DOM types yet). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  // Kept so the Settings button can open the same prompt later; Chrome's own banner still shows.
  window.addEventListener('beforeinstallprompt', (e) => {
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

/** True when the site is open as an installed app, not in a browser tab. */
export const isStandalone = () =>
  typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

export type InstallState = 'app' | 'installed' | 'ready' | 'manual';

const state = (): InstallState => (isStandalone() ? 'app' : installed ? 'installed' : deferred ? 'ready' : 'manual');

export function useInstall(): InstallState {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, state);
}

/** Opens Chrome's install dialog. Returns false when it can't be opened from here. */
export async function installApp(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') {
      deferred = null;
      installed = true;
      notify();
    }
    return true;
  } catch {
    return false;
  }
}
