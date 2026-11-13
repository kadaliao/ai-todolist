import type { Replica } from '@ai-todo/core';
import { addFromText } from './components/QuickAdd';
import { setNotifier } from './state/reminders';

/**
 * Native shell integration. In the desktop app (Tauri) reminders use system notifications and
 * the global quick-entry window hands typed text to this window. In a browser this is a no-op.
 */

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const isMac = /Mac/.test(navigator.platform || navigator.userAgent);

export async function initPlatform(_replica: Replica): Promise<void> {
  if (!isTauri) return;
  document.documentElement.classList.add('tauri');
  if (isMac) document.documentElement.classList.add('tauri-mac');

  const notification = await import('@tauri-apps/plugin-notification');
  setNotifier({
    async permission() {
      return (await notification.isPermissionGranted()) ? 'granted' : 'default';
    },
    async request() {
      return (await notification.requestPermission()) === 'granted';
    },
    show(title, body) {
      notification.sendNotification({ title, body });
    },
  });

  const { listen } = await import('@tauri-apps/api/event');
  await listen<{ text: string; ignore: string[] }>('quick-add', (event) => {
    addFromText(event.payload.text, event.payload.ignore);
  });
}
