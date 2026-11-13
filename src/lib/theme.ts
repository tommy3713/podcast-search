// Light / dark theme. With nothing saved the site follows the system (globals.css,
// prefers-color-scheme); a saved choice sets data-theme on <html>, which globals.css lets win.

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'theme';

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark';
}

// The button shows the opposite of what is showing. What to save for that: the new theme, or
// nothing when it is the system's, so switching back returns to following the system.
export function themeToSave(showing: Theme, system: Theme): Theme | null {
  const next: Theme = showing === 'dark' ? 'light' : 'dark';
  return next === system ? null : next;
}

// Runs in <head> before the body is painted, so a saved theme shows without a flash of the
// other one. localStorage throws in some private modes; the system theme is the fallback.
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
