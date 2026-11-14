import { describe, expect, it } from 'vitest';
import {
  createTasks,
  dayParts,
  listedDate,
  type Op,
  rescheduleOverdue,
  setSetting,
  today,
  upcoming,
} from '../src';
import { clock, replica } from './helpers';

// Friday 2026-11-13 10:00 in Shanghai.
const NOW = '2026-11-13T02:00:00Z';
const titles = (ts: { title: string }[]) => ts.map((t) => t.title).sort();

describe('deadlines in the date views', () => {
  function seed() {
    const r = replica('d', clock(NOW));
    r.dispatch(
      createTasks([
        { title: 'due today', deadline: '2026-11-13' },
        { title: 'due friday next week', deadline: '2026-11-20' },
        { title: 'missed deadline', deadline: '2026-11-11' },
        { title: 'planned later, due today', scheduled: { date: '2026-11-17' }, deadline: '2026-11-13' },
        { title: 'planned today, due later', scheduled: { date: '2026-11-13' }, deadline: '2026-11-18' },
        { title: 'planned monday', scheduled: { date: '2026-11-16' }, deadline: '2026-11-18' },
        { title: 'no dates' },
      ]),
    );
    return r;
  }

  it('Today shows what is due today, even if planned for later', () => {
    const t = today(seed().store, '2026-11-13');
    expect(titles(t.overdue)).toEqual(['missed deadline']);
    expect(titles(t.today)).toEqual(['due today', 'planned later, due today', 'planned today, due later']);
  });

  it('Upcoming lists each task once, on its date or else its deadline', () => {
    const days = upcoming(seed().store, '2026-11-14', 10);
    const on = (d: string) => titles(days.find((b) => b.date === d)?.tasks ?? []);
    expect(on('2026-11-16')).toEqual(['planned monday']);
    expect(on('2026-11-20')).toEqual(['due friday next week']);
    expect(on('2026-11-17')).toEqual([]); // listed on its earlier deadline instead
    expect(listedDate({ scheduled: { date: '2026-11-17' }, deadline: '2026-11-13' } as never)).toBe(
      '2026-11-13',
    );
  });

  it('moving overdue to today also catches missed deadlines', () => {
    const r = seed();
    expect(r.dispatch(rescheduleOverdue()).result).toBe(1);
    const t = today(r.store, '2026-11-13');
    expect(t.overdue).toEqual([]);
    expect(titles(t.today)).toContain('missed deadline');
  });
});

describe('synced settings', () => {
  it('day parts fall back to defaults per field', () => {
    const r = replica('d', clock(NOW));
    expect(dayParts(r.store).morning).toBe('09:00');
    r.dispatch(setSetting('dayParts', { morning: '07:30', evening: 'nope' }));
    expect(dayParts(r.store)).toEqual({
      morning: '07:30',
      noon: '12:00',
      afternoon: '15:00',
      evening: '20:00',
    });
  });

  it('ops for entity types from a newer app are skipped, not fatal', () => {
    const r = replica('d', clock(NOW));
    const op = {
      hlc: '00000000a-0000-x',
      entity: 'reaction',
      entityId: 'r',
      field: 'f',
      value: 1,
      tx: 't',
      actor: 'user',
    };
    expect(r.receive([op as unknown as Op])).toBe(0);
  });
});
