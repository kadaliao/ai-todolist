import * as chrono from 'chrono-node';
import {
  addDays,
  endOfMonth,
  formatDate,
  formatTime,
  isoWeekday,
  type LocalDate,
  type LocalTime,
} from '../time';
import { NUM, parseNumber } from './numerals';

/**
 * Dates via chrono-node: Simplified Chinese (`zh.hans` — plain `zh` has a casual-config bug that
 * drops 简体 words like 后天, chrono#694) plus English, with extra zh rules chrono lacks:
 * 15号 / 下个月5号 / 这周末 / 下周末 / 月底 / 下周 / 下个月.
 *
 * chrono works on wall-clock `Date`s in the process time zone; we hand it a Date whose *local*
 * fields equal the user's wall clock and only read fields back, so the process zone never leaks
 * into results.
 */

type Ctx = chrono.ParsingContext;

const refDay = (ctx: Ctx): LocalDate =>
  formatDate(ctx.refDate.getFullYear(), ctx.refDate.getMonth() + 1, ctx.refDate.getDate());

function components(d: LocalDate) {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return { year: y, month: m, day };
}

function validDay(year: number, month: number, day: number): LocalDate | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 ? formatDate(year, month, day) : null;
}

function nextMonth(d: LocalDate, k = 1): { year: number; month: number } {
  const { year, month } = components(d);
  const idx = year * 12 + (month - 1) + k;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Parser whose pattern has a leading guard group `(^|[^…])` that is not part of the result. */
function guarded(
  pattern: RegExp,
  extract: (ctx: Ctx, m: RegExpMatchArray) => LocalDate | null,
): chrono.Parser {
  return {
    pattern: () => pattern,
    extract: (ctx, match) => {
      const lead = match[1] ?? '';
      const date = extract(ctx, match);
      if (!date) return null;
      const index = (match.index ?? 0) + lead.length;
      return ctx.createParsingResult(index, match[0].slice(lead.length), components(date));
    },
  };
}

const NOT_NUM = '(^|[^月\\d零〇一二两三四五六七八九十])';
/** Characters after N号 that make it a line/building/size number, not a day of month. */
const NOT_DAY_SUFFIX = '线楼房门位床码机球字口店院厅窗台车桌柜馆仓库道电';
/** "1/2" is a fraction far more often than January 2nd; require a year for slash dates. */
const BARE_SLASH_DATE = /^\d{1,2}\/\d{1,2}$/;

const ZH_EXTRA: chrono.Parser[] = [
  // 下个月5号 / 下月15日
  guarded(new RegExp(`(^|)下个?月(${NUM})[号日]`), (ctx, m) => {
    const day = parseNumber(m[2] as string);
    const { year, month } = nextMonth(refDay(ctx));
    return day ? validDay(year, month, day) : null;
  }),
  // 这个月20号 / 本月20日
  guarded(new RegExp(`(^|)(?:这个?|本)月(${NUM})[号日]`), (ctx, m) => {
    const day = parseNumber(m[2] as string);
    const { year, month } = components(refDay(ctx));
    return day ? validDay(year, month, day) : null;
  }),
  // 15号 (next 15th; this month if not past). Not 3号线 / 1号楼 / 5号电池 …
  guarded(new RegExp(`${NOT_NUM}(${NUM})[号](?![\\d${NOT_DAY_SUFFIX}])`), (ctx, m) => {
    const day = parseNumber(m[2] as string);
    if (!day || day > 31) return null;
    const today = refDay(ctx);
    for (let k = 0; k < 12; k++) {
      const { year, month } = nextMonth(today, k);
      const d = validDay(year, month, day);
      if (d && d >= today) return d;
    }
    return null;
  }),
  // 周末 / 这周末 / 本周末 / 下周末 → Saturday
  guarded(/(^|[^每个])(下|这|本)?(?:个)?(?:周末|礼拜六日)/, (ctx, m) => {
    const today = refDay(ctx);
    const wd = isoWeekday(today);
    const sat = addDays(today, 6 - wd);
    if (m[2] === '下') return addDays(sat, 7);
    return wd >= 6 ? today : sat;
  }),
  // 月底 / 这个月底 / 下个月底
  guarded(/(^|[^每])(下个?|这个?|本)?月(?:底|末)/, (ctx, m) => {
    const today = refDay(ctx);
    if (m[2]?.startsWith('下')) {
      const { year, month } = nextMonth(today);
      return endOfMonth(formatDate(year, month, 1));
    }
    return endOfMonth(today);
  }),
  // 下周 (alone) → next Monday
  guarded(/(^|[^每])下(?:个)?(?:周|星期|礼拜)(?![一二三四五六日天末])/, (ctx) => {
    const today = refDay(ctx);
    return addDays(today, 8 - isoWeekday(today));
  }),
  // 下个月 (alone) → 1st of next month
  guarded(/(^|[^每])下个?月(?![\d零〇一二两三四五六七八九十底末])/, (ctx) => {
    const { year, month } = nextMonth(refDay(ctx));
    return formatDate(year, month, 1);
  }),
];

let zhChrono: chrono.Chrono | null = null;
function zh(): chrono.Chrono {
  if (!zhChrono) {
    const cfg = chrono.zh.hans.createCasualConfiguration();
    cfg.parsers.push(...ZH_EXTRA);
    zhChrono = new chrono.Chrono(cfg);
  }
  return zhChrono;
}

export interface DateMatch {
  start: number;
  end: number;
  text: string;
  date: LocalDate;
  time?: LocalTime;
  /** Minutes, from ranges like "下午3点到5点" / "3-4pm". */
  duration?: number;
  /** The phrase named a day (明天, 周五, 11月20日), not just a time. */
  dayCertain: boolean;
}

const AM_HINT = /凌晨|早上|早晨|清晨|上午|早|am\b|a\.m\./i;

/**
 * First date/time phrase in `text`. `now` is the user's wall clock (local fields of a Date built
 * by the caller). Ambiguous bare hours 1–6 ("4点开会") mean afternoon, as people rarely plan tasks
 * for 4 a.m.
 */
export function matchDate(
  text: string,
  now: Date,
  ignore: ReadonlySet<string> = new Set(),
): DateMatch | null {
  const opts = { forwardDate: true };
  const results = [...zh().parse(text, now, opts), ...chrono.en.casual.parse(text, now, opts)]
    .filter((r) => !ignore.has(r.text) && !BARE_SLASH_DATE.test(r.text))
    .filter((r) => r.start.isCertain('day') || r.start.isCertain('weekday') || r.start.isCertain('hour'))
    .sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const r = results[0];
  if (!r) return null;

  const dayCertain = r.start.isCertain('day') || r.start.isCertain('weekday');
  let date = formatDate(r.start.get('year') ?? 0, r.start.get('month') ?? 1, r.start.get('day') ?? 1);
  // A bare weekday naming today ("周五" on a Friday) means today. chrono's choice between today
  // and next week depends on the time of day; "下周五" / "next fri" still mean next week.
  const todayStr = formatDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (
    r.start.isCertain('weekday') &&
    !r.start.isCertain('day') &&
    date === addDays(todayStr, 7) &&
    !/下|next/i.test(r.text)
  ) {
    date = todayStr;
  }
  let time: LocalTime | undefined;
  let duration: number | undefined;
  if (r.start.isCertain('hour')) {
    let hour = r.start.get('hour') ?? 0;
    const minute = r.start.get('minute') ?? 0;
    if (!r.start.isCertain('meridiem') && hour >= 1 && hour <= 6 && !AM_HINT.test(r.text)) {
      hour += 12;
      if (!dayCertain) {
        const nowTime = formatTime(now.getHours(), now.getMinutes());
        const today = formatDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
        date = formatTime(hour, minute) > nowTime ? today : addDays(today, 1);
      }
    }
    time = formatTime(hour, minute);
    if (r.end?.isCertain('hour')) {
      let endHour = r.end.get('hour') ?? 0;
      if (endHour < hour && endHour + 12 > hour && !r.end.isCertain('meridiem')) endHour += 12;
      const mins = endHour * 60 + (r.end.get('minute') ?? 0) - (hour * 60 + minute);
      if (mins > 0 && mins <= 24 * 60) duration = mins;
    }
  }
  return {
    start: r.index,
    end: r.index + r.text.length,
    text: r.text,
    date,
    ...(time ? { time } : {}),
    ...(duration ? { duration } : {}),
    dayCertain,
  };
}
