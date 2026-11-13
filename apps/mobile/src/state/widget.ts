import { addDays, type Replica, type Task, today as todayView, upcoming } from '@ai-todo/core';
import { getLocale, t } from '@ai-todo/shared';
import { ExtensionStorage } from '@bacons/apple-targets';
import { AppState, Platform } from 'react-native';
import { addFromText, addTask, completeFromElsewhere, toast } from './actions';

/**
 * Bridge to the iOS widget and share extension through the App Group (targets/widget,
 * targets/share). The app is the only writer of task data:
 * - it publishes a small snapshot of overdue, today's and the next few days' tasks for the widget;
 * - the widget records check-offs in `widget.done`, and the share extension queues items in
 *   `share.inbox`; the app applies both (and clears them) whenever it becomes active.
 */

const GROUP = 'group.app.docket.mobile';
const WIDGET_KIND = 'DocketToday';
const storage = Platform.OS === 'ios' ? new ExtensionStorage(GROUP) : null;

interface SharedItem {
  text: string;
  url: string | null;
}

function take<T>(key: string): T | null {
  if (!storage) return null;
  const raw = storage.get(key);
  if (!raw) return null;
  storage.remove(key);
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Serialized widget snapshot; exported for tests. */
export function widgetSnapshot(r: Replica, locale: string): string {
  const day = r.context().today;
  const { overdue, today } = todayView(r.store, day);
  const soon = upcoming(r.store, addDays(day, 1), 3).flatMap((b) => b.tasks);
  const projects = new Map(r.store.all('project').map((p) => [p.id, p]));
  const row = (task: Task) => {
    const project = task.projectId ? projects.get(task.projectId) : undefined;
    return {
      id: task.id,
      title: task.title,
      date: task.scheduled?.date ?? day,
      time: task.scheduled?.time ?? null,
      priority: task.priority,
      project: project?.name ?? null,
      color: project?.color ?? null,
    };
  };
  return JSON.stringify({ locale, tasks: [...overdue, ...today, ...soon].slice(0, 60).map(row) });
}

export function startWidgetBridge(r: Replica): () => void {
  if (!storage) return () => {};
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const publish = () => {
    clearTimeout(timer);
    const next = widgetSnapshot(r, getLocale());
    if (next === last) return;
    last = next;
    storage.set('widget', next);
    ExtensionStorage.reloadWidget(WIDGET_KIND);
  };

  const ingest = () => {
    const done = take<string[]>('widget.done');
    if (done?.length) completeFromElsewhere(done);
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
