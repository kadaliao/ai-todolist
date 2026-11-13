import type { RepeatFrom } from '../model';
import { NUM, parseNumber } from './numerals';

/**
 * Recurrence phrases → RRULE. chrono doesn't do recurrence, so this is a small hand-written
 * grammar covering what people actually type:
 *
 *   每天 每日 每两天 每隔一天(=隔天) 每周 每周一 每周一三五 每周一到周五 每周末 每个工作日
 *   每两周周五 每月 每月15号 每月最后一天 每月底 每三个月 每年 每年3月8日 完成后每3天
 *   every day / every 3 days / every other week / every mon, wed and fri / every weekday
 *   every month on the 15th / every 15th / every year / every! 2 weeks (after completion)
 *
 * "每隔N天": colloquially 每隔一天 means every other day (interval 2); for N ≥ 2 people mean every
 * N days, so that's what it maps to.
 */

export interface RecurrenceMatch {
  start: number;
  end: number;
  text: string;
  rule: string;
  from: RepeatFrom;
}

const ZH_WEEKDAY: Record<string, string> = {
  一: 'MO',
  二: 'TU',
  三: 'WE',
  四: 'TH',
  五: 'FR',
  六: 'SA',
  日: 'SU',
  天: 'SU',
  七: 'SU',
};
const WEEK_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const EN_WEEKDAY: Record<string, string> = {
  mon: 'MO',
  tue: 'TU',
  wed: 'WE',
  thu: 'TH',
  fri: 'FR',
  sat: 'SA',
  sun: 'SU',
};

function sortDays(days: Iterable<string>): string {
  return [...new Set(days)].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b)).join(',');
}

/** Monthly on day N; for 29–31 fall back to the month's last day in shorter months. */
export function monthDayRule(day: number): string {
  if (day <= 28) return `BYMONTHDAY=${day}`;
  const days = Array.from({ length: day - 27 }, (_, k) => 28 + k).join(',');
  return `BYMONTHDAY=${days};BYSETPOS=-1`;
}

function withInterval(freq: string, n: number | null, rest = ''): string {
  const parts = [`FREQ=${freq}`];
  if (n && n > 1) parts.push(`INTERVAL=${n}`);
  if (rest) parts.push(rest);
  return parts.join(';');
}

/** Interval from 每/每隔 + number ("每隔一天" → 2). */
function zhInterval(ge: string | undefined, numText: string | undefined): number | null {
  const n = numText ? parseNumber(numText) : 1;
  if (n === null || n < 1) return null;
  if (ge && n === 1) return 2;
  return n;
}

// A weekday char followed by 次/遍 is a count ("每周一次" = once a week), not Monday.
const ZH_DAY = '[一二三四五六日天七](?![次遍])';
const ZH_DAY_LIST = `${ZH_DAY}(?:[、,，和及与]?(?:周|星期|礼拜)?${ZH_DAY})*`;

interface Pattern {
  re: RegExp;
  build(m: RegExpExecArray): string | null;
}

const ZH_PATTERNS: Pattern[] = [
  {
    // 每个工作日 / 每工作日
    re: /每个?工作日/y,
    build: () => 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  },
  {
    // 每周末 / 每个周末
    re: /每个?(?:周末|星期六日|礼拜六日)/y,
    build: () => 'FREQ=WEEKLY;BYDAY=SA,SU',
  },
  {
    // 每周一到周五 / 每周一至五
    re: /每(?:个)?(?:周|星期|礼拜)([一二三四五六日天])(?:到|至|-|~|～)(?:周|星期|礼拜)?([一二三四五六日天])/y,
    build: (m) => {
      const a = WEEK_ORDER.indexOf(ZH_WEEKDAY[m[1] as string] as string);
      const b = WEEK_ORDER.indexOf(ZH_WEEKDAY[m[2] as string] as string);
      if (a < 0 || b < 0 || b < a) return null;
      return `FREQ=WEEKLY;BYDAY=${WEEK_ORDER.slice(a, b + 1).join(',')}`;
    },
  },
  {
    // 每天 每日 每两天 每隔一天 每3天
    re: new RegExp(`每(隔)?(${NUM})?(?:个)?(?:天|日)`, 'y'),
    build: (m) => {
      const n = zhInterval(m[1], m[2]);
      return n ? withInterval('DAILY', n) : null;
    },
  },
  {
    // 每周 每周一三五 每两周周五 每隔一周 每周一次
    re: new RegExp(
      `每(隔)?(${NUM})?(?:个)?(?:周|星期|礼拜)(?:的)?(?:(?:周|星期|礼拜)?(${ZH_DAY_LIST}))?(一次)?`,
      'y',
    ),
    build: (m) => {
      const n = zhInterval(m[1], m[2]);
      if (!n) return null;
      const list = m[3];
      if (!list) return withInterval('WEEKLY', n);
      const days = [...list].map((ch) => ZH_WEEKDAY[ch]).filter((d): d is string => !!d);
      return withInterval('WEEKLY', n, `BYDAY=${sortDays(days)}`);
    },
  },
  {
    // 每月 每月15号 每个月1日 每月最后一天 每月底 每三个月
    re: new RegExp(`每(隔)?(${NUM})?(?:个)?月(?:的)?(?:(${NUM})(?:号|日)|(最后一天|底|末))?`, 'y'),
    build: (m) => {
      const n = zhInterval(m[1], m[2]);
      if (!n) return null;
      if (m[3]) {
        const day = parseNumber(m[3]);
        if (!day || day > 31) return null;
        return withInterval('MONTHLY', n, monthDayRule(day));
      }
      if (m[4]) return withInterval('MONTHLY', n, 'BYMONTHDAY=-1');
      return withInterval('MONTHLY', n);
    },
  },
  {
    // 每年 每年3月8日
    re: new RegExp(`每(隔)?(${NUM})?(?:个)?年(?:的)?(?:(${NUM})月(${NUM})(?:号|日)?)?`, 'y'),
    build: (m) => {
      const n = zhInterval(m[1], m[2]);
      if (!n) return null;
      if (m[3] && m[4]) {
        const month = parseNumber(m[3]);
        const day = parseNumber(m[4]);
        if (!month || month > 12 || !day || day > 31) return null;
        return withInterval('YEARLY', n, `BYMONTH=${month};BYMONTHDAY=${day}`);
      }
      return withInterval('YEARLY', n);
    },
  },
];

