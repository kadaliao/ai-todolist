import type { Replica } from '@ai-todo/core';
import { getLocale, t } from '@ai-todo/shared';
import { ExtensionStorage } from '@bacons/apple-targets';
import { AppState, Platform } from 'react-native';
import { publishAndroidWidget, takeDone } from '../widget/android';
import { buildWidgetSnapshot } from '../widget/model';
import { addFromText, addTask, completeFromElsewhere, toast } from './actions';

/**
 * Bridge to the home-screen widgets and the iOS share extension. The app is the only writer of
 * task data:
 * - it publishes a small snapshot of overdue, today's and the next few days' tasks;
 * - check-offs made in a widget while the app was closed are queued (iOS: `widget.done` in the App
 *   Group; Android: `widget-done.json`), and the iOS share extension queues items in
 *   `share.inbox`; the app applies both, and clears them, whenever it becomes active.
 */

const GROUP = 'group.com.kadaliao.docket';
const WIDGET_KIND = 'DocketToday';
const appGroup = Platform.OS === 'ios' ? new ExtensionStorage(GROUP) : null;

interface SharedItem {
  text: string;
  url: string | null;
}

function take<T>(key: string): T | null {
  if (!appGroup) return null;
  const raw = appGroup.get(key);
  if (!raw) return null;
  appGroup.remove(key);
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function startWidgetBridge(r: Replica): () => void {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return () => {};
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const publish = () => {
    clearTimeout(timer);
    const snapshot = buildWidgetSnapshot(r, getLocale());
    const json = JSON.stringify(snapshot);
    if (json === last) return;
    last = json;
    if (appGroup) {
      appGroup.set('widget', json);
      ExtensionStorage.reloadWidget(WIDGET_KIND);
    } else {
      void publishAndroidWidget(snapshot);
    }
  };

  const ingest = () => {
    const done = appGroup ? take<string[]>('widget.done') : takeDone();
    if (done?.length) {
      completeFromElsewhere(done);
      last = ''; // the queue is gone, so the widget must redraw without the checked rows
    }
    // Publish right away so checked-off rows don't flash back before the debounce fires.
    publish();

    const shared = take<SharedItem[]>('share.inbox');
    if (!shared?.length) return;
    let added = 0;
    for (const item of shared) {
      const text = item.text?.trim() ?? '';
      const notes = item.url && item.url !== text ? { notes: item.url } : {};
      // A bare link is kept verbatim (a "#fragment" is not a project); text is read like Quick Add.
      const id =
        !text || text === item.url
          ? item.url
            ? addTask({ title: item.url })
            : undefined
          : addFromText(text, notes);
      if (id) added++;
    }
    if (added)
      toast(added === 1 ? t('toast.created', { name: t('nav.inbox') }) : t('toast.addedN', { n: added }));
  };

  ingest();
  const unsub = r.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(publish, 500);
  });
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') ingest();
    else if (state === 'background') publish();
  });
  return () => {
    clearTimeout(timer);
    unsub();
    sub.remove();
  };
}
