import { type DueReminder, dueReminders, type Replica } from '@ai-todo/core';
import { formatTime, getLocale } from '@ai-todo/shared';
import { create } from 'zustand';
import { timeZone } from './replica';
import { useUI } from './ui';

/**
 * Reminders while the app is running (web tab, desktop app). One timer is armed for the next
 * reminder and re-planned whenever data changes. Each reminder fires once (remembered across
 * restarts); reminders missed by less than 15 minutes still fire when the app comes back.
 *
 * Tasks with a time but no explicit reminder notify at that time unless the user turned the
 * default off. The phone app schedules OS-level notifications instead (works while closed).
 */

export interface Notifier {
  permission(): Promise<'granted' | 'denied' | 'default'>;
  request(): Promise<boolean>;
  show(title: string, body: string, onClick: () => void): void;
}

const webNotifier: Notifier = {
  async permission() {
    return 'Notification' in window ? Notification.permission : 'denied';
  },
  async request() {
    if (!('Notification' in window)) return false;
    return (await Notification.requestPermission()) === 'granted';
  },
  show(title, body, onClick) {
    const n = new Notification(title, { body, icon: '/icon-192.png', tag: title });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  },
};

let notifier: Notifier = webNotifier;
export function setNotifier(n: Notifier): void {
  notifier = n;
}

interface ReminderSettings {
  enabled: boolean;
  /** Notify at the task's time when it has no explicit reminder. */
  atTimeByDefault: boolean;
  permission: 'granted' | 'denied' | 'default';
}

export const useReminderSettings = create<ReminderSettings>(() => ({
  enabled: localStorage.getItem('docket.reminders') !== 'off',
  atTimeByDefault: localStorage.getItem('docket.reminders.default') !== 'off',
  permission: 'default',
}));

export function setReminderSettings(
  patch: Partial<Pick<ReminderSettings, 'enabled' | 'atTimeByDefault'>>,
): void {
  useReminderSettings.setState(patch);
  if (patch.enabled !== undefined) localStorage.setItem('docket.reminders', patch.enabled ? 'on' : 'off');
  if (patch.atTimeByDefault !== undefined)
    localStorage.setItem('docket.reminders.default', patch.atTimeByDefault ? 'on' : 'off');
  replan?.();
}

export async function requestNotificationPermission(): Promise<boolean> {
  const ok = await notifier.request();
  useReminderSettings.setState({ permission: ok ? 'granted' : await notifier.permission() });
  return ok;
}

type Due = DueReminder;

export { dueReminders };

const FIRED_KEY = 'docket.reminders.fired';
const GRACE_MS = 15 * 60_000;

function loadFired(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

let replan: (() => void) | null = null;

export function startReminders(replica: Replica): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fired = loadFired();
  // Forget old entries so storage stays small.
  for (const [k, at] of Object.entries(fired)) if (at < Date.now() - 7 * 86_400_000) delete fired[k];

  const fire = (d: Due) => {
    fired[d.key] = d.at;
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
    const zh = getLocale() === 'zh';
    const time = d.task.scheduled?.time ? formatTime(d.task.scheduled.time) : '';
    const body = d.minutesBefore
      ? zh
        ? `${d.minutesBefore >= 1440 ? `${d.minutesBefore / 1440} 天后` : `${d.minutesBefore} 分钟后`} · ${time}`
        : `In ${d.minutesBefore >= 1440 ? `${d.minutesBefore / 1440} day` : `${d.minutesBefore} min`} · ${time}`
      : zh
        ? `现在 · ${time}`
        : `Now · ${time}`;
    try {
      notifier.show(d.task.title, body, () => useUI.getState().openDetail(d.task.id));
    } catch (e) {
      console.warn('notification failed', e);
    }
  };

  const plan = () => {
    clearTimeout(timer);
    const s = useReminderSettings.getState();
    if (!s.enabled || s.permission !== 'granted') return;
    const now = Date.now();
    const due = dueReminders(replica.store.all('task'), timeZone(), s.atTimeByDefault).filter(
      (d) => !fired[d.key],
    );
    for (const d of due) if (d.at <= now && d.at > now - GRACE_MS) fire(d);
    const next = due.find((d) => d.at > now);
    if (!next) return;
    // Re-check at least hourly (sleep/wake, time zone changes).
    timer = setTimeout(plan, Math.min(next.at - now, 3_600_000) + 50);
  };

  replan = plan;
  void notifier.permission().then((permission) => {
    useReminderSettings.setState({ permission });
    plan();
  });
  const unsub = replica.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(plan, 300);
  });
  const onVisible = () => document.visibilityState === 'visible' && plan();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearTimeout(timer);
    unsub();
    document.removeEventListener('visibilitychange', onVisible);
    replan = null;
  };
}
