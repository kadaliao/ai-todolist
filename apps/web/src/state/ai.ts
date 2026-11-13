import { type NewTask, parseQuickAdd, type Replica, sortByOrder } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { timeZone } from './replica';
import { useSyncStore } from './sync';

/**
 * AI calls go through docket-server (it holds the model config and key). Responses stream as
 * NDJSON, one finished item per line, so drafts appear one by one.
 *
 * The model never computes dates: it returns the date *phrase* it found ("下周五下午3点") and the
 * local quick-add parser turns that into a date, the same way typed input is handled.
 */

export interface ExtractedTask {
  title: string;
  when?: string;
  project?: string;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
  notes?: string;
}

export class AiError extends Error {}

function endpoint(): { base: string; token: string } {
  const cfg = useSyncStore.getState().config;
  if (!cfg) throw new AiError(t('settings.ai.status.off'));
  return { base: cfg.url.replace(/\/+$/, ''), token: cfg.token };
}

export function aiReady(): boolean {
  const s = useSyncStore.getState();
  return !!s.config && s.ai?.available !== false;
}

async function* ndjson<T>(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
  const { base, token } = endpoint();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new AiError(msg);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += value;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        const msg = JSON.parse(line) as { type: string; data?: T; error?: string };
        if (msg.type === 'item' && msg.data) yield msg.data;
        if (msg.type === 'error') throw new AiError(msg.error ?? 'AI error');
      }
      nl = buf.indexOf('\n');
    }
    if (done) break;
  }
}

function context(replica: Replica) {
  const s = replica.store;
  return {
    today: replica.context().today,
    timeZone: timeZone(),
    locale: document.documentElement.lang,
    projects: sortByOrder(s.all('project').filter((p) => !p.deletedAt && !p.archivedAt)).map((p) => p.name),
    labels: sortByOrder(s.all('label').filter((l) => !l.deletedAt)).map((l) => l.name),
  };
}

export function extractTasks(
  replica: Replica,
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<ExtractedTask> {
  return ndjson<ExtractedTask>('/api/ai/extract', { text, context: context(replica) }, signal);
}

export function breakdownTask(
  replica: Replica,
  task: { title: string; notes: string; existing: string[] },
  signal?: AbortSignal,
): AsyncGenerator<{ title: string }> {
  return ndjson<{ title: string }>('/api/ai/breakdown', { ...task, context: context(replica) }, signal);
}

export async function transcribe(audio: Blob): Promise<string> {
  const { base, token } = endpoint();
  const res = await fetch(`${base}/api/ai/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': audio.type || 'audio/webm' },
    body: audio,
  });
  if (!res.ok) throw new AiError(`HTTP ${res.status}`);
  return ((await res.json()) as { text: string }).text;
}

/** Turn a model draft into `createTask` input using the deterministic parser for dates. */
export function draftToTask(replica: Replica, d: ExtractedTask): NewTask & { projectName?: string } {
  const s = replica.store;
  const projects = s.all('project').filter((p) => !p.deletedAt && !p.archivedAt);
  const labels = s.all('label').filter((l) => !l.deletedAt);
  const parsed = d.when ? parseQuickAdd(d.when, { now: new Date(), timeZone: timeZone() }) : null;
  const project = d.project
    ? projects.find((p) => p.name.toLowerCase() === d.project?.toLowerCase())
    : undefined;
  const labelIds = (d.labels ?? [])
    .map((n) => labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.id)
    .filter((x): x is string => !!x);
  return {
    title: d.title,
    ...(d.notes ? { notes: d.notes } : {}),
    projectId: project?.id ?? null,
    ...(labelIds.length ? { labels: labelIds } : {}),
    ...(d.priority ? { priority: (4 - d.priority) as 0 | 1 | 2 | 3 } : {}),
    ...(parsed?.scheduled ? { scheduled: parsed.scheduled } : {}),
    ...(parsed?.recurrence ? { recurrence: parsed.recurrence } : {}),
  };
}
