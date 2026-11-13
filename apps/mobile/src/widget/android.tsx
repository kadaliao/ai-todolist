import { getLocale } from '@ai-todo/shared';
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import { completeFromElsewhere, getReplica, hasReplica } from '../state/actions';
import { readJson, removeFile, writeJson } from '../state/storage';
import { buildWidgetSnapshot, type WidgetSnapshot } from './model';
import { TodayWidget } from './TodayWidget';

/**
 * Android widget plumbing. Like on iOS, the app publishes a snapshot and the widget never edits
 * task data while the app is closed: a check-off is queued in `widget-done.json` and applied when
 * the app next becomes active. If the app is running, the check-off is applied right away.
 */

export const WIDGET_NAME = 'DocketToday';
const SNAPSHOT = 'widget.json';
const DONE = 'widget-done.json';

export function readDone(): string[] {
  return readJson<string[]>(DONE) ?? [];
}

/** Ids checked off in the widget since the app last ran; clears the queue. */
export function takeDone(): string[] {
  const ids = readDone();
  removeFile(DONE);
  return ids;
}

function render(snapshot: WidgetSnapshot | null, done: string[]) {
  const now = new Date();
  return {
    light: <TodayWidget snapshot={snapshot} done={done} now={now} dark={false} />,
    dark: <TodayWidget snapshot={snapshot} done={done} now={now} dark />,
  };
}

export async function publishAndroidWidget(snapshot: WidgetSnapshot): Promise<void> {
  writeJson(SNAPSHOT, snapshot);
  await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => render(snapshot, readDone()) });
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetAction === 'WIDGET_DELETED') return;
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'TOGGLE') {
    const id = props.clickActionData?.id;
    if (typeof id === 'string') {
      if (hasReplica()) {
        // The app is running: complete it now; the app republishes the snapshot.
        completeFromElsewhere([id]);
        const fresh = buildWidgetSnapshot(getReplica(), getLocale());
        writeJson(SNAPSHOT, fresh);
        props.renderWidget(render(fresh, []));
        return;
      }
      const done = readDone();
      const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
      if (next.length) writeJson(DONE, next);
      else removeFile(DONE);
    }
  }
  props.renderWidget(render(readJson<WidgetSnapshot>(SNAPSHOT) ?? null, readDone()));
}
