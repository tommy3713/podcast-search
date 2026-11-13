'use client';

import { useEffect } from 'react';
import { THEME_KEY, isTheme, themeToSave, type Theme } from '@/lib/theme';

const systemTheme = (): Theme => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function apply(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

// Which half shows (moon and 切換成深色模式 in light, sun and 切換成淺色模式 in dark) is up to
// CSS, from the theme showing, so the server and the first client render agree, nothing flips
// after hydration, and the hidden half's text is left out of the accessible name too.
export function ThemeToggle() {
  // Another tab switching, or clearing site data (key null), changes this one too
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY || e.key === null) apply(isTheme(e.newValue) ? e.newValue : null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const onClick = () => {
    const system = systemTheme();
    const set = document.documentElement.dataset.theme;
    const saved = themeToSave(isTheme(set) ? set : system, system);
    apply(saved);
    try {
      if (saved) localStorage.setItem(THEME_KEY, saved);
      else localStorage.removeItem(THEME_KEY);
    } catch {
      // Not saved (private mode): this page still switches
    }
  };

  return (
    <button type="button" className="btn ghost theme-toggle" onClick={onClick}>
      <span className="to-dark">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
        <span className="sr-only">切換成深色模式</span>
      </span>
      <span className="to-light">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <span className="sr-only">切換成淺色模式</span>
      </span>
    </button>
  );
}