const EN_DAY = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday|rsday)?';
const EN_UNIT: Record<string, string> = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' };

const EN_PATTERNS: Pattern[] = [
  {
    re: /every\s+(?:weekday|workday|work\s+day)s?\b/iy,
    build: () => 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  },
  {
    re: /every\s+weekend\b/iy,
    build: () => 'FREQ=WEEKLY;BYDAY=SA,SU',
  },
  {
    re: new RegExp(`every\\s+(${EN_DAY}(?:\\s*(?:,|and|&)\\s*${EN_DAY})*)\\b`, 'iy'),
    build: (m) => {
      const days = (m[1] as string)
        .toLowerCase()
        .split(/\s*(?:,|and|&)\s*/)
        .map((d) => EN_WEEKDAY[d.slice(0, 3)])
        .filter((d): d is string => !!d);
      return days.length ? `FREQ=WEEKLY;BYDAY=${sortDays(days)}` : null;
    },
  },
  {
    re: /every\s+(?:month\s+on\s+the\s+)?(\d{1,2})(?:st|nd|rd|th)(?:\s+of\s+(?:the|each|every)\s+month)?\b/iy,
    build: (m) => {
      const day = Number(m[1]);
      return day >= 1 && day <= 31 ? `FREQ=MONTHLY;${monthDayRule(day)}` : null;
    },
  },
  {
    re: /every\s+(?:(other)\s+|(\d{1,3})\s+)?(day|week|month|year)s?\b/iy,
    build: (m) => {
      const n = m[1] ? 2 : m[2] ? Number(m[2]) : 1;
      return n >= 1 ? withInterval(EN_UNIT[(m[3] as string).toLowerCase()] as string, n) : null;
    },
  },
];

/** Find the first recurrence phrase in `text`, skipping texts the user un-recognized. */
export function matchRecurrence(
  text: string,
  ignore: ReadonlySet<string> = new Set(),
): RecurrenceMatch | null {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '每' || ch === '完') {
      const completion = text.startsWith('完成后', i);
      const at = completion ? i + 3 : i;
      if (text[at] !== '每') continue;
      for (const p of ZH_PATTERNS) {
        p.re.lastIndex = at;
        const m = p.re.exec(text);
        if (!m) continue;
        const rule = p.build(m);
        if (!rule) continue;
        const end = at + m[0].length;
        const raw = text.slice(i, end);
        if (ignore.has(raw)) break;
        return { start: i, end, text: raw, rule, from: completion ? 'completion' : 'scheduled' };
      }
    } else if ((ch === 'e' || ch === 'E') && (i === 0 || !/[A-Za-z0-9]/.test(text[i - 1] as string))) {
      if (!/^every/i.test(text.slice(i, i + 5))) continue;
      const bang = text[i + 5] === '!';
      const probe = bang ? `${text.slice(0, i + 5)}${text.slice(i + 6)}` : text;
      for (const p of EN_PATTERNS) {
        p.re.lastIndex = i;
        const m = p.re.exec(probe);
        if (!m) continue;
        const rule = p.build(m);
        if (!rule) continue;
        const end = i + m[0].length + (bang ? 1 : 0);
        const raw = text.slice(i, end);
        if (ignore.has(raw)) break;
        return { start: i, end, text: raw, rule, from: bang ? 'completion' : 'scheduled' };
      }
    }
  }
  return null;
}
