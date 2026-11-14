import {
  type AgentTransport,
  Assistant,
  type AssistantState,
  type ModelEvent,
  type VoiceCapture,
} from '@ai-todo/core';
import { getLocale, t } from '@ai-todo/shared';
import { useSyncExternalStore } from 'react';
import { getReplica } from './actions';
import { ndjson } from './ai';
import { getJournal, journalEnabled } from './journal';
import { type Route, useUI } from './ui';
import { voiceWords } from './voice';

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
      words: voiceWords,
    });
    instance.subscribe((s) => {
      if (journalEnabled()) getJournal().observe(s.turns);
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

/** Hand an utterance to the assistant; `capture` says how it was spoken (for the voice journal). */
export function speak(text: string, capture?: VoiceCapture): Promise<void> {
  const journal = journalEnabled() ? getJournal() : null;
  if (journal && capture) journal.willSay(capture);
  return getAssistant()
    .say(text)
    .finally(() => journal?.unused());
}

/** The user's vocabulary, project and label names, to help speech recognition. */
export function vocabulary(): string[] {
  const s = getReplica().store;
  return [
    ...voiceWords(),
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
