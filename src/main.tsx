import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { cloudEnabled } from './lib/cloud';
import { db } from './lib/db';
import { syncPacks } from './lib/decks';
import { applyTheme } from './lib/theme';
// Listens for Chrome's install prompt from the start, before Settings is opened.
import './lib/install';
import './styles.css';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Libraries made from older pack files get the latest fixes (progress is kept).
// With accounts, this runs once the account's words are open (see App).
if (!cloudEnabled) syncPacks().catch(console.error);

// Ask the browser not to clear our data when the disk is low.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Handy for debugging in the console.
Object.defineProperty(window, 'db', { get: () => db, configurable: true });
