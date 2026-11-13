import { addDays, isoWeekday, parseQuickAdd, todayIn } from '@ai-todo/core';
import { describe, expect, it } from 'vitest';
import { Ai, type AiContext } from '../src/ai';
import { loadConfig } from '../src/config';

/**
 * Live evaluation against the configured model (skipped without DOCKET_AI_* env):
 *   DOCKET_AI_BASE_URL=… DOCKET_AI_API_KEY=… DOCKET_AI_MODEL=… pnpm --filter @ai-todo/server eval
 *
 * Checks what matters to users: the right number of tasks, sensible titles, and — through the
 * app's own parser — the right dates. The model never sees "the answer"; dates are computed
 * locally from the phrases it returns.
 */

const config = loadConfig();
const live = config.ai ? describe : describe.skip;
const tz = 'Asia/Shanghai';
const today = todayIn(new Date(), tz);
const nextWeekday = (iso: number) => addDays(today, (iso - isoWeekday(today) + 7) % 7 || 7);
const ctx: AiContext = {
  today,
  timeZone: tz,
  locale: 'zh-CN',
  projects: ['工作', '生活'],
  labels: ['重要', '家里'],
};

function dateOf(when: string | undefined): { date?: string; time?: string; rule?: string } {
  if (!when) return {};
  const r = parseQuickAdd(when, { now: new Date(), timeZone: tz });
  return { date: r.scheduled?.date, time: r.scheduled?.time, rule: r.recurrence?.rule };
}

interface Expect {
  title: RegExp;
  date?: string;
  time?: string;
  rule?: string;
  project?: string;
}

const cases: { name: string; text: string; expect: Expect[] }[] = [
  {
    name: 'mixed Chinese brain dump',
    text: '明天上午先把周报写完，下午三点和设计团队评审新版首页。周五之前记得交房租！还有以后每周一早上去健身。',
    expect: [
      { title: /周报/, date: addDays(today, 1) },
      { title: /评审/, date: addDays(today, 1), time: '15:00' },
      { title: /房租/, date: nextWeekday(5) },
      { title: /健身/, rule: 'FREQ=WEEKLY;BYDAY=MO' },
    ],
  },
  {
    name: 'English with a project',
    text: 'Need to email Sarah the contract tomorrow at 10am for work, buy groceries tonight, and renew my passport sometime next month.',
    expect: [
      { title: /contract|Sarah/i, date: addDays(today, 1), time: '10:00', project: '工作' },
      { title: /groceries/i, date: today },
      { title: /passport/i },
    ],
  },
  {
    name: 'no actions at all',
    text: '今天好累啊，天气也不好，心情一般般。',
    expect: [],
  },
  {
    name: 'dictation with filler words',
    text: '嗯那个，后天要去医院复查，然后呢，嗯，提醒我给妈妈打个电话，就今晚八点吧',
    expect: [
      { title: /复查|医院/, date: addDays(today, 2) },
      { title: /妈妈|电话/, date: today, time: '20:00' },
    ],
  },
];

live('AI extraction (live model)', () => {
  const ai = config.ai ? new Ai(config.ai) : (null as unknown as Ai);

  for (const c of cases) {
    it(c.name, { timeout: 60_000 }, async () => {
      const tasks = [];
      for await (const t of ai.extract(c.text, ctx)) tasks.push(t);
      const summary = tasks.map((t) => ({
        title: t.title,
        when: t.when,
        project: t.project,
        ...dateOf(t.when),
      }));
      console.info(c.name, JSON.stringify(summary, null, 1));
      expect(tasks.length).toBe(c.expect.length);
      c.expect.forEach((e, i) => {
        const got = summary[i];
        expect(got?.title).toMatch(e.title);
        if (e.date) expect(got?.date).toBe(e.date);
        if (e.time) expect(got?.time).toBe(e.time);
        if (e.rule) expect(got?.rule).toBe(e.rule);
        if (e.project) expect(got?.project).toBe(e.project);
      });
    });
  }

  it('breaks a task into a few concrete steps', { timeout: 60_000 }, async () => {
    const steps = [];
    for await (const s of ai.breakdown({ title: '准备下周的产品发布会', notes: '', existing: [] }, ctx))
      steps.push(s.title);
    console.info('breakdown', steps);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(7);
    expect(steps.every((s) => s.length < 40)).toBe(true);
  });
});
