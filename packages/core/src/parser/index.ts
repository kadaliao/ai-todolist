import type { NewTask } from '../commands';
import type { Priority, RepeatFrom, Scheduled } from '../model';
import { occurrenceAfter } from '../recurrence';
import { wallClock } from '../time';
import { matchDate } from './dates';
import { DEFAULT_SYNTAX, type Named, type PrefixSyntax, scanPrefixTokens } from './prefix';
import { matchRecurrence } from './recurrence';

/**
 * Quick-add parser: one line of text → task fields plus the character ranges it recognized, so
 * the input box can highlight them and let the user click one to keep it as plain text.
 *
 * Fully local and deterministic (no network, well under 50 ms). AI-assisted capture builds on it:
 * the model extracts date *phrases* and this parser turns them into dates, so it never has to
 * invent one.
 */

export type QuickAddTokenKind = 'project' | 'section' | 'label' | 'priority' | 'date' | 'recurrence';

export interface QuickAddToken {
  kind: QuickAddTokenKind;
  start: number;
  end: number;
  text: string;
}

export interface QuickAddOptions {
  now: Date;
  timeZone: string;
  projects?: readonly Named[];
  sections?: readonly (Named & { projectId: string })[];
  labels?: readonly Named[];
  /** Token texts the user turned back into plain text (clicked or backspaced). */
  ignore?: readonly string[];
  syntax?: PrefixSyntax;
}

export interface QuickAddResult {
  title: string;
  tokens: QuickAddToken[];
  /** `id` present when the name matched an existing project/section/label. */
  project?: { name: string; id?: string };
  section?: { name: string; id?: string };
  labels: { name: string; id?: string }[];
  priority?: Priority;
  scheduled?: Scheduled;
  recurrence?: { rule: string; from: RepeatFrom };
}

/** Blank out recognized ranges (same length, so indices stay valid for later passes). */
function mask(text: string, ranges: readonly { start: number; end: number }[]): string {
  let out = text;
  for (const r of ranges) out = out.slice(0, r.start) + ' '.repeat(r.end - r.start) + out.slice(r.end);
  return out;
}

/** chrono reads local fields; build a Date whose local fields are the user's wall clock. */
function chronoRef(now: Date, timeZone: string): Date {
  const { dt } = wallClock(now, timeZone);
  return new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second);
}

export function parseQuickAdd(input: string, opts: QuickAddOptions): QuickAddResult {
  const ignore = new Set(opts.ignore ?? []);
  const wall = wallClock(opts.now, opts.timeZone);
  const tokens: QuickAddToken[] = [];
  const result: QuickAddResult = { title: '', tokens, labels: [] };

  const prefix = scanPrefixTokens(input, {
    syntax: opts.syntax ?? DEFAULT_SYNTAX,
    projects: opts.projects ?? [],
    labels: opts.labels ?? [],
    sections: opts.sections ?? [],
  }).filter((t) => !ignore.has(t.text));
  for (const t of prefix) {
    const named = { name: t.name as string, ...(t.id ? { id: t.id } : {}) };
    // Repeated tokens are still highlighted and removed from the title; the first one wins.
    if (t.kind === 'project') {
      result.project ??= named;
    } else if (t.kind === 'section') {
      result.section ??= named;
    } else if (t.kind === 'label') {
      if (!result.labels.some((l) => l.name.toLowerCase() === named.name.toLowerCase())) {
        result.labels.push(named);
      }
    } else if (t.kind === 'priority') {
      result.priority = t.priority;
    }
    tokens.push({ kind: t.kind, start: t.start, end: t.end, text: t.text });
  }

  let text = mask(input, tokens);
  const rec = matchRecurrence(text, ignore);
  if (rec) {
    tokens.push({ kind: 'recurrence', start: rec.start, end: rec.end, text: rec.text });
    text = mask(text, [rec]);
  }

  const date = matchDate(text, chronoRef(opts.now, opts.timeZone), ignore);
  if (date) tokens.push({ kind: 'date', start: date.start, end: date.end, text: date.text });

  if (rec) {
    result.recurrence = { rule: rec.rule, from: rec.from };
    let start = date?.dayCertain ? date.date : null;
    if (!start) {
      start = occurrenceAfter(rec.rule, wall.date, wall.date, true);
      // "每天早上8点" typed at 10:00: today's 8:00 is gone, start tomorrow.
      if (start === wall.date && date?.time && date.time <= wall.time) {
        start = occurrenceAfter(rec.rule, wall.date, wall.date, false);
      }
    }
    if (start) {
      result.scheduled = {
        date: start,
        ...(date?.time ? { time: date.time } : {}),
        ...(date?.duration ? { duration: date.duration } : {}),
      };
    } else {
      delete result.recurrence;
    }
  } else if (date) {
    result.scheduled = {
      date: date.date,
      ...(date.time ? { time: date.time } : {}),
      ...(date.duration ? { duration: date.duration } : {}),
    };
  }

  tokens.sort((a, b) => a.start - b.start);
  let title = '';
  let pos = 0;
  for (const t of tokens) {
    title += `${input.slice(pos, t.start)} `;
    pos = t.end;
  }
  title += input.slice(pos);
  result.title = title.replace(/\s+/g, ' ').trim();
  return result;
}

/** Map a parse result to `createTask` input, given ids for names that didn't match anything. */
export function toNewTask(
  r: QuickAddResult,
  resolved: { projectId?: string | null; sectionId?: string | null; labelIds?: string[] } = {},
): NewTask {
  const labels = resolved.labelIds ?? r.labels.flatMap((l) => (l.id ? [l.id] : []));
  return {
    title: r.title,
    projectId: resolved.projectId !== undefined ? resolved.projectId : (r.project?.id ?? null),
    sectionId: resolved.sectionId !== undefined ? resolved.sectionId : (r.section?.id ?? null),
    ...(labels.length ? { labels } : {}),
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    ...(r.scheduled ? { scheduled: r.scheduled } : {}),
    ...(r.recurrence ? { recurrence: r.recurrence } : {}),
  };
}

export type { Named, PrefixSyntax } from './prefix';
export { DEFAULT_SYNTAX } from './prefix';
