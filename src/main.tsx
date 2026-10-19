import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { db } from './lib/db';
import { syncPacks } from './lib/decks';
import { applyTheme } from './lib/theme';
import './styles.css';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Libraries made from older pack files get the latest fixes (progress is kept).
syncPacks().catch(console.error);

// Ask the browser not to clear our data when the disk is low.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Handy for debugging in the console.
Object.assign(window, { db });
