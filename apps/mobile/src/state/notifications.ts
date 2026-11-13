import { dueReminders, type Replica } from '@ai-todo/core';
import { formatTime, getLocale } from '@ai-todo/shared';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { timeZone } from './replica';
import { getSetting, setSetting } from './storage';

/**
 * Reminders as OS notifications, so they fire while the app is closed. Whenever data changes the
 * next reminders are re-planned (iOS keeps at most 64 pending; we schedule the next 40 within
 * two weeks). Tapping a notification opens the task.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

interface NotifyState {
  permission: 'granted' | 'denied' | 'undetermined';
  enabled: boolean;
  atTimeByDefault: boolean;
}

export const useNotify = create<NotifyState>(() => ({
  permission: 'undetermined',
  enabled: getSetting<boolean>('reminders.enabled') ?? true,
  atTimeByDefault: getSetting<boolean>('reminders.atTime') ?? true,
}));

let replan: (() => void) | null = null;

export function setNotifySettings(patch: Partial<Pick<NotifyState, 'enabled' | 'atTimeByDefault'>>): void {
  useNotify.setState(patch);
  if (patch.enabled !== undefined) setSetting('reminders.enabled', patch.enabled);
  if (patch.atTimeByDefault !== undefined) setSetting('reminders.atTime', patch.atTimeByDefault);
  replan?.();
}

export async function requestPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: getLocale() === 'zh' ? '提醒' : 'Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#1F8F6A',
    });
  }
  const res = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  const granted = res.granted || res.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  useNotify.setState({ permission: granted ? 'granted' : 'denied' });
  replan?.();
  return granted;
}

export function startNotifications(replica: Replica): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPlan = '';

  const plan = async () => {
    const s = useNotify.getState();
    if (s.permission !== 'granted' || !s.enabled) {
      if (lastPlan) await Notifications.cancelAllScheduledNotificationsAsync();
      lastPlan = '';
      return;
    }
    const now = Date.now();
    const horizon = now + 14 * 86_400_000;
    const due = dueReminders(replica.store.all('task'), timeZone(), s.atTimeByDefault)
      .filter((d) => d.at > now + 5_000 && d.at < horizon)
      .slice(0, 40);
    const signature = due.map((d) => `${d.key}:${d.task.title}`).join('|');
    if (signature === lastPlan) return;
    lastPlan = signature;
    await Notifications.cancelAllScheduledNotificationsAsync();
    const zh = getLocale() === 'zh';
    for (const d of due) {
      const time = d.task.scheduled?.time ? formatTime(d.task.scheduled.time) : '';
      const body = d.minutesBefore
        ? zh
          ? `${d.minutesBefore >= 1440 ? `${d.minutesBefore / 1440} 天后` : `${d.minutesBefore} 分钟后`} · ${time}`
          : `In ${d.minutesBefore >= 1440 ? `${d.minutesBefore / 1440} day` : `${d.minutesBefore} min`} · ${time}`
        : time;
      await Notifications.scheduleNotificationAsync({
        content: { title: d.task.title, body, data: { taskId: d.task.id }, sound: 'default' },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(d.at),
          ...(Platform.OS === 'android' ? { channelId: 'reminders' } : {}),
        },
      });
    }
  };

  replan = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void plan(), 600);
  };
  void Notifications.getPermissionsAsync().then((p) => {
    useNotify.setState({ permission: p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied' });
    replan?.();
  });
  const unsub = replica.subscribe(() => replan?.());

  const open = (taskId: unknown) => {
    if (typeof taskId === 'string') router.push({ pathname: '/task/[id]', params: { id: taskId } });
  };
  const sub = Notifications.addNotificationResponseReceivedListener((r) =>
    open(r.notification.request.content.data?.taskId),
  );
  const last = Notifications.getLastNotificationResponse();
  if (last) setTimeout(() => open(last.notification.request.content.data?.taskId), 500);

  return () => {
    clearTimeout(timer);
    unsub();
    sub.remove();
    replan = null;
  };
}
