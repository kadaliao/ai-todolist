import type { Task } from '@ai-todo/core';
import { describe, expect, it } from 'vitest';

// reminders.ts touches localStorage/window at import; provide minimal globals.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  location: { hash: '' },
  history: { pushState() {} },
  document: { documentElement: { lang: 'zh-CN' } },
});
const { dueReminders } = await import('../src/state/reminders');

const base: Task = {
  id: 't',
  title: 'x',
  notes: '',
  projectId: null,
  sectionId: null,
  parentId: null,
  sortKey: 'a0',
  priority: 0,
  labels: [],
  scheduled: null,
  deadline: null,
  recurrence: null,
  reminders: [],
  completedAt: null,
  deletedAt: null,
  createdAt: '2026-11-13T00:00:00Z',
  origin: 'user',
};

describe('dueReminders', () => {
  it('defaults to the task time when it has one', () => {
    const due = dueReminders(
      [{ ...base, scheduled: { date: '2026-11-14', time: '15:00' } }],
      'Asia/Shanghai',
      true,
    );
    expect(due.map((d) => new Date(d.at).toISOString())).toEqual(['2026-11-14T07:00:00.000Z']);
    expect(
      dueReminders([{ ...base, scheduled: { date: '2026-11-14', time: '15:00' } }], 'Asia/Shanghai', false),
    ).toEqual([]);
  });

  it('applies relative offsets and skips untimed / done tasks', () => {
    const due = dueReminders(
      [
        {
          ...base,
          id: 'a',
          scheduled: { date: '2026-11-14', time: '15:00' },
          reminders: [{ id: 'r', kind: 'relative', minutesBefore: 30 }],
        },
        {
          ...base,
          id: 'b',
          scheduled: { date: '2026-11-14' },
          reminders: [{ id: 'r', kind: 'relative', minutesBefore: 30 }],
        },
        {
          ...base,
          id: 'c',
          scheduled: { date: '2026-11-14', time: '09:00' },
          completedAt: '2026-11-13T01:00:00Z',
        },
      ],
      'Asia/Shanghai',
      true,
    );
    expect(due.map((d) => [d.task.id, new Date(d.at).toISOString()])).toEqual([
      ['a', '2026-11-14T06:30:00.000Z'],
    ]);
  });

  it('keeps wall-clock time across DST', () => {
    const due = dueReminders(
      [{ ...base, scheduled: { date: '2026-11-02', time: '09:00' } }],
      'America/New_York',
      true,
    );
    expect(new Date(due[0]?.at ?? 0).toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('keys change when the task moves, so a moved task notifies again', () => {
    const [a] = dueReminders([{ ...base, scheduled: { date: '2026-11-14', time: '15:00' } }], 'UTC', true);
    const [b] = dueReminders([{ ...base, scheduled: { date: '2026-11-15', time: '15:00' } }], 'UTC', true);
    expect(a?.key).not.toBe(b?.key);
  });
});
