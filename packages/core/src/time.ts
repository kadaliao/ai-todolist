/**
 * Date/time helpers.
 *
 * Task dates are *floating*: a `LocalDate` ("2026-11-13") and optional `LocalTime` ("15:00")
 * mean the same wall-clock moment wherever the user is, like Todoist/Things. Absolute instants
 * (ISO strings with `Z`) are only used for audit fields (`createdAt`, `completedAt`) and for
 * turning a reminder into a concrete fire time via {@link toInstant}.
 *
 * Relies on the global `Temporal` (native in Node 26 / modern browsers). Apps targeting engines
 * without it must load `temporal-polyfill/global` before importing core.
 */

/** `YYYY-MM-DD` */
export type LocalDate = string;
/** `HH:mm` (24h) */
export type LocalTime = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  try {
    Temporal.PlainDate.from(s, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}

export function isLocalTime(s: unknown): s is LocalTime {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function toPlainDate(d: LocalDate): Temporal.PlainDate {
  return Temporal.PlainDate.from(d);
}

export function addDays(d: LocalDate, days: number): LocalDate {
  return toPlainDate(d).add({ days }).toString();
}

export function addPeriod(
  d: LocalDate,
  period: { days?: number; weeks?: number; months?: number; years?: number },
): LocalDate {
  // Temporal clamps out-of-range days (Jan 31 + 1 month = Feb 28), which is what users expect.
  return toPlainDate(d).add(period).toString();
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(d: LocalDate): number {
  return toPlainDate(d).dayOfWeek;
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function startOfWeek(d: LocalDate): LocalDate {
  return addDays(d, 1 - isoWeekday(d));
}

export function endOfMonth(d: LocalDate): LocalDate {
  const p = toPlainDate(d);
  return p.with({ day: p.daysInMonth }).toString();
}

/** The wall-clock date/time at `now` in `timeZone`. */
export function wallClock(
  now: Date,
  timeZone: string,
): { date: LocalDate; time: LocalTime; dt: Temporal.PlainDateTime } {
  const zdt = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timeZone);
  const dt = zdt.toPlainDateTime();
  return { date: dt.toPlainDate().toString(), time: formatTime(dt.hour, dt.minute), dt };
}

export function todayIn(now: Date, timeZone: string): LocalDate {
  return wallClock(now, timeZone).date;
}

export function formatTime(hour: number, minute: number): LocalTime {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Concrete instant of a floating date/time in a zone. Non-existent wall times (DST gaps) are
 * shifted forward, repeated ones (DST overlap) take the earlier instant — Temporal's
 * `compatible` disambiguation, same as calendar apps.
 */
export function toInstant(date: LocalDate, time: LocalTime | undefined, timeZone: string): Date {
  const pdt = Temporal.PlainDateTime.from(`${date}T${time ?? '00:00'}`);
  const zdt = pdt.toZonedDateTime(timeZone, { disambiguation: 'compatible' });
  return new Date(zdt.epochMilliseconds);
}
