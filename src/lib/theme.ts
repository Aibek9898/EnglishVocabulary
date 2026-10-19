export type Theme = 'system' | 'light' | 'dark';

const KEY = 'vocab-theme';
const BG = { light: '#f7f7fb', dark: '#0e0e14' };

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

/** Sets the colour theme on <html> and the browser bar colour to match. */
export function applyTheme(theme: Theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const forDark = m.media.includes('dark');
    m.content = theme === 'system' ? (forDark ? BG.dark : BG.light) : BG[theme];
  });
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Private mode: the choice lasts until reload.
  }
  applyTheme(theme);
}
