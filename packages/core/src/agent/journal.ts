import type { AssistantTurn, TurnStatus } from './assistant';
import type { Change } from './session';

/**
 * The voice journal: what you said to the assistant and what came of it, kept on the device.
 *
 * It is the raw material for a real-voice evaluation set (audio + what the recognizer heard +
 * what the assistant did, and whether you kept it) and for the round-1 numbers: how long from
 * finger-up to the change, and how often an assistant change gets undone. Nothing here leaves the
 * device unless you export it.
 */

/** How the words were captured, when they were spoken. */
export interface VoiceCapture {
  mode: 'system' | 'cloud';
  /** The platform recognizer's text (also the live preview in cloud mode). */
  system: string;
  /** The server's transcription, when cloud mode ran and it answered. */
  cloud?: string;
  /** Device-local file name of the recording, when it was kept. */
  audio?: string;
  /** Wall-clock ms: listening began, the finger lifted (or silence ended it), the text was ready. */
  startedAt: number;
  releasedAt: number;
  textAt: number;
  handsFree: boolean;
}

export interface VoiceRecord {
  /** The assistant turn's start time, as an id that's unique on one device. */
  id: string;
  at: string;
  input: 'voice' | 'typed';
  heard: string;
  capture?: Omit<VoiceCapture, 'startedAt' | 'releasedAt' | 'textAt'> & {
    /** How long the user spoke, and finger-up → text. */
    speechMs: number;
    transcribeMs: number;
  };
  status: TurnStatus;
  reply: string;
  tools: string[];
  changes: { kind: string; title: string }[];
  steps: number;
  /** From finger-up (typed: from send) to the first change on screen, and to the end of the turn. */
  firstChangeMs?: number;
  doneMs?: number;
  /** “好” / “算了” that settled a held proposal. */
  answer?: string;
  error?: string;
}

/** Records kept; audio is kept only for the newest {@link AUDIO_LIMIT}. */
export const JOURNAL_LIMIT = 500;
export const AUDIO_LIMIT = 200;

function changeTitle(c: Change): string {
  if (c.entity === 'task') return (c.after ?? c.before)?.title ?? '';
  return c.name;
}

/** The record for a settled turn (anything but `thinking`). */
export function journalRecord(turn: AssistantTurn, capture?: VoiceCapture): VoiceRecord {
  const from = capture ? capture.releasedAt : turn.startedAt;
  const since = (ms: number | undefined) =>
    ms === undefined ? undefined : Math.max(0, Math.round(turn.startedAt + ms - from));
  const firstChangeMs = since(turn.firstChangeMs);
  const doneMs = since(turn.doneMs);
  return {
    id: String(turn.startedAt),
    at: new Date(turn.startedAt).toISOString(),
    input: capture ? 'voice' : 'typed',
    heard: turn.heard,
    ...(capture
      ? {
          capture: {
            mode: capture.mode,
            system: capture.system,
            ...(capture.cloud !== undefined ? { cloud: capture.cloud } : {}),
            ...(capture.audio ? { audio: capture.audio } : {}),
            handsFree: capture.handsFree,
            speechMs: Math.max(0, capture.releasedAt - capture.startedAt),
            transcribeMs: Math.max(0, capture.textAt - capture.releasedAt),
          },
        }
      : {}),
    status: turn.status,
    reply: turn.reply,
    tools: turn.tools,
    changes: turn.changes.map((c) => ({ kind: c.kind, title: changeTitle(c) })),
    steps: turn.steps,
    ...(firstChangeMs !== undefined ? { firstChangeMs } : {}),
    ...(doneMs !== undefined ? { doneMs } : {}),
    ...(turn.answer ? { answer: turn.answer } : {}),
    ...(turn.error ? { error: turn.error } : {}),
  };
}

