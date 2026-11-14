import { Journal, summarize, type VoiceRecord } from '@ai-todo/core';
import { create } from 'zustand';

/**
 * The voice journal on web/desktop (see core's `Journal`): text and timings in localStorage, no
 * recordings. Only in this browser; export downloads a JSON file.
 */

const KEY = 'docket.voiceJournal';
const ON = 'docket.voiceJournal.on';

export function journalEnabled(): boolean {
  return localStorage.getItem(ON) !== '0';
}

export const useJournal = create<{ enabled: boolean; records: VoiceRecord[] }>(() => ({
  enabled: journalEnabled(),
  records: [],
}));

export function setJournalEnabled(enabled: boolean): void {
  localStorage.setItem(ON, enabled ? '1' : '0');
  useJournal.setState({ enabled });
}

let journal: Journal | null = null;

export function getJournal(): Journal {
  if (journal) return journal;
  let initial: VoiceRecord[] = [];
  try {
    initial = JSON.parse(localStorage.getItem(KEY) ?? '[]') as VoiceRecord[];
  } catch {
    initial = [];
  }
  const j = new Journal(initial, (records) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(records));
    } catch (e) {
      console.warn('voice journal not saved', e);
    }
    useJournal.setState({ records: [...records] });
  });
  journal = j;
  useJournal.setState({ records: [...j.list()] });
  return j;
}

export function clearJournal(): void {
  getJournal().clear();
}

export function exportJournal(): void {
  const records = getJournal().list();
  const payload = {
    app: 'Docket',
    platform: navigator.userAgent,
    exportedAt: new Date().toISOString(),
    summary: summarize(records),
    records,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `docket-voice-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
