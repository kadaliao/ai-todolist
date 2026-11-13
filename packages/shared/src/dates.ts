import {
  addDays,
  isoWeekday,
  type LocalDate,
  parseRule,
  type Recurrence,
  type Scheduled,
} from '@ai-todo/core';
import { getLocale, t } from './i18n';

/** Human labels for dates relative to today: 今天 / 明天 / 周五 / 11月20日 / 2027年3月8日. */
export function formatDay(date: LocalDate, today: LocalDate): string {
  if (date === today) return t('date.today');
  if (date === addDays(today, 1)) return t('date.tomorrow');
  if (date === addDays(today, -1)) return t('date.yesterday');
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [ty] = today.split('-').map(Number) as [number];
  const diff = daysBetween(today, date);
  const zh = getLocale() === 'zh';
  if (diff > 1 && diff < 7) return weekdayName(date);
  if (zh) return y === ty ? `${m}月${d}日` : `${y}年${m}月${d}日`;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(y !== ty ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

export function weekdayName(date: LocalDate, short = false): string {
  const wd = isoWeekday(date) % 7; // 0 = Sunday
  if (getLocale() === 'zh') return `${short ? '' : '周'}${t('weekday.short').split(',')[wd]}`;
  const names = t('weekday.short').split(',');
  if (short) return names[wd] ?? '';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function formatTime(time: string): string {
  if (getLocale() === 'zh') return time;
  const [h, m] = time.split(':').map(Number) as [number, number];
  const suffix = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, '0')}${suffix}` : `${hh}${suffix}`;
}

export function formatScheduled(s: Scheduled, today: LocalDate): string {
  const day = formatDay(s.date, today);
  return s.time ? `${day} ${formatTime(s.time)}` : day;
}

export function dateTone(s: Scheduled | null, today: LocalDate): 'overdue' | 'today' | 'soon' | 'later' {
  if (!s) return 'later';
  if (s.date < today) return 'overdue';
  if (s.date === today) return 'today';
  return daysBetween(today, s.date) < 7 ? 'soon' : 'later';
}

const ZH_DAYS: Record<string, string> = {
  MO: '一',
  TU: '二',
  WE: '三',
  TH: '四',
  FR: '五',
  SA: '六',
  SU: '日',
};
const EN_DAYS: Record<string, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};

/** Short human description of a recurrence rule. Falls back to the raw rule for exotic ones. */
export function describeRecurrence(rec: Pick<Recurrence, 'rule' | 'from'>): string {
  const zh = getLocale() === 'zh';
  let parts: Record<string, string>;
  try {
    parts = parseRule(rec.rule);
  } catch {
    return rec.rule;
  }
  const n = Number(parts.INTERVAL ?? '1');
  const by = parts.BYDAY?.split(',') ?? [];
  const suffix = rec.from === 'completion' ? (zh ? '（完成后）' : ' after done') : '';
  const every = (unitZh: string, unitEn: string) =>
    zh
      ? n === 1
        ? `每${unitZh}`
        : `每${n}${unitZh}`
      : n === 1
        ? `Every ${unitEn}`
        : `Every ${n} ${unitEn}s`;
  let text: string;
  switch (parts.FREQ) {
    case 'DAILY':
      text = every('天', 'day');
      break;
    case 'WEEKLY':
      if (by.join(',') === 'MO,TU,WE,TH,FR') text = t('repeat.weekdays');
      else if (by.join(',') === 'SA,SU') text = zh ? '每周末' : 'Every weekend';
      else if (by.length) {
        const days = by.map((d) => (zh ? ZH_DAYS[d] : EN_DAYS[d]) ?? d);
        text = zh
          ? n === 1
            ? `每周${days.join('、')}`
            : `每${n}周的周${days.join('、')}`
          : `${n === 1 ? 'Every' : `Every ${n} weeks on`} ${days.join(', ')}`;
      } else text = every(zh ? '周' : '周', 'week');
      break;
    case 'MONTHLY': {
      const md = parts.BYMONTHDAY;
      if (md === '-1' || parts.BYSETPOS === '-1') {
        const day = md === '-1' ? null : md?.split(',').at(-1);
        text = day
          ? zh
            ? `${n === 1 ? '每月' : `每${n}个月`}${day}号`
            : `Monthly on the ${day}th`
          : zh
            ? `${n === 1 ? '每月' : `每${n}个月`}最后一天`
            : 'Last day of every month';
      } else if (md) text = zh ? `${n === 1 ? '每月' : `每${n}个月`}${md}号` : `Monthly on the ${md}`;
      else text = zh ? (n === 1 ? '每月' : `每${n}个月`) : n === 1 ? 'Every month' : `Every ${n} months`;
      break;
    }
    case 'YEARLY':
      text =
        parts.BYMONTH && parts.BYMONTHDAY
          ? t('repeat.yearly', { month: parts.BYMONTH, day: parts.BYMONTHDAY })
          : every('年', 'year');
      break;
    default:
      text = rec.rule;
  }
  return text + suffix;
}

/** Calendar grid for a month (Monday-first), 6 rows × 7 days. */
export function monthGrid(year: number, month: number): LocalDate[] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const start = addDays(first, 1 - isoWeekday(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function monthTitle(year: number, month: number): string {
  if (getLocale() === 'zh') return `${year}年${month}月`;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
