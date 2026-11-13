import { RRuleTemporal } from 'rrule-temporal';
import type { Recurrence, RepeatFrom } from './model';
import { addPeriod, compareDates, type LocalDate, toPlainDate } from './time';

/**
 * Recurring tasks.
 *
 * Rules are evaluated on floating dates (a date-only series at midnight UTC), so DST and zone
 * changes can never shift an occurrence to another day; the time of day is carried separately on
 * `Task.scheduled`.
 *
 * Completing a recurring task moves it to its next occurrence (Todoist model, one task id per
 * series). The next occurrence is the first series date after the current one; if that is still
 * on or before the day it was completed (task was overdue), it fast-forwards to the first series
 * date after the completion day — completing never lands the task in the past.
 */

export type RuleParts = Record<string, string>;

export function parseRule(rule: string): RuleParts {
  const parts: RuleParts = {};
  for (const seg of rule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = seg.split('=');
    if (k && v !== undefined) parts[k.toUpperCase()] = v.toUpperCase();
  }
  if (!parts.FREQ) throw new Error(`RRULE without FREQ: ${rule}`);
  return parts;
}

export function formatRule(parts: RuleParts): string {
  const order = ['FREQ', 'INTERVAL', 'BYMONTH', 'BYMONTHDAY', 'BYDAY', 'BYSETPOS', 'COUNT', 'UNTIL'];
  const keys = Object.keys(parts).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.map((k) => `${k}=${parts[k]}`).join(';');
}

const midnight = (d: LocalDate) => `${d}T00:00:00+00:00[UTC]`;

function series(rule: string, anchor: LocalDate): RRuleTemporal {
  return new RRuleTemporal({
    rruleString: rule.replace(/^RRULE:/i, ''),
    dtstart: Temporal.ZonedDateTime.from(midnight(anchor)) as never,
    tzid: 'UTC',
  });
}

/** First series date strictly after `after` (or on/after when `inclusive`), `null` if ended. */
export function occurrenceAfter(
  rule: string,
  anchor: LocalDate,
  after: LocalDate,
  inclusive = false,
): LocalDate | null {
  const from = Temporal.ZonedDateTime.from(midnight(after));
  const next = series(rule, anchor).next(
    from as never,
    inclusive,
  ) as unknown as Temporal.ZonedDateTime | null;
  return next ? next.toPlainDate().toString() : null;
}

/**
 * Build a recurrence starting at the first series date on/after `from` (e.g. "every Monday"
 * typed on a Friday starts next Monday). Returns `null` for rules with no future occurrence.
 */
export function startRecurrence(
  rule: string,
  from: LocalDate,
  repeatFrom: RepeatFrom = 'scheduled',
): Recurrence | null {
  parseRule(rule);
  const first = occurrenceAfter(rule, from, from, true);
  if (!first) return null;
  return { rule, from: repeatFrom, anchor: first, instance: first };
}

function hasByParts(parts: RuleParts): boolean {
  return Object.keys(parts).some((k) => k.startsWith('BY'));
}

const FREQ_UNIT: Record<string, 'days' | 'weeks' | 'months' | 'years'> = {
  DAILY: 'days',
  WEEKLY: 'weeks',
  MONTHLY: 'months',
  YEARLY: 'years',
};

/** Date the task moves to after being completed on `completedOn`. `null` = series is over. */
export function nextOccurrence(rec: Recurrence, completedOn: LocalDate): LocalDate | null {
  const parts = parseRule(rec.rule);
  if (rec.from === 'completion') {
    const unit = FREQ_UNIT[parts.FREQ ?? ''];
    if (!hasByParts(parts) && unit) {
      const interval = Number(parts.INTERVAL ?? '1');
      return addPeriod(completedOn, { [unit]: interval });
    }
    return occurrenceAfter(rec.rule, rec.anchor, completedOn);
  }
  const next = occurrenceAfter(rec.rule, rec.anchor, rec.instance);
  if (next && compareDates(next, completedOn) <= 0) {
    return occurrenceAfter(rec.rule, rec.anchor, completedOn);
  }
  return next;
}

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/**
 * "Change the rule" when a recurring task is moved to `date`: the series is re-anchored there,
 * and single-day rules follow the move (weekly-on-Monday moved to a Tuesday becomes
 * weekly-on-Tuesday; monthly-on-the-5th moved to the 9th becomes monthly-on-the-9th).
 */
export function reanchor(rec: Recurrence, date: LocalDate): Recurrence {
  const parts = parseRule(rec.rule);
  const d = toPlainDate(date);
  if (parts.FREQ === 'WEEKLY' && parts.BYDAY && !parts.BYDAY.includes(',')) {
    parts.BYDAY = WEEKDAYS[d.dayOfWeek - 1] as string;
  }
  if (parts.FREQ === 'MONTHLY' && parts.BYMONTHDAY && /^\d+$/.test(parts.BYMONTHDAY)) {
    parts.BYMONTHDAY = String(d.day);
  }
  if (parts.FREQ === 'YEARLY') {
    if (parts.BYMONTH && /^\d+$/.test(parts.BYMONTH)) parts.BYMONTH = String(d.month);
    if (parts.BYMONTHDAY && /^\d+$/.test(parts.BYMONTHDAY)) parts.BYMONTHDAY = String(d.day);
  }
  return { ...rec, rule: formatRule(parts), anchor: date, instance: date };
}
