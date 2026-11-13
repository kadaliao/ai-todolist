import '@fontsource-variable/bricolage-grotesque';
import './styles/index.css';
import type { Replica } from '@ai-todo/core';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Boot: Temporal polyfill if needed → single-instance lock → load the replica from IndexedDB →
 * start sync → render. Locale changes re-mount the tree so every string re-renders.
 */

type Modules = {
  App: typeof import('./App').App;
  rep: typeof import('./state/replica');
  actions: typeof import('./state/actions');
  sync: typeof import('./state/sync');
  reminders: typeof import('./state/reminders');
  platform: typeof import('./platform');
  i18n: typeof import('./lib/i18n');
  InstanceBlocked: typeof import('./components/Overlays').InstanceBlocked;
};

let mods: Modules;
// Booting is a one-time side effect (StrictMode mounts effects twice in development).
let booting: Promise<void> | null = null;

function Root() {
  const { App, rep, actions, sync, i18n, InstanceBlocked, reminders, platform } = mods;
  const [replica, setReplica] = useState<Replica | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [locale, setLocaleState] = useState(i18n.getLocale());

  const start = async (steal: boolean) => {
    const ok = await rep.acquireInstanceLock(() => {
      setBlocked(true);
      setReplica(null);
    }, steal);
    if (!ok) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    const r = await rep.loadReplica();
    actions.bindActions(r);
    await platform.initPlatform(r);
    reminders.startReminders(r);
    await sync.initSync(r);
    setReplica(r);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: boot once
  useEffect(() => {
    if (!booting) booting = start(false);
  }, []);

  if (blocked) return <InstanceBlocked onTakeOver={() => void start(true)} />;
  if (!replica) return <div className="h-full bg-bg" />;
  return (
    <rep.ReplicaContext.Provider value={replica}>
      <App
        key={locale}
        onLocale={(l) => {
          localStorage.setItem('docket.locale', l);
          i18n.setLocale(l);
          setLocaleState(l);
        }}
      />
    </rep.ReplicaContext.Provider>
  );
}

async function boot() {
  if (!(globalThis as { Temporal?: unknown }).Temporal) await import('temporal-polyfill/global');
  const i18n = await import('./lib/i18n');
  const saved = localStorage.getItem('docket.locale');
  i18n.setLocale(saved === 'zh' || saved === 'en' ? saved : i18n.detectLocale());

  // The desktop quick-entry window is just an input; it hands the text to the main window.
  if (location.hash.startsWith('#/quick-entry')) {
    const [{ QuickEntry }] = await Promise.all([
      import('./components/QuickEntry'),
      import('./components/theme'),
    ]);
    createRoot(document.getElementById('root') as HTMLElement).render(<QuickEntry />);
    return;
  }

  const [{ App }, rep, actions, sync, overlays, reminders, platform] = await Promise.all([
    import('./App'),
    import('./state/replica'),
    import('./state/actions'),
    import('./state/sync'),
    import('./components/Overlays'),
    import('./state/reminders'),
    import('./platform'),
    import('./components/theme'),
  ]);
  mods = { App, rep, actions, sync, i18n, InstanceBlocked: overlays.InstanceBlocked, reminders, platform };

  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}

void boot();

// Offline app shell for the PWA (not inside the desktop/mobile shells, which bundle the app).
const inShell = '__TAURI_INTERNALS__' in window;
if (import.meta.env.PROD && 'serviceWorker' in navigator && !inShell && location.protocol === 'https:') {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
