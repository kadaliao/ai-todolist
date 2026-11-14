import { type AgentTransport, Assistant, type AssistantState, type ModelEvent } from '@ai-todo/core';
import { getLocale, t } from '@ai-todo/shared';
import { useSyncExternalStore } from 'react';
import { getReplica } from './actions';
import { ndjson } from './ai';
import { type Route, useUI } from './ui';

/**
 * The voice assistant on web/desktop: the shared core `Assistant` running on this device's
 * replica, with the model reached through the sync server (`/api/agent`).
 */

const transport: AgentTransport = (req, signal) => ndjson<ModelEvent>('/api/agent', req, signal);

function describeRoute(route: Route): string | undefined {
  const s = getReplica().store;
  switch (route.kind) {
    case 'project':
      return `project “${s.get('project', route.id)?.name ?? ''}”`;
    case 'label':
      return `label “${s.get('label', route.id)?.name ?? ''}”`;
    case 'search':
      return `search “${route.q}”`;
    default:
      return route.kind;
  }
}

let instance: Assistant | null = null;
let bound: unknown = null;

export function getAssistant(): Assistant {
  const replica = getReplica();
  if (!instance || bound !== replica) {
    instance?.forget();
    bound = replica;
    instance = new Assistant({
      replica,
      transport,
      locale: () => (getLocale() === 'zh' ? 'zh-CN' : 'en-US'),
      focus: () => {
        const ui = useUI.getState();
        const view = describeRoute(ui.route);
        return { taskId: ui.detailId ?? ui.focusId, ...(view ? { view } : {}) };
      },
    });
    let lastApplied = 0;
    instance.subscribe((s) => {
      // Applied while the panel is closed (e.g. push-to-talk then closed): offer Undo in a toast.
      const turn = s.turns.at(-1);
      if (turn?.status === 'applied' && turn.id !== lastApplied) {
        lastApplied = turn.id;
        if (!useUI.getState().assistantOpen) {
          useUI.getState().toast({
            message: turn.reply || t('agent.toast.applied', { n: turn.changes.length }),
            action: { label: t('undo'), run: () => instance?.undo(turn.id) },
          });
        }
      }
    });
  }
  return instance;
}

const EMPTY: AssistantState = { turns: [], busy: false };

export function useAssistant(): AssistantState {
  return useSyncExternalStore(
    (fn) => getAssistant().subscribe(fn),
    () => (getReplica() ? getAssistant().getState() : EMPTY),
  );
}

/** Project and label names, to help speech recognition with the user's own words. */
export function vocabulary(): string[] {
  const s = getReplica().store;
  return [
    ...s
      .all('project')
      .filter((p) => !p.deletedAt && !p.archivedAt)
      .map((p) => p.name),
    ...s
      .all('label')
      .filter((l) => !l.deletedAt)
      .map((l) => l.name),
  ];
}
