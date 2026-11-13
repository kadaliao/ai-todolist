import { type Theme, useUI } from '../state/ui';

const media = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]:not([media])')?.remove();
}

export function setTheme(theme: Theme): void {
  localStorage.setItem('docket.theme', theme);
  useUI.setState({ theme });
  applyTheme(theme);
}

export function toggleTheme(): void {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

media.addEventListener('change', () => applyTheme(useUI.getState().theme));
applyTheme(useUI.getState().theme);
