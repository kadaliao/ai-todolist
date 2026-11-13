import { describe, expect, it } from 'vitest';
import type { Recurrence } from '../src';
import { nextOccurrence, occurrenceAfter, reanchor, startRecurrence, toInstant } from '../src';

const rec = (rule: string, anchor: string, from: Recurrence['from'] = 'scheduled'): Recurrence => ({
  rule,
  from,
  anchor,
  instance: anchor,
});

describe('series dates', () => {
  it('starts on the first matching date', () => {
    expect(startRecurrence('FREQ=WEEKLY;BYDAY=MO', '2026-11-13')?.instance).toBe('2026-11-16');
    expect(startRecurrence('FREQ=WEEKLY;BYDAY=FR', '2026-11-13')?.instance).toBe('2026-11-13');
    expect(startRecurrence('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-11-13')?.instance).toBe('2026-11-30');
    expect(startRecurrence('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', '2026-11-13')?.instance).toBe('2028-02-29');
  });

  it('day 29–31 rule falls back to month end', () => {
    const rule = 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1';
    const dates: string[] = [];
    let d = '2026-12-31';
    for (let i = 0; i < 4; i++) {
      d = occurrenceAfter(rule, '2026-12-31', d) as string;
      dates.push(d);
    }
    expect(dates).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });
});

describe('nextOccurrence (from scheduled)', () => {
  it('advances to the next series date', () => {
    const r = rec('FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-11-13');
    expect(nextOccurrence(r, '2026-11-13')).toBe('2026-11-16');
  });

  it('completing early keeps the cadence', () => {
    const r = rec('FREQ=WEEKLY;BYDAY=MO', '2026-11-16');
    expect(nextOccurrence(r, '2026-11-14')).toBe('2026-11-23');
  });

  it('completing an overdue task skips to the future, never the past', () => {
    const r = { ...rec('FREQ=DAILY', '2026-11-01'), instance: '2026-11-10' };
    expect(nextOccurrence(r, '2026-11-13')).toBe('2026-11-14');
  });

  it('one-off move: series continues from the original date', () => {
    // Weekly Monday task; this week's occurrence moved to Wednesday 11-18 and done that day.
    const r = rec('FREQ=WEEKLY;BYDAY=MO', '2026-11-16');
    expect(nextOccurrence(r, '2026-11-18')).toBe('2026-11-23');
  });

  it('returns null when the series has ended', () => {
    const r = { ...rec('FREQ=DAILY;COUNT=2', '2026-11-13'), instance: '2026-11-14' };
    expect(nextOccurrence(r, '2026-11-14')).toBeNull();
  });
});

describe('nextOccurrence (from completion)', () => {
  it('counts the interval from the completion day', () => {
    const r = rec('FREQ=DAILY;INTERVAL=3', '2026-11-13', 'completion');
    expect(nextOccurrence(r, '2026-11-20')).toBe('2026-11-23');
  });

  it('clamps month ends', () => {
    const r = rec('FREQ=MONTHLY', '2026-01-31', 'completion');
    expect(nextOccurrence(r, '2027-01-31')).toBe('2027-02-28');
  });

  it('with BY parts, takes the first series date after completion', () => {
    const r = rec('FREQ=WEEKLY;BYDAY=MO', '2026-11-16', 'completion');
    expect(nextOccurrence(r, '2026-11-25')).toBe('2026-11-30');
  });
});

describe('reanchor ("change the rule")', () => {
  it('single-weekday rules follow the move', () => {
    const r = reanchor(rec('FREQ=WEEKLY;BYDAY=MO', '2026-11-16'), '2026-11-17');
    expect(r).toEqual({
      rule: 'FREQ=WEEKLY;BYDAY=TU',
      from: 'scheduled',
      anchor: '2026-11-17',
      instance: '2026-11-17',
    });
    expect(nextOccurrence(r, '2026-11-17')).toBe('2026-11-24');
  });

  it('monthly day-of-month follows the move', () => {
    expect(reanchor(rec('FREQ=MONTHLY;BYMONTHDAY=5', '2026-12-05'), '2026-12-09').rule).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=9',
    );
  });

  it('keeps multi-day rules and interval', () => {
    expect(reanchor(rec('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH', '2026-11-16'), '2026-11-18').rule).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH',
    );
  });
});

describe('time zones and DST', () => {
  it('floating 09:00 stays 09:00 local across a DST change', () => {
    // US DST ends 2026-11-01: 09:00 EDT = 13:00Z before, 09:00 EST = 14:00Z after.
    expect(toInstant('2026-10-31', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-10-31T13:00:00.000Z',
    );
    expect(toInstant('2026-11-02', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-11-02T14:00:00.000Z',
    );
  });

  it('a non-existent wall time (spring forward) shifts forward', () => {
    expect(toInstant('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('an ambiguous wall time (fall back) takes the earlier instant', () => {
    expect(toInstant('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('weekly dates across DST stay on the same weekday', () => {
    const dates: string[] = [];
    let d = '2026-10-19';
    for (let i = 0; i < 4; i++) {
      d = occurrenceAfter('FREQ=WEEKLY;BYDAY=MO', '2026-10-19', d) as string;
      dates.push(d);
    }
    expect(dates).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
  });
});
