import {
  type AgentRequest,
  type AgentTransport,
  Assistant,
  type AssistantState,
  type ModelEvent,
  type Replica,
} from '@ai-todo/core';
import { getLocale, t } from '@ai-todo/shared';
import * as Haptics from 'expo-haptics';
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { getReplica, toast } from './actions';
import { useSync } from './sync';

/**
 * The voice assistant on the phone. The model runs on the sync server (`/api/agent`); its tool
 * calls run here on the local replica (core's `Assistant`), so it sees exactly what's on screen.
 *
 * React Native's fetch can't stream a response body, so the NDJSON reply is read progressively
 * with XMLHttpRequest and handed to the assistant as an async iterable.
 */

/** Callback-driven producer → async iterable, for XHR progress events. */
function channel<T>() {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  let failure: Error | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  return {
    push(item: T) {
      if (done) return;
      queue.push(item);
      notify();
    },
    end(error?: Error) {
      if (done) return;
      done = true;
      failure = error ?? null;
      notify();
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      for (;;) {
        while (queue.length) yield queue.shift() as T;
        if (done) {
          if (failure) throw failure;
          return;
        }
        await new Promise<void>((r) => {
          wake = r;
        });
      }
    },
  };
}

export const agentTransport: AgentTransport = (req: AgentRequest, signal: AbortSignal) => {
  const ch = channel<ModelEvent>();
  const cfg = useSync.getState().config;
  if (!cfg) {
    ch.end(new Error(t('agent.unavailable')));
    return ch;
  }
  const xhr = new XMLHttpRequest();
  let seen = 0;
  const consume = () => {
    const text = xhr.responseText;
    let nl = text.indexOf('\n', seen);
    while (nl >= 0) {
      const line = text.slice(seen, nl).trim();
      seen = nl + 1;
      if (line) {
        try {
          const msg = JSON.parse(line) as { type: string; data?: ModelEvent; error?: string };
          if (msg.type === 'item' && msg.data) ch.push(msg.data);
          else if (msg.type === 'error') ch.push({ type: 'error', error: msg.error ?? 'AI error' });
        } catch {
          /* partial line */
        }
      }
      nl = text.indexOf('\n', seen);
    }
  };
  xhr.open('POST', `${cfg.url}/api/agent`);
  xhr.setRequestHeader('Authorization', `Bearer ${cfg.token}`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onprogress = () => {
    if (xhr.status < 400) consume();
  };
  xhr.onload = () => {
    if (xhr.status >= 400) {
      let msg = xhr.status === 404 ? t('agent.unavailable') : `HTTP ${xhr.status}`;
      try {
        msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
      } catch {
        /* not json */
      }
      ch.end(new Error(msg));
      return;
    }
    consume();
    ch.end();
  };
  xhr.onerror = () => ch.end(new Error(t('settings.sync.status.offline')));
  const onAbort = () => {
    xhr.abort();
    ch.end();
  };
  if (signal.aborted) onAbort();
  else {
    signal.addEventListener('abort', onAbort);
    xhr.send(JSON.stringify(req));
  }
  return ch;
};

// --- what's on screen ------------------------------------------------------------------------

/** The task detail sheet sets this so "这个 / this" means the task you're looking at. */
export const useAssistantFocus = create<{ taskId: string | null; sheetOpen: boolean }>(() => ({
  taskId: null,
  sheetOpen: false,
}));

export function setAssistantFocus(taskId: string | null): void {
  useAssistantFocus.setState({ taskId });
}

// --- the singleton ---------------------------------------------------------------------------

let assistant: Assistant | null = null;
let boundTo: Replica | null = null;
let stopWatching: (() => void) | null = null;

/** The assistant for the current replica (recreated when the app adopts an account's data). */
export function getAssistant(): Assistant {
  const replica = getReplica();
  if (assistant && boundTo === replica) return assistant;
  stopWatching?.();
  assistant?.forget();
  boundTo = replica;
  const a = new Assistant({
    replica,
    transport: agentTransport,
    locale: () => (getLocale() === 'zh' ? 'zh-CN' : 'en-US'),
    focus: () => ({ taskId: useAssistantFocus.getState().taskId }),
  });
  assistant = a;
  stopWatching = watchOutcomes(a);
  return a;
}

/** Haptics when a turn lands; an undo toast when it lands while the sheet is closed. */
function watchOutcomes(a: Assistant): () => void {
  const seen = new Map<number, string>();
  return a.subscribe((s) => {
    for (const turn of s.turns) {
      const prev = seen.get(turn.id);
      if (prev === turn.status) continue;
      seen.set(turn.id, turn.status);
      if (turn.status === 'applied' && prev !== 'applied') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (!useAssistantFocus.getState().sheetOpen) {
          const id = turn.id;
          toast(turn.reply || t('agent.toast.applied', { n: turn.changes.length }), {
            label: t('undo'),
            run: () => a.undo(id),
          });
        }
      } else if (turn.status === 'pending' && prev !== 'pending') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else if (turn.status === 'error' && prev !== 'error') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
  });
}

const EMPTY: AssistantState = { turns: [], busy: false };

export function useAssistant(): AssistantState {
  return useSyncExternalStore(
    (cb) => getAssistant().subscribe(cb),
    () => (boundTo === getReplica() && assistant ? assistant.getState() : EMPTY),
  );
}

/** Whether the connected server can run the assistant (unknown until its health arrives). */
export function useAssistantAvailable(): boolean {
  return useSync((s) => !!s.config && (s.ai === null || (s.ai.available && s.ai.agent === true)));
}

export function speak(text: string): void {
  void getAssistant().say(text);
}
