import { type NewTask, parseQuickAdd, type Replica, sortByOrder } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { timeZone } from './replica';
import { useSync } from './sync';

/**
 * AI through docket-server. React Native's fetch can't stream bodies, so NDJSON is read
 * progressively with XMLHttpRequest; each finished line becomes a draft immediately.
 */

export interface ExtractedTask {
  title: string;
  when?: string;
  project?: string;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
  notes?: string;
}

function endpoint() {
  const cfg = useSync.getState().config;
  if (!cfg) throw new Error(t('settings.ai.status.off'));
  return cfg;
}

function context(replica: Replica) {
  const s = replica.store;
  return {
    today: replica.context().today,
    timeZone: timeZone(),
    projects: sortByOrder(s.all('project').filter((p) => !p.deletedAt && !p.archivedAt)).map((p) => p.name),
    labels: sortByOrder(s.all('label').filter((l) => !l.deletedAt)).map((l) => l.name),
  };
}

/** POST and call `onItem` for each NDJSON item as it arrives. Returns an abort function. */
function stream<T>(
  path: string,
  body: unknown,
  onItem: (item: T) => void,
  onDone: (error?: string) => void,
): () => void {
  let cfg: { url: string; token: string };
  try {
    cfg = endpoint();
  } catch (e) {
    onDone((e as Error).message);
    return () => {};
  }
  const xhr = new XMLHttpRequest();
  let seen = 0;
  let finished = false;
  const finish = (err?: string) => {
    if (finished) return;
    finished = true;
    onDone(err);
  };
  const consume = () => {
    const text = xhr.responseText;
    let nl = text.indexOf('\n', seen);
    while (nl >= 0) {
      const line = text.slice(seen, nl).trim();
      seen = nl + 1;
      if (line) {
        try {
          const msg = JSON.parse(line) as { type: string; data?: T; error?: string };
          if (msg.type === 'item' && msg.data) onItem(msg.data);
          if (msg.type === 'error') finish(msg.error ?? 'AI error');
        } catch {
          /* partial line */
        }
      }
      nl = text.indexOf('\n', seen);
    }
  };
  xhr.open('POST', `${cfg.url}${path}`);
  xhr.setRequestHeader('Authorization', `Bearer ${cfg.token}`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onprogress = consume;
  xhr.onload = () => {
    if (xhr.status >= 400) {
      let msg = `HTTP ${xhr.status}`;
      try {
        msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
      } catch {
        /* not json */
      }
      finish(msg);
      return;
    }
    consume();
    finish();
  };
  xhr.onerror = () => finish(t('settings.sync.status.offline'));
  xhr.send(JSON.stringify(body));
  return () => {
    finished = true;
    xhr.abort();
  };
}

export function extractTasks(
  replica: Replica,
  text: string,
  onItem: (t: ExtractedTask) => void,
  onDone: (e?: string) => void,
) {
  return stream<ExtractedTask>('/api/ai/extract', { text, context: context(replica) }, onItem, onDone);
}

export function breakdownTask(
  replica: Replica,
  task: { title: string; notes: string; existing: string[] },
  onItem: (t: { title: string }) => void,
  onDone: (e?: string) => void,
) {
  return stream<{ title: string }>(
    '/api/ai/breakdown',
    { ...task, context: context(replica) },
    onItem,
    onDone,
  );
}

export function draftToTask(replica: Replica, d: ExtractedTask): NewTask {
  const s = replica.store;
  const parsed = d.when ? parseQuickAdd(d.when, { now: new Date(), timeZone: timeZone() }) : null;
  const project = d.project
    ? s.all('project').find((p) => !p.deletedAt && p.name.toLowerCase() === d.project?.toLowerCase())
    : undefined;
  const labels = (d.labels ?? [])
    .map((n) => s.all('label').find((l) => !l.deletedAt && l.name.toLowerCase() === n.toLowerCase())?.id)
    .filter((x): x is string => !!x);
  return {
    title: d.title,
    ...(d.notes ? { notes: d.notes } : {}),
    projectId: project?.id ?? null,
    ...(labels.length ? { labels } : {}),
    ...(d.priority ? { priority: (4 - d.priority) as 0 | 1 | 2 | 3 } : {}),
    ...(parsed?.scheduled ? { scheduled: parsed.scheduled } : {}),
    ...(parsed?.recurrence ? { recurrence: parsed.recurrence } : {}),
  };
}
