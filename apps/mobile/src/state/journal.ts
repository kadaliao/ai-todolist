import { AUDIO_LIMIT, Journal, summarize, type VoiceRecord } from '@ai-todo/core';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';
import { create } from 'zustand';
import { getSetting, setSetting } from './storage';

/**
 * The voice journal on the phone (see core's `Journal`): `Documents/voice/journal.json` plus the
 * recordings next to it. Only on this device; export shares a JSON file you choose where to send.
 */

const folder = () => new Directory(Paths.document, 'voice');
const index = () => new File(folder(), 'journal.json');

export function journalEnabled(): boolean {
  return getSetting<boolean>('voice.journal') ?? true;
}

interface JournalState {
  enabled: boolean;
  records: VoiceRecord[];
}

export const useJournal = create<JournalState>(() => ({ enabled: journalEnabled(), records: [] }));

export function setJournalEnabled(enabled: boolean): void {
  setSetting('voice.journal', enabled);
  useJournal.setState({ enabled });
}

let journal: Journal | null = null;
let writing: Promise<void> = Promise.resolve();

function load(): VoiceRecord[] {
  try {
    const f = index();
    return f.exists ? (JSON.parse(f.textSync()) as VoiceRecord[]) : [];
  } catch (e) {
    console.warn('voice journal unreadable', e);
    return [];
  }
}

function persist(records: VoiceRecord[]): void {
  const json = JSON.stringify(records);
  writing = writing
    .then(() => {
      const dir = folder();
      if (!dir.exists) dir.create({ intermediates: true });
      return index().write(json);
    })
    .catch((e) => console.warn('voice journal not saved', e));
}

/** Recordings are kept for the newest {@link AUDIO_LIMIT} records only. */
function trimAudio(records: VoiceRecord[]): void {
  let kept = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const cap = records[i]?.capture;
    if (!cap?.audio) continue;
    if (++kept > AUDIO_LIMIT) {
      deleteAudio(cap.audio);
      delete cap.audio;
    }
  }
}

export function getJournal(): Journal {
  if (journal) return journal;
  const j = new Journal(load(), (records, dropped) => {
    for (const r of dropped) deleteAudio(r.capture?.audio);
    trimAudio(records);
    persist(records);
    useJournal.setState({ records: [...records] });
  });
  journal = j;
  useJournal.setState({ records: [...j.list()] });
  return j;
}

/** Move a finished recording into the journal folder; returns its name there. */
export function keepAudio(uri: string): string | undefined {
  try {
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true });
    const name = `${Date.now()}.wav`;
    new File(uri).moveSync(new File(dir, name));
    return name;
  } catch (e) {
    console.warn('recording not kept', e);
    return undefined;
  }
}

export function deleteAudio(name: string | undefined): void {
  if (!name) return;
  try {
    const f = new File(folder(), name);
    if (f.exists) f.delete();
  } catch {
    /* already gone */
  }
}

export function audioFile(name: string): File | null {
  const f = new File(folder(), name);
  return f.exists ? f : null;
}

/** Forget everything, recordings included. */
export function clearJournal(): void {
  getJournal().clear();
  try {
    const dir = folder();
    if (dir.exists) dir.delete();
  } catch (e) {
    console.warn('voice folder not removed', e);
  }
}

/** Share the records (not the audio) as a JSON file, for building the evaluation set. */
export async function exportJournal(): Promise<void> {
  const records = getJournal().list();
  const payload = {
    app: 'Docket',
    version: Constants.expoConfig?.version ?? null,
    platform: `${Platform.OS} ${Platform.Version}`,
    exportedAt: new Date().toISOString(),
    summary: summarize(records),
    records,
  };
  const json = JSON.stringify(payload, null, 2);
  if (Platform.OS === 'ios') {
    const f = new File(Paths.cache, `docket-voice-${new Date().toISOString().slice(0, 10)}.json`);
    if (f.exists) f.delete();
    f.create();
    f.writeSync(json);
    await Share.share({ url: f.uri });
  } else {
    await Share.share({ message: json });
  }
}
