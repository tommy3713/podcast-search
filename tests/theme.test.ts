import { describe, expect, it } from 'vitest';
import { THEME_KEY, THEME_SCRIPT, themeToSave } from '@/lib/theme';

describe('themeToSave', () => {
  it('switching away from the system theme saves the new one', () => {
    expect(themeToSave('light', 'light')).toBe('dark');
    expect(themeToSave('dark', 'dark')).toBe('light');
  });

  it('switching back to the system theme saves nothing, so the site follows the system again', () => {
    expect(themeToSave('dark', 'light')).toBeNull();
    expect(themeToSave('light', 'dark')).toBeNull();
  });
});

describe('THEME_SCRIPT', () => {
  const run = (getItem: (k: string) => string | null) => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    new Function('localStorage', 'document', THEME_SCRIPT)({ getItem }, document);
    return document.documentElement.dataset.theme;
  };

  it('applies a saved theme', () => {
    expect(run((k) => (k === THEME_KEY ? 'dark' : null))).toBe('dark');
    expect(run((k) => (k === THEME_KEY ? 'light' : null))).toBe('light');
  });

  it('leaves the system theme for nothing saved, junk, or a localStorage that throws', () => {
    expect(run(() => null)).toBeUndefined();
    expect(run(() => '"><script>')).toBeUndefined();
    expect(
      run(() => {
        throw new Error('SecurityError');
      }),
    ).toBeUndefined();
  });
});
