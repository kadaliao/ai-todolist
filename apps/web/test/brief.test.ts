import { completeTask, createTasks, Replica } from '@ai-todo/core';
import { planBrief, setLocale, upcomingBriefs } from '@ai-todo/shared';
import { beforeAll, describe, expect, it } from 'vitest';

// Saturday 2026-11-14 10:00 in Shanghai.
const NOW = Date.parse('2026-11-14T02:00:00Z');
const tz = 'Asia/Shanghai';

function list() {
  let n = 0;
  const r = new Replica({ deviceId: 'b', timeZone: tz, now: () => NOW, newId: () => `id${++n}` });
  const { result: ids } = r.dispatch(
    createTasks([
      { title: '写周报', scheduled: { date: '2026-11-15' } },
      { title: '给张三打电话', scheduled: { date: '2026-11-15', time: '10:00' }, priority: 3 },
      { title: '交房租', deadline: '2026-11-15' },
      { title: '买菜', scheduled: { date: '2026-11-15' } },
      { title: '回邮件', scheduled: { date: '2026-11-13' } },
      { title: '已完成', scheduled: { date: '2026-11-14' } },
    ]),
  );
  r.dispatch(completeTask(ids[5] as string));
  return r;
}

describe('daily plan and weekly review', () => {
  beforeAll(() => setLocale('zh'));

  it('the plan names the first few, then counts the rest and the overdue', () => {
    expect(planBrief(list().store, '2026-11-15')).toEqual({
      title: '今天 4 件事',
      body: '10:00 给张三打电话、交房租（今天截止）、写周报，还有 1 件；另有 1 件过期',
    });
    expect(planBrief(new Replica({ deviceId: 'e', timeZone: tz }).store, '2026-11-15')).toBeNull();
  });

  it('plans mornings ahead and a Sunday evening look back', () => {
    const briefs = upcomingBriefs(list().store, {
      now: NOW,
      timeZone: tz,
      morning: '08:00',
      evening: '20:00',
      days: 2,
    });
    expect(briefs.map((b) => [b.kind, new Date(b.at).toISOString()])).toEqual([
      ['plan', '2026-11-15T00:00:00.000Z'],
      ['review', '2026-11-15T12:00:00.000Z'],
    ]);
    // Saturday's morning has passed, and Saturday has nothing left but the overdue one: skipped.
  });
});
