import {
  daysBetween,
  describeRecurrence,
  formatDay,
  formatTime,
  monthGrid,
  setLocale,
} from '@ai-todo/shared';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  (globalThis as { document?: unknown }).document ??= { documentElement: { lang: '' } };
});

describe('formatDay (zh)', () => {
  beforeAll(() => setLocale('zh'));
  const today = '2026-11-13'; // Friday
  it('uses relative words near today', () => {
    expect(formatDay('2026-11-13', today)).toBe('今天');
    expect(formatDay('2026-11-14', today)).toBe('明天');
    expect(formatDay('2026-11-12', today)).toBe('昨天');
    expect(formatDay('2026-11-17', today)).toBe('周二');
  });
  it('uses month/day further out, with year only when different', () => {
    expect(formatDay('2026-12-25', today)).toBe('12月25日');
    expect(formatDay('2027-01-02', today)).toBe('2027年1月2日');
  });
  it('keeps 24h time', () => {
    expect(formatTime('15:00')).toBe('15:00');
  });
});

describe('formatDay (en)', () => {
  beforeAll(() => setLocale('en'));
  it('formats in English', () => {
    expect(formatDay('2026-11-14', '2026-11-13')).toBe('Tomorrow');
    expect(formatDay('2026-12-25', '2026-11-13')).toBe('Dec 25');
    expect(formatTime('15:00')).toBe('3pm');
    expect(formatTime('09:30')).toBe('9:30am');
  });
});

describe('describeRecurrence', () => {
  beforeAll(() => setLocale('zh'));
  it.each([
    ['FREQ=DAILY', '每天'],
    ['FREQ=DAILY;INTERVAL=3', '每3天'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '每个工作日'],
    ['FREQ=WEEKLY;BYDAY=MO,WE,FR', '每周一、三、五'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', '每2周的周五'],
    ['FREQ=MONTHLY;BYMONTHDAY=15', '每月15号'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', '每月最后一天'],
    ['FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1', '每月31号'],
    ['FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=8', '每年3月8日'],
  ])('%s → %s', (rule, text) => {
    expect(describeRecurrence({ rule, from: 'scheduled' })).toBe(text);
  });
  it('marks completion-based rules', () => {
    expect(describeRecurrence({ rule: 'FREQ=DAILY;INTERVAL=3', from: 'completion' })).toBe('每3天（完成后）');
  });
});

describe('calendar helpers', () => {
  it('builds a Monday-first 6-week grid', () => {
    const grid = monthGrid(2026, 11);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-10-26');
    expect(grid).toContain('2026-11-30');
  });
  it('counts days across months', () => {
    expect(daysBetween('2026-11-30', '2026-12-02')).toBe(2);
  });
});