/** A later look at the same turn: settled by “好”, undone, … Keeps the first record's timings. */
export function updateRecord(record: VoiceRecord, turn: AssistantTurn): VoiceRecord {
  return {
    ...record,
    status: turn.status,
    reply: turn.reply || record.reply,
    ...(turn.answer ? { answer: turn.answer } : {}),
    ...(turn.changes.length
      ? { changes: turn.changes.map((c) => ({ kind: c.kind, title: changeTitle(c) })) }
      : {}),
  };
}

export interface JournalSummary {
  count: number;
  voice: number;
  /** Finger-up → first change, over voice turns that changed something (ms). */
  firstChange: { p50: number; p90: number; n: number } | null;
  /** Finger-up → turn done, over voice turns (ms). */
  done: { p50: number; p90: number; n: number } | null;
  /** Turns whose changes were applied, and how many of those were undone afterwards. */
  applied: number;
  undone: number;
  errors: number;
}

function percentiles(values: number[]): { p50: number; p90: number; n: number } | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))] as number;
  return { p50: at(0.5), p90: at(0.9), n: v.length };
}

export function summarize(records: VoiceRecord[]): JournalSummary {
  const voice = records.filter((r) => r.input === 'voice');
  return {
    count: records.length,
    voice: voice.length,
    firstChange: percentiles(
      voice.flatMap((r) => (r.firstChangeMs !== undefined && r.changes.length ? [r.firstChangeMs] : [])),
    ),
    done: percentiles(voice.flatMap((r) => (r.doneMs !== undefined ? [r.doneMs] : []))),
    applied: records.filter((r) => r.status === 'applied' || r.status === 'undone').length,
    undone: records.filter((r) => r.status === 'undone').length,
    errors: records.filter((r) => r.status === 'error').length,
  };
}

/**
 * Keeps a journal in step with an assistant: one record per settled turn, updated when that turn
 * is later confirmed, cancelled or undone. `capture` hands over how the next utterance was spoken.
 * Storage is the caller's (`save` gets the whole list, newest last).
 */
export class Journal {
  private records: VoiceRecord[];
  private next: VoiceCapture | null = null;
  /** Keyed by turn start time, which is also the record id (turn ids restart with a new assistant). */
  private captureFor = new Map<string, VoiceCapture>();

  constructor(
    initial: VoiceRecord[],
    private readonly save: (records: VoiceRecord[], dropped: VoiceRecord[]) => void,
  ) {
    this.records = initial.slice(-JOURNAL_LIMIT);
  }

  list(): VoiceRecord[] {
    return this.records;
  }

  /** The next utterance was spoken this way. */
  willSay(capture: VoiceCapture): void {
    this.next = capture;
  }

  /**
   * After `say` resolves: the capture if no turn took it (“好” settling a held proposal doesn't
   * start one), so the caller can drop its audio.
   */
  unused(): VoiceCapture | null {
    const c = this.next;
    this.next = null;
    return c;
  }

  /** Feed every assistant state. */
  observe(turns: AssistantTurn[]): void {
    let changed = false;
    for (const turn of turns) {
      const key = String(turn.startedAt);
      if (turn.status === 'thinking') {
        if (this.next && !this.captureFor.has(key)) {
          this.captureFor.set(key, this.next);
          this.next = null;
        }
        continue;
      }
      const i = this.records.findLastIndex((r) => r.id === key);
      const old = this.records[i];
      if (!old) {
        this.records.push(journalRecord(turn, this.captureFor.get(key)));
        this.captureFor.delete(key);
        changed = true;
      } else if (old.status !== turn.status) {
        this.records[i] = updateRecord(old, turn);
        changed = true;
      }
    }
    if (!changed) return;
    const over = this.records.length - JOURNAL_LIMIT;
    const dropped = over > 0 ? this.records.splice(0, over) : [];
    this.save(this.records, dropped);
  }

  clear(): VoiceRecord[] {
    const all = this.records;
    this.records = [];
    this.captureFor.clear();
    this.next = null;
    this.save([], all);
    return all;
  }
}
