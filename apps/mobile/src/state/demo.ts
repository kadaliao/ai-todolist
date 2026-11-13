import {
  addDays,
  createLabel,
  createProject,
  createSection,
  createTask,
  isoWeekday,
  type Replica,
  todayIn,
} from '@ai-todo/core';
import { getLocale } from '@ai-todo/shared';

/**
 * Realistic sample data for store screenshots and demos (development only; never shipped as
 * user data). Loaded with `?demo=1` on the web preview or `-docketDemo YES` on iOS.
 */
export function seedDemo(r: Replica): void {
  const zh = getLocale() === 'zh';
  const today = todayIn(new Date(), r.timeZone);
  const d = (n: number) => addDays(today, n);
  const monday = addDays(today, (8 - isoWeekday(today)) % 7 || 7);
  const opts = { undoable: false } as const;
  const run = <T>(cmd: Parameters<Replica['dispatch']>[0]) => r.dispatch(cmd, opts).result as T;

  const work = run<string>(createProject({ name: zh ? '工作' : 'Work', color: '#3d6fd9' }));
  const home = run<string>(createProject({ name: zh ? '生活' : 'Home', color: '#1f8f6a' }));
  const trip = run<string>(createProject({ name: zh ? '京都旅行' : 'Kyoto trip', color: '#e0731d' }));
  const launch = run<string>(createSection({ projectId: work, name: zh ? '新版发布' : 'Launch' }));
  const urgent = run<string>(createLabel({ name: zh ? '重要' : 'urgent', color: '#d64545' }));
  const errands = run<string>(createLabel({ name: zh ? '跑腿' : 'errands', color: '#dd8f12' }));

  const tasks = zh
    ? [
        {
          title: '和设计团队评审新版首页',
          projectId: work,
          sectionId: launch,
          scheduled: { date: today, time: '15:00' },
          priority: 3 as const,
          labels: [urgent],
        },
        {
          title: '回复客户关于合同的邮件',
          projectId: work,
          scheduled: { date: today, time: '10:30' },
          priority: 2 as const,
        },
        { title: '买牛奶和咖啡豆', projectId: home, scheduled: { date: today }, labels: [errands] },
        { title: '写本周周报', projectId: work, scheduled: { date: d(-1) }, priority: 1 as const },
        { title: '给妈妈打电话', scheduled: { date: today, time: '20:00' } },
        { title: '订京都的酒店', projectId: trip, scheduled: { date: d(2) }, priority: 2 as const },
        {
          title: '准备发布会演讲稿',
          projectId: work,
          sectionId: launch,
          scheduled: { date: d(3), time: '09:00' },
          notes: '控制在 12 分钟以内，先讲一个用户故事。',
        },
        { title: '交房租', projectId: home, scheduled: { date: d(4) }, labels: [urgent] },
        { title: '办理护照续期', projectId: trip },
        { title: '读完《设计中的设计》', projectId: home },
      ]
    : [
        {
          title: 'Review the new homepage with design',
          projectId: work,
          sectionId: launch,
          scheduled: { date: today, time: '15:00' },
          priority: 3 as const,
          labels: [urgent],
        },
        {
          title: 'Reply to the client about the contract',
          projectId: work,
          scheduled: { date: today, time: '10:30' },
          priority: 2 as const,
        },
        {
          title: 'Buy milk and coffee beans',
          projectId: home,
          scheduled: { date: today },
          labels: [errands],
        },
        {
          title: 'Write the weekly report',
          projectId: work,
          scheduled: { date: d(-1) },
          priority: 1 as const,
        },
        { title: 'Call mom', scheduled: { date: today, time: '20:00' } },
        {
          title: 'Book the hotel in Kyoto',
          projectId: trip,
          scheduled: { date: d(2) },
          priority: 2 as const,
        },
        {
          title: 'Draft the launch keynote',
          projectId: work,
          sectionId: launch,
          scheduled: { date: d(3), time: '09:00' },
          notes: 'Keep it under 12 minutes; open with a user story.',
        },
        { title: 'Pay rent', projectId: home, scheduled: { date: d(4) }, labels: [urgent] },
        { title: 'Renew passport', projectId: trip },
        { title: 'Finish reading “Designing Design”', projectId: home },
      ];
  for (const t of tasks) r.dispatch(createTask(t), opts);
  const keynote = r.store.all('task').find((t) => t.notes);
  if (keynote) {
    for (const s of zh
      ? ['列提纲', '准备演示数据', '彩排一次']
      : ['Outline', 'Prepare demo data', 'Rehearse once']) {
      r.dispatch(createTask({ title: s, parentId: keynote.id }), opts);
    }
  }
  r.dispatch(
    createTask({
      title: zh ? '检查这一周的计划' : 'Plan the week',
      projectId: work,
      scheduled: { date: monday, time: '09:00' },
      recurrence: { rule: 'FREQ=WEEKLY;BYDAY=MO' },
    }),
    opts,
  );
  r.dispatch(
    createTask({
      title: zh ? '健身' : 'Gym',
      projectId: home,
      scheduled: { date: d(1), time: '19:00' },
      recurrence: { rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
    }),
    opts,
  );
}
