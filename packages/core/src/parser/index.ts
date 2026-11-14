import type { NewTask } from '../commands';
import { type DayParts, DEFAULT_DAY_PARTS, type Priority, type RepeatFrom, type Scheduled } from '../model';
import { occurrenceAfter } from '../recurrence';
import { addDays, type LocalDate, wallClock } from '../time';
import { type DateMatch, matchDate } from './dates';
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

export type QuickAddTokenKind =
  | 'project'
  | 'section'
  | 'label'
  | 'priority'
  | 'date'
  | 'deadline'
  | 'recurrence';

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
  /** Times for bare day-part words (“明天早上” → morning); defaults to {@link DEFAULT_DAY_PARTS}. */
  dayParts?: DayParts;
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
  /** “周五之前”, “截止下周一”, “due Friday”: a deadline instead of a planned day. */
  deadline?: LocalDate;
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
  // A clicked-away token's text includes absorbed connectors (“周五之前”); matchers see “周五”.
  const ignore = new Set(
    (opts.ignore ?? []).flatMap((t) => [t, t.replace(CONNECTOR_HEAD, '').replace(CONNECTOR_TAIL, '').trim()]),
  );
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
    // “每周五之前交周报”: a series has no single deadline, but the connector isn't title text.
    const end = rec.end + (DEADLINE_AFTER.exec(text.slice(rec.end))?.[0].length ?? 0);
    tokens.push({ kind: 'recurrence', start: rec.start, end, text: input.slice(rec.start, end) });
    text = mask(text, [{ start: rec.start, end }]);
  }

  // Up to two date phrases: a planned day and a deadline (“今天写方案 下周三截止”).
  const ref = chronoRef(opts.now, opts.timeZone);
  let date: DateMatch | null = null;
  let due: DateMatch | null = null;
  const first = matchDate(text, ref, ignore);
  if (first) {
    const a = connectors(text, first, !!rec);
    tokens.push({
      kind: a.deadline ? 'deadline' : 'date',
      start: a.start,
      end: a.end,
      text: input.slice(a.start, a.end),
    });
    if (a.deadline) due = first;
    else date = first;
    const rest = mask(text, [a]);
    const second = matchDate(rest, ref, ignore);
    if (second) {
      const b = connectors(rest, second, !!rec);
      if (b.deadline !== a.deadline) {
        tokens.push({
          kind: b.deadline ? 'deadline' : 'date',
          start: b.start,
          end: b.end,
          text: input.slice(b.start, b.end),
        });
        if (b.deadline) due = second;
        else date = second;
      }
    }
  }
  // “明天早上”, “今晚”: no clock time, but the day part names one.
  if (date && !date.time) {
    const part = dayPart(date.text);
    if (part) {
      date.time = (opts.dayParts ?? DEFAULT_DAY_PARTS)[part];
      // “晚上 看书” typed at 22:00 means tomorrow evening (but 今晚 is still tonight).
      const namesDay = namesADay(date.text) || /今|today|tonight/i.test(date.text);
      if (!namesDay && date.date === wall.date && date.time <= wall.time) {
        date.date = addDays(wall.date, 1);
      }
    }
  }

  if (rec) {
    result.recurrence = { rule: rec.rule, from: rec.from };
    // "每周一早上": 早上 alone makes chrono treat the day as today, but it only names a time of
    // day; the series should start on its first Monday, not today.
    let start = date?.dayCertain && namesADay(date.text) ? date.date : null;
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

  if (due) result.deadline = due.date;

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

/**
 * The range a date phrase covers once its connector words are absorbed (从下周开始, 周五之前,
 * by Friday), and whether those words make it a deadline. A series has no single deadline:
 * “每周五之前” stays a plain recurrence.
 */
function connectors(
  text: string,
  m: DateMatch,
  recurring: boolean,
): { start: number; end: number; deadline: boolean } {
  const head = text.slice(0, m.start);
  const tail = text.slice(m.end);
  const due = DEADLINE_BEFORE.exec(head);
  const dueAfter = DEADLINE_AFTER.exec(tail);
  const before = due ?? /(?:从|在|于|\b(?:on|at|starting|from|until)\s+)$/i.exec(head);
  const after = dueAfter ?? /^(?:开始|以内|左右)/.exec(tail);
  return {
    start: m.start - (before?.[0].length ?? 0),
    end: m.end + (after?.[0].length ?? 0),
    deadline: !recurring && !!(due || dueAfter),
  };
}

/** Words before a date that make it a deadline: 截止周五, 最晚下周一, by Friday, due Mon. */
const DEADLINE_BEFORE = /(?:截止(?:到|至|日期?是?)?|截至|最晚|最迟|\b(?:by|before|due)\s+)\s*$/i;
/** …and after it: 周五之前, 下周一前, 月底以前, 周五截止. */
const DEADLINE_AFTER = /^\s*(?:之前|以前|前|为止|截止|到期)/;

const CONNECTOR_HEAD =
  /^(?:截止(?:到|至|日期?是?)?|截至|最晚|最迟|从|在|于|(?:by|before|due|on|at|starting|from|until)\s+)\s*/i;
const CONNECTOR_TAIL = /\s*(?:之前|以前|前|为止|截止|到期|开始|以内|左右)$/;

const DAY_PARTS: [RegExp, keyof DayParts][] = [
  [/早上|早晨|清晨|上午|明早|今早|一早|morning/i, 'morning'],
  [/中午|noon|midday/i, 'noon'],
  [/下午|afternoon/i, 'afternoon'],
  [/傍晚|晚上|今晚|明晚|夜里|夜间|晚间|evening|tonight|night/i, 'evening'],
];

function dayPart(text: string): keyof DayParts | null {
  for (const [re, part] of DAY_PARTS) if (re.test(text)) return part;
  return null;
}

const TIME_OF_DAY =
  /(?:早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里|夜间|凌晨|今晚|tonight|morning|afternoon|evening|night|noon|midnight|at|in the|\d{1,2}\s*[:：.]\s*\d{2}|[\d零〇一二两三四五六七八九十]+\s*(?:点|时)(?:半|一刻|三刻|[\d零〇一二两三四五六七八九十]+分?)?|\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)|\s)/gi;

/** Does a date phrase name a day (明天, 周五, 11月20日) rather than just a time of day (早上8点)? */
function namesADay(text: string): boolean {
  return text.replace(TIME_OF_DAY, '').length > 0;
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
    ...(r.deadline ? { deadline: r.deadline } : {}),
    ...(r.recurrence ? { recurrence: r.recurrence } : {}),
  };
}

export type { Named, PrefixSyntax } from './prefix';
export { DEFAULT_SYNTAX } from './prefix';
