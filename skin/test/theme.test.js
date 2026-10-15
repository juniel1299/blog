import { afterEach, describe, expect, test, vi } from 'vitest';
import { initThemeToggle, toggleTheme } from '../src/scripts/theme.js';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('theme', () => {
  test('toggle flips theme, persists it, and updates the button', () => {
    document.documentElement.dataset.theme = 'light';
    const button = document.createElement('button');
    initThemeToggle(button);

    button.click();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  test('uses stored theme when none is set on the page', () => {
    localStorage.setItem('theme', 'dark');
    initThemeToggle(document.createElement('button'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  test('still toggles when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    document.documentElement.dataset.theme = 'dark';
    expect(toggleTheme()).toBe('light');
  });

  test('missing button is a no-op', () => {
    expect(() => initThemeToggle(null)).not.toThrow();
  });
});
