import {
  addDays,
  isoWeekday,
  type LocalDate,
  logbook,
  type ReadStore,
  today as todayView,
  toInstant,
  wallClock,
} from '@ai-todo/core';
import { formatTime } from './dates';
import { getLocale, t } from './i18n';

/**
 * The morning plan and the Sunday look back, as notification text. Computed on the device from
 * the list as it is when notifications are planned (they are re-planned whenever data changes).
 */

export interface Brief {
  /** Fire time (ms). */
  at: number;
  kind: 'plan' | 'review';
  title: string;
  body: string;
}

/** “今天 5 件事” — the first few by time and priority, then how many more and how many overdue. */
export function planBrief(store: ReadStore, day: LocalDate): { title: string; body: string } | null {
  const v = todayView(store, day);
  // At their times first, then what is due today, then the rest (already by priority and order).
  const rank = (x: (typeof v.today)[number]) =>
    x.scheduled?.date === day && x.scheduled.time ? 0 : x.deadline && x.deadline <= day ? 1 : 2;
  const tasks = v.today.filter((x) => !x.parentId).sort((a, b) => rank(a) - rank(b));
  const overdue = v.overdue.filter((x) => !x.parentId).length;
  if (!tasks.length && !overdue) return null;
  const zh = getLocale() === 'zh';
  const items = tasks.slice(0, 3).map((x) => {
    if (x.scheduled?.date === day && x.scheduled.time) return `${formatTime(x.scheduled.time)} ${x.title}`;
    if (x.deadline && x.deadline <= day)
      return `${x.title}（${t('deadline.due', { day: t('date.today') })}）`;
    return x.title;
  });
  const parts = [items.join(zh ? '、' : ', ')];
  if (tasks.length > items.length) parts.push(t('brief.more', { n: tasks.length - items.length }));
  let body = parts.filter(Boolean).join(zh ? '，' : ', ');
  if (overdue)
    body = body
      ? `${body}${zh ? '；' : '; '}${t('brief.overdue', { n: overdue })}`
      : t('brief.overdue', { n: overdue });
  return { title: t('brief.title', { n: tasks.length }), body };
}

/** Things finished from Monday until `day` (both inclusive). */
export function doneThisWeek(store: ReadStore, day: LocalDate, timeZone: string): number {
  const monday = addDays(day, 1 - isoWeekday(day));
  let n = 0;
  for (const e of logbook(store, 2000)) {
    const d = wallClock(new Date(e.completedAt), timeZone).date;
    if (d < monday) break;
    if (d > day) continue;
    if (e.kind === 'task' && e.task.parentId) continue;
    n++;
  }
  return n;
}

/**
 * Plans for the next `days` days: a morning plan at the morning time, and on Sundays a look back
 * at the evening time. Days with nothing to say are skipped.
 */
export function upcomingBriefs(
  store: ReadStore,
  opts: { now: number; timeZone: string; morning: string; evening: string; days?: number },
): Brief[] {
  const out: Brief[] = [];
  const first = wallClock(new Date(opts.now), opts.timeZone).date;
  for (let i = 0; i < (opts.days ?? 7); i++) {
    const day = addDays(first, i);
    const morning = toInstant(day, opts.morning, opts.timeZone).getTime();
    if (morning > opts.now) {
      const plan = planBrief(store, day);
      if (plan) out.push({ at: morning, kind: 'plan', ...plan });
    }
    if (isoWeekday(day) === 7) {
      const evening = toInstant(day, opts.evening, opts.timeZone).getTime();
      // Only today's count is known; a later Sunday's is whatever gets done by then.
      const done = i === 0 ? doneThisWeek(store, day, opts.timeZone) : 1;
      if (evening > opts.now && done > 0) {
        out.push({
          at: evening,
          kind: 'review',
          title: t('brief.reviewTitle'),
          body: i === 0 ? t('brief.reviewBody', { done }) : t('brief.reviewBodyLater'),
        });
      }
    }
  }
  return out;
}
