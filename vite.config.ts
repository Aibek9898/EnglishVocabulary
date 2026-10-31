import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for the built site. The page may only run its own
 * scripts and may only talk to its own origin and the two AI services, so the
 * AI key saved in Settings can't be sent anywhere else. Build only: the dev
 * server injects inline scripts for hot reload.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://openrouter.ai https://api.deepseek.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "media-src 'self' blob:",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    // Right after the charset, before anything that loads.
    transformIndexHtml: (html) => html.replace(/(<meta charset[^>]*>)/i, `$1\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

// base './' keeps the build working from any folder or sub-path (GitHub Pages etc.)
export default defineConfig({
  base: './',
  plugins: [react(), csp()],
  test: {
    environment: 'node',
  },
});
