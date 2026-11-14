import {
  type AssistantTurn,
  addDays,
  type DayParts,
  endOfMonth,
  isoWeekday,
  type LocalDate,
  parseQuickAdd,
  type Replica,
  type Task,
} from '@ai-todo/core';

/**
 * The assistant's evaluation set: spoken-style requests (mostly Chinese, some with recognition
 * errors), each on a small seeded list, checked against the resulting data rather than the wording.
 * Run by `agent.eval.live.test.ts` against a real model.
 */

export interface SeedTask {
  title: string;
  /** Days from today; omitted = no date. */
  day?: number;
  time?: string;
  /** Deadline, days from today. */
  deadline?: number;
  project?: string;
  section?: string;
  labels?: string[];
  priority?: 0 | 1 | 2 | 3;
  repeat?: string;
  /** Subtask of the task with this title. */
  parent?: string;
  /** Completed this many days ago (0 = today), or on a day last week. */
  doneDaysAgo?: number | 'last-week';
}

export interface Seed {
  projects?: (string | { name: string; sections: string[] })[];
  labels?: string[];
  tasks?: SeedTask[];
  memory?: string[];
  dayParts?: Partial<DayParts>;
  /** Title of the task on screen (“这个”). */
  focus?: string;
}

export interface CheckContext {
  r: Replica;
  today: LocalDate;
  turns: AssistantTurn[];
  last: AssistantTurn;
  /** The first live task whose title matches. */
  task(re: RegExp): Task | undefined;
  open(): Task[];
  /** What the app's parser makes of a phrase, today. */
  P(phrase: string): { date?: LocalDate; time?: string; deadline?: LocalDate };
  d(n: number): LocalDate;
  project(id: string | null): string;
  memory(): string[];
  /** Did the whole conversation call this tool? */
  called(name: string): boolean;
}

export interface EvalCase {
  group: string;
  name: string;
  seed?: Seed;
  say: string[];
  check(c: CheckContext): void;
}

export class CheckFailed extends Error {}

export function ok(cond: unknown, message: string): asserts cond {
  if (!cond) throw new CheckFailed(message);
}

const fmt = (t: Task | undefined) =>
  t ? JSON.stringify({ title: t.title, s: t.scheduled, d: t.deadline, p: t.projectId }) : 'missing';

function on(c: CheckContext, re: RegExp, date: LocalDate | null | undefined, time?: string | null): void {
  const t = c.task(re);
  ok(t, `no task matching ${re}`);
  ok((t.scheduled?.date ?? null) === (date ?? null), `${re}: date ${fmt(t)}, want ${date}`);
  if (time !== undefined) ok((t.scheduled?.time ?? null) === time, `${re}: time ${fmt(t)}, want ${time}`);
}

function status(c: CheckContext, ...want: AssistantTurn['status'][]): void {
  ok(want.includes(c.last.status), `status ${c.last.status} (${c.last.error ?? c.last.reply}), want ${want}`);
}

function unchanged(c: CheckContext): void {
  ok(
    c.turns.every((t) => !t.changes.length),
    `expected no changes, got ${c.turns.flatMap((t) => t.changes.map((x) => x.kind)).join(',')}`,
  );
}

function mentions(c: CheckContext, re: RegExp): void {
  ok(re.test(c.last.reply), `reply “${c.last.reply}” should mention ${re}`);
}

function asked(c: CheckContext): void {
  ok(
    c.last.status === 'answered' && (c.last.options?.length || /[？?]/.test(c.last.reply)),
    `expected a question, got ${c.last.status}: “${c.last.reply}”`,
  );
}

const done = (c: CheckContext, re: RegExp) => {
  const t = c.task(re);
  ok(t?.completedAt, `${re} should be completed: ${fmt(t)}`);
};
const notDone = (c: CheckContext, re: RegExp) => {
  const t = c.task(re);
  ok(t && !t.completedAt, `${re} should be open: ${fmt(t)}`);
};

/** Days back to a day in last week (Monday–Sunday before this week). */
export const lastWeekDaysAgo = (today: LocalDate) => isoWeekday(today) + 2;

export const CASES: EvalCase[] = [
  // --- adding -----------------------------------------------------------------------------------
  {
    group: 'add',
    name: '两件事：明早九点 + 下周五之前',
    say: ['提醒我明早九点给张三打电话 还有下周五之前把房租交了'],
    check(c) {
      status(c, 'applied');
      on(c, /张三/, c.d(1), '09:00');
      ok(c.task(/房租/)?.deadline === c.P('下周五').date, `房租 deadline: ${fmt(c.task(/房租/))}`);
    },
  },
  {
    group: 'add',
    name: '明天下午三点开会',
    say: ['明天下午三点开会'],
    check(c) {
      on(c, /会/, c.d(1), '15:00');
    },
  },
  {
    group: 'add',
    name: '每周一早上九点例会',
    say: ['每周一早上九点例会'],
    check(c) {
      const t = c.task(/例会/);
      ok(t?.recurrence?.rule.includes('BYDAY=MO'), `rule ${t?.recurrence?.rule}`);
      ok(t?.scheduled?.time === '09:00', fmt(t));
    },
  },
  {
    group: 'add',
    name: '没有日期的一件',
    say: ['加个任务 买牛奶'],
    check(c) {
      on(c, /牛奶/, null);
      ok(c.open().length === 1, `${c.open().length} tasks`);
    },
  },
  {
    group: 'add',
    name: '只说晚上：按晚上的时间',
    say: ['提醒我晚上给妈妈打电话'],
    check(c) {
      const t = c.task(/妈妈/);
      ok(t?.scheduled?.time === '20:00', fmt(t));
      ok([c.d(0), c.d(1)].includes(t?.scheduled?.date ?? ''), fmt(t));
    },
  },
  {
    group: 'add',
    name: '明天早上跑步',
    say: ['明天早上跑步'],
    check(c) {
      on(c, /跑步/, c.d(1), '09:00');
    },
  },
  {
    group: 'add',
    name: '后天中午吃饭',
    say: ['后天中午和小王吃饭'],
    check(c) {
      on(c, /小王/, c.d(2), '12:00');
    },
  },
  {
    group: 'add',
    name: '截止日 + 项目',
    seed: { projects: ['工作'] },
    say: ['下周三之前提交报销 放到工作里'],
    check(c) {
      const t = c.task(/报销/);
      ok(t?.deadline === c.P('下周三').date, fmt(t));
      ok(c.project(t?.projectId ?? null) === '工作', fmt(t));
    },
  },
  {
    group: 'add',
    name: '一次加三件',
    say: ['加三件事 买菜 取快递 洗车'],
    check(c) {
      ok(
        c.open().length === 3,
        c
          .open()
          .map((t) => t.title)
          .join(),
      );
      for (const re of [/菜/, /快递/, /洗车/]) ok(c.task(re), `missing ${re}`);
    },
  },
  {
    group: 'add',
    name: '这个周末',
    say: ['这个周末去爬山'],
    check(c) {
      on(c, /爬山/, c.P('这周末').date);
    },
  },
  {
    group: 'add',
    name: 'English',
    say: ['remind me to call mom tomorrow at 3pm'],
    check(c) {
      on(c, /mom/i, c.d(1), '15:00');
    },
  },
  {
    group: 'add',
    name: '高优先级',
    say: ['加一个高优先级的 写季度总结'],
    check(c) {
      ok(c.task(/季度总结/)?.priority === 3, fmt(c.task(/季度总结/)));
    },
  },
  {
    group: 'add',
    name: '提前半小时提醒',
    say: ['明天下午四点开会 提前半小时提醒我'],
    check(c) {
      const t = c.task(/会/);
      ok(t?.scheduled?.time === '16:00', fmt(t));
      ok(
        t?.reminders.some((r) => r.kind === 'relative' && r.minutesBefore === 30),
        JSON.stringify(t?.reminders),
      );
    },
  },
  {
    group: 'add',
    name: '月底前',
    say: ['月底前续签合同'],
    check(c) {
      ok(c.task(/合同/)?.deadline === endOfMonth(c.today), fmt(c.task(/合同/)));
    },
  },
  {
    group: 'add',
    name: '每天晚上十点',
    say: ['每天晚上十点复盘'],
    check(c) {
      const t = c.task(/复盘/);
      ok(t?.recurrence?.rule === 'FREQ=DAILY', `rule ${t?.recurrence?.rule}`);
      ok(t?.scheduled?.time === '22:00', fmt(t));
    },
  },
  {
    group: 'add',
    name: '带标签',
    seed: { labels: ['重要'] },
    say: ['加一个给张三发合同 标签加上重要'],
    check(c) {
      ok(c.task(/合同/)?.labels.length === 1, fmt(c.task(/合同/)));
    },
  },

  // --- completing -------------------------------------------------------------------------------
  {
    group: 'complete',
    name: '听错字：粥报',
    seed: { tasks: [{ title: '写周报', day: 0 }, { title: '买牛奶' }] },
    say: ['粥报已经写完了'],
    check(c) {
      status(c, 'applied');
      done(c, /周报/);
      notDone(c, /牛奶/);
    },
  },
  {
    group: 'complete',
    name: '牛奶买了',
    seed: { tasks: [{ title: '买牛奶' }, { title: '买菜' }] },
    say: ['牛奶买了'],
    check(c) {
      done(c, /牛奶/);
      notDone(c, /菜/);
      ok(!c.called('ask-user'), 'should not ask');
    },
  },
  {
    group: 'complete',
    name: '一句完成两件',
    seed: { tasks: [{ title: '取快递' }, { title: '买菜' }, { title: '洗车' }] },
    say: ['快递取了 菜也买了'],
    check(c) {
      status(c, 'applied');
      done(c, /快递/);
      done(c, /菜/);
      notDone(c, /洗车/);
    },
  },
  {
    group: 'complete',
    name: '今天的都做完了：先确认',
    seed: {
      tasks: [
        { title: '回邮件', day: 0 },
        { title: '整理发票', day: 0 },
        { title: '写日报', day: 0 },
        { title: '明天的事', day: 1 },
      ],
    },
    say: ['今天的都做完了', '好'],
    check(c) {
      ok(c.turns[0]?.answer === '好', `first turn should wait for a yes: ${c.turns[0]?.status}`);
      status(c, 'applied');
      for (const re of [/邮件/, /发票/, /日报/]) done(c, re);
      notDone(c, /明天的事/);
    },
  },
  {
    group: 'complete',
    name: '重复任务打卡',
    seed: { tasks: [{ title: '健身', day: 0, repeat: 'FREQ=DAILY' }] },
    say: ['健身打卡了'],
    check(c) {
      on(c, /健身/, c.d(1));
    },
  },
  {
    group: 'complete',
    name: '这个搞定了',
    seed: { tasks: [{ title: '续签护照' }, { title: '修自行车' }], focus: '修自行车' },
    say: ['这个搞定了'],
    check(c) {
      done(c, /自行车/);
      notDone(c, /护照/);
    },
  },
  {
    group: 'complete',
    name: '重新打开',
    seed: { tasks: [{ title: '写周报', day: 0, doneDaysAgo: 0 }] },
    say: ['周报其实还没写完 重新打开'],
    check(c) {
      notDone(c, /周报/);
    },
  },
  {
    group: 'complete',
    name: '勾掉发票',
    seed: {
      tasks: [
        { title: '整理发票', day: 0 },
        { title: '回邮件', day: 0 },
      ],
    },
    say: ['把发票那个勾掉'],
    check(c) {
      done(c, /发票/);
      notDone(c, /邮件/);
    },
  },
  {
    group: 'complete',
    name: '有截止日的任务完成',
    seed: { tasks: [{ title: '交房租', deadline: 3 }] },
    say: ['房租交了'],
    check(c) {
      done(c, /房租/);
    },
  },
  {
    group: 'complete',
    name: 'English done',
    seed: { tasks: [{ title: 'Write report', day: 0 }, { title: 'Buy milk' }] },
    say: ['I finished the report'],
    check(c) {
      done(c, /report/);
      notDone(c, /milk/);
    },
  },

  // --- rescheduling and times -------------------------------------------------------------------
  {
    group: 'reschedule',
    name: '今天没做完的挪到周四',
    seed: {
      tasks: [
        { title: '回邮件', day: 0 },
        { title: '整理发票', day: 0 },
        { title: '下周的事', day: 9 },
      ],
    },
    say: ['把今天没做完的都挪到周四'],
    check(c) {
      on(c, /邮件/, c.P('周四').date);
      on(c, /发票/, c.P('周四').date);
      on(c, /下周的事/, c.d(9));
    },
  },
  {
    group: 'reschedule',
    name: '只改时间',
    seed: { tasks: [{ title: '和设计团队开会', day: 2, time: '10:00' }] },
    say: ['开会改到下午四点'],
    check(c) {
      on(c, /开会/, c.d(2), '16:00');
    },
  },
  {
    group: 'reschedule',
    name: '推迟一天',
    seed: { tasks: [{ title: '写周报', day: 0 }] },
    say: ['周报推迟一天'],
    check(c) {
      on(c, /周报/, c.d(1));
    },
  },
  {
    group: 'reschedule',
    name: '改到下周一上午十点',
    seed: { tasks: [{ title: '体检', day: 1 }] },
    say: ['体检改到下周一上午十点'],
    check(c) {
      on(c, /体检/, c.P('下周一').date, '10:00');
    },
  },
  {
    group: 'reschedule',
    name: '去掉日期',
    seed: { tasks: [{ title: '买菜', day: 0 }] },
    say: ['买菜那个不用定日期了'],
    check(c) {
      on(c, /菜/, null);
    },
  },
  {
    group: 'reschedule',
    name: '改到明天',
    seed: {
      tasks: [
        { title: '回邮件', day: 0 },
        { title: '写日报', day: 0 },
      ],
    },
    say: ['回邮件改到明天'],
    check(c) {
      on(c, /邮件/, c.d(1));
      on(c, /日报/, c.d(0));
    },
  },
  {
    group: 'reschedule',
    name: '提前十分钟提醒',
    seed: { tasks: [{ title: '给张三打电话', day: 1, time: '09:00' }] },
    say: ['给张三打电话提前十分钟提醒我'],
    check(c) {
      const t = c.task(/张三/);
      ok(
        t?.reminders.some((r) => r.kind === 'relative' && r.minutesBefore === 10),
        JSON.stringify(t?.reminders),
      );
      on(c, /张三/, c.d(1), '09:00');
    },
  },
  {
    group: 'reschedule',
    name: '改重复规则',
    seed: { tasks: [{ title: '例会', day: 0, repeat: 'FREQ=WEEKLY;BYDAY=MO' }] },
    say: ['把例会改成每周二'],
    check(c) {
      const t = c.task(/例会/);
      ok(t?.recurrence?.rule.includes('BYDAY=TU'), `rule ${t?.recurrence?.rule}`);
    },
  },
  {
    group: 'reschedule',
    name: '明天的都挪到后天',
    seed: {
      tasks: [
        { title: '去银行', day: 1 },
        { title: '寄快递', day: 1 },
        { title: '大后天的事', day: 3 },
      ],
    },
    say: ['明天的事都挪到后天'],
    check(c) {
      on(c, /银行/, c.d(2));
      on(c, /寄快递/, c.d(2));
      on(c, /大后天/, c.d(3));
    },
  },
  {
    group: 'reschedule',
    name: '同一时间改到明天',
    seed: { tasks: [{ title: '开会', day: 0, time: '15:00' }] },
    say: ['开会改到明天 时间不变'],
    check(c) {
      on(c, /开会/, c.d(1), '15:00');
    },
  },
  {
    group: 'reschedule',
    name: '加个时间',
    seed: { tasks: [{ title: '去健身', day: 0 }] },
    say: ['健身改成晚上八点'],
    check(c) {
      on(c, /健身/, c.d(0), '20:00');
    },
  },
  {
    group: 'reschedule',
    name: 'English move',
    seed: { tasks: [{ title: 'Dentist', day: 1 }] },
    say: ['move the dentist to next monday'],
    check(c) {
      on(c, /Dentist/, c.P('next monday').date);
    },
  },

  // --- groups and filters -----------------------------------------------------------------------
  {
    group: 'bulk',
    name: '工作里没日期的放到下周（确认）',
    seed: {
      projects: ['工作', '生活'],
      tasks: [
        ...['写方案', '整理文档', '约客户', '更新简历', '看竞品', '交周报'].map((title) => ({
          title,
          project: '工作',
        })),
        { title: '准备评审', project: '工作', day: 3 },
        { title: '买绿植', project: '生活' },
      ],
    },
    say: ['工作里没日期的都放到下周', '好'],
    check(c) {
      ok(c.turns[0]?.answer === '好', `first turn should wait for a yes: ${c.turns[0]?.status}`);
      const want = c.P('下周').date;
      for (const re of [/方案/, /文档/, /客户/, /简历/, /竞品/, /周报/]) on(c, re, want);
      on(c, /评审/, c.d(3));
      on(c, /绿植/, null);
    },
  },
  {
    group: 'bulk',
    name: '过期的都挪到明天',
    seed: {
      tasks: [
        { title: '回邮件', day: -1 },
        { title: '交水费', day: -2 },
        { title: '整理照片', day: -1 },
        { title: '今天的事', day: 0 },
      ],
    },
    say: ['过期的都挪到明天'],
    check(c) {
      for (const re of [/邮件/, /水费/, /照片/]) on(c, re, c.d(1));
      on(c, /今天的事/, c.d(0));
    },
  },
  {
    group: 'bulk',
    name: '收件箱的都放到工作',
    seed: { projects: ['工作'], tasks: [{ title: '写方案' }, { title: '约客户' }, { title: '看竞品' }] },
    say: ['收件箱里的都放到工作项目'],
    check(c) {
      ok(
        c.open().every((t) => c.project(t.projectId) === '工作'),
        c.open().map(fmt).join(' '),
      );
    },
  },
  {
    group: 'bulk',
    name: 'p1 的都改到今天',
    seed: {
      tasks: [
        { title: '季度汇报', day: 3, priority: 3 },
        { title: '续签合同', day: 5, priority: 3 },
        { title: '整理书架', day: 3, priority: 2 },
      ],
    },
    say: ['p1 的都改到今天'],
    check(c) {
      on(c, /汇报/, c.d(0));
      on(c, /合同/, c.d(0));
      on(c, /书架/, c.d(3));
    },
  },
  {
    group: 'bulk',
    name: '项目里的都设成高优先级',
    seed: {
      projects: ['生活', '工作'],
      tasks: [
        { title: '交水费', project: '生活' },
        { title: '买药', project: '生活' },
        { title: '写方案', project: '工作' },
      ],
    },
    say: ['生活项目里的事都设成最高优先级'],
    check(c) {
      ok(c.task(/水费/)?.priority === 3 && c.task(/买药/)?.priority === 3, c.open().map(fmt).join());
      ok(c.task(/方案/)?.priority === 0, fmt(c.task(/方案/)));
    },
  },
  {
    group: 'bulk',
    name: '工作里过期的改到今天',
    seed: {
      projects: ['工作', '生活'],
      tasks: [
        { title: '写方案', project: '工作', day: -2 },
        { title: '约客户', project: '工作', day: -1 },
        { title: '交水费', project: '生活', day: -1 },
      ],
    },
    say: ['把工作里过期的都改到今天'],
    check(c) {
      on(c, /方案/, c.d(0));
      on(c, /客户/, c.d(0));
      on(c, /水费/, c.d(-1));
    },
  },
  {
    group: 'bulk',
    name: '数一数没日期的',
    seed: {
      projects: ['工作'],
      tasks: [
        { title: 'a1' },
        { title: 'a2' },
        { title: 'a3' },
        { title: 'b1', project: '工作' },
        { title: 'b2', project: '工作' },
        { title: 'c1', day: 1 },
      ],
    },
    say: ['没日期的任务有几个'],
    check(c) {
      status(c, 'answered');
      mentions(c, /5|五/);
    },
  },
  {
    group: 'bulk',
    name: '按标签挪',
    seed: {
      labels: ['重要'],
      tasks: [
        { title: '写方案', day: 0, labels: ['重要'] },
        { title: '约客户', day: 0, labels: ['重要'] },
        { title: '买菜', day: 0 },
      ],
    },
    say: ['把带重要标签的都挪到明天'],
    check(c) {
      on(c, /方案/, c.d(1));
      on(c, /客户/, c.d(1));
      on(c, /菜/, c.d(0));
    },
  },
  {
    group: 'bulk',
    name: '只挪下午的',
    seed: {
      tasks: [
        { title: '早会', day: 0, time: '09:00' },
        { title: '评审', day: 0, time: '14:00' },
        { title: '面试', day: 0, time: '16:00' },
      ],
    },
    say: ['把今天下午的事都挪到明天'],
    check(c) {
      on(c, /评审/, c.d(1), '14:00');
      on(c, /面试/, c.d(1), '16:00');
      on(c, /早会/, c.d(0), '09:00');
    },
  },
  {
    group: 'bulk',
    name: '项目里的都完成',
    seed: {
      projects: ['装修', '工作'],
      tasks: [
        { title: '买油漆', project: '装修' },
        { title: '找师傅', project: '装修' },
        { title: '写方案', project: '工作' },
      ],
    },
    say: ['装修里的事都做完了'],
    check(c) {
      done(c, /油漆/);
      done(c, /师傅/);
      notDone(c, /方案/);
    },
  },

  // --- deadlines --------------------------------------------------------------------------------
  {
    group: 'deadline',
    name: '给已有任务设截止',
    seed: { tasks: [{ title: '写报告' }] },
    say: ['报告截止下周一'],
    check(c) {
      const t = c.task(/报告/);
      ok(t?.deadline === c.P('下周一').date, fmt(t));
      ok(c.open().length === 1, 'should not add a task');
    },
  },
  {
    group: 'deadline',
    name: '改截止日',
    seed: { tasks: [{ title: '写方案', deadline: 3 }] },
    say: ['把方案的截止日期改到月底'],
    check(c) {
      ok(c.task(/方案/)?.deadline === endOfMonth(c.today), fmt(c.task(/方案/)));
    },
  },
  {
    group: 'deadline',
    name: '去掉截止日',
    seed: { tasks: [{ title: '交房租', deadline: 5 }] },
    say: ['去掉房租的截止日期'],
    check(c) {
      ok(c.task(/房租/)?.deadline === null, fmt(c.task(/房租/)));
    },
  },
  {
    group: 'deadline',
    name: '计划日 + 截止日',
    say: ['明天开始写方案 下周五截止'],
    check(c) {
      const t = c.task(/方案/);
      ok(t?.scheduled?.date === c.d(1), fmt(t));
      ok(t?.deadline === c.P('下周五').date, fmt(t));
    },
  },
  {
    group: 'deadline',
    name: '问快到截止的',
    seed: {
      tasks: [{ title: '交房租', deadline: 1 }, { title: '续签合同', deadline: 20 }, { title: '买菜' }],
    },
    say: ['有什么快到截止了'],
    check(c) {
      status(c, 'answered');
      mentions(c, /房租/);
    },
  },
  {
    group: 'deadline',
    name: '最晚周三',
    say: ['交物业费 最晚下周三'],
    check(c) {
      ok(c.task(/物业费/)?.deadline === c.P('下周三').date, fmt(c.task(/物业费/)));
    },
  },
  {
    group: 'deadline',
    name: 'English due',
    say: ['thesis draft due next friday'],
    check(c) {
      const t = c.task(/thesis/i);
      ok(t?.deadline === c.P('下周五').date, fmt(t));
    },
  },
  {
    group: 'deadline',
    name: '截止设成明天，计划日不变',
    seed: { tasks: [{ title: '写周报', day: 0 }] },
    say: ['把周报的截止时间设成明天'],
    check(c) {
      const t = c.task(/周报/);
      ok(t?.deadline === c.d(1), fmt(t));
      ok(t?.scheduled?.date === c.d(0), fmt(t));
    },
  },
  {
    group: 'deadline',
    name: '下周一之前',
    say: ['下周一之前 把发票整理好'],
    check(c) {
      ok(c.task(/发票/)?.deadline === c.P('下周一').date, fmt(c.task(/发票/)));
    },
  },
  {
    group: 'deadline',
    name: '计划日不是截止日',
    say: ['周六去超市买菜'],
    check(c) {
      const t = c.task(/超市|买菜/);
      ok(t?.scheduled?.date === c.P('周六').date, fmt(t));
      ok(!t?.deadline, `should have no deadline: ${fmt(t)}`);
    },
  },

  // --- planning and questions -------------------------------------------------------------------
  {
    group: 'plan',
    name: '今天先做什么',
    seed: {
      tasks: [
        { title: '交房租', day: -1 },
        { title: '给张三打电话', day: 0, time: '10:00' },
        { title: '写周报', day: 0, priority: 3 },
        { title: '买菜', day: 0 },
      ],
    },
    say: ['今天先做什么'],
    check(c) {
      status(c, 'answered');
      unchanged(c);
      mentions(c, /房租|张三|周报/);
    },
  },
  {
    group: 'plan',
    name: '安排一下今天（很多事）',
    seed: {
      tasks: [
        '回邮件',
        '写周报',
        '整理发票',
        '约客户',
        '看竞品',
        '更新简历',
        '买菜',
        '交水费',
        '洗车',
        '取快递',
        '读书',
      ].map((title, i) => ({ title, day: 0, ...(i === 1 ? { priority: 3 as const } : {}) })),
    },
    say: ['帮我安排一下今天'],
    check(c) {
      ok(['answered', 'pending'].includes(c.last.status), `status ${c.last.status}`);
      ok(
        c.open().every((t) => t.scheduled?.date === c.d(0)),
        'nothing should move without a yes',
      );
      mentions(c, /周报/);
    },
  },
  {
    group: 'plan',
    name: '今天还有什么',
    seed: {
      tasks: [
        { title: '写周报', day: 0 },
        { title: '去健身', day: 0, time: '19:00' },
      ],
    },
    say: ['今天还有什么事'],
    check(c) {
      status(c, 'answered');
      mentions(c, /周报|健身/);
    },
  },
  {
    group: 'plan',
    name: '明天有什么',
    seed: {
      tasks: [
        { title: '开会', day: 1, time: '15:00' },
        { title: '体检', day: 1 },
        { title: '今天的事', day: 0 },
      ],
    },
    say: ['明天有什么安排'],
    check(c) {
      status(c, 'answered');
      mentions(c, /开会|会|体检/);
    },
  },
  {
    group: 'plan',
    name: '下午有什么会',
    seed: {
      tasks: [
        { title: '产品评审会', day: 0, time: '15:00' },
        { title: '写周报', day: 0 },
      ],
    },
    say: ['下午有什么会'],
    check(c) {
      status(c, 'answered');
      mentions(c, /评审/);
    },
  },
  {
    group: 'plan',
    name: '这周还剩几件',
    seed: {
      tasks: [
        { title: 'a', day: 0 },
        { title: 'b', day: 1 },
        { title: 'c', day: 2 },
      ],
    },
    say: ['这周还有多少事'],
    check(c) {
      status(c, 'answered');
      unchanged(c);
    },
  },
  {
    group: 'plan',
    name: '收件箱里有什么',
    seed: { tasks: [{ title: '买绿植' }, { title: '学吉他' }] },
    say: ['收件箱里有什么'],
    check(c) {
      status(c, 'answered');
      mentions(c, /绿植|吉他/);
    },
  },
  {
    group: 'plan',
    name: '事情是不是太多',
    seed: {
      tasks: Array.from({ length: 12 }, (_, i) => ({ title: `事情${i + 1}`, day: 0 })),
    },
    say: ['我今天是不是事情太多了'],
    check(c) {
      ok(['answered', 'pending'].includes(c.last.status), `status ${c.last.status}`);
      ok(
        c.open().every((t) => t.scheduled?.date === c.d(0)),
        'nothing should move without a yes',
      );
    },
  },
  {
    group: 'plan',
    name: '最紧急的',
    seed: {
      tasks: [
        { title: '续签合同', day: 2, priority: 3 },
        { title: '整理书架', day: 1 },
      ],
    },
    say: ['最紧急的是哪个'],
    check(c) {
      status(c, 'answered');
      mentions(c, /合同/);
    },
  },
  {
    group: 'plan',
    name: '周报是哪天',
    seed: { tasks: [{ title: '写周报', day: 1 }] },
    say: ['周报是哪天的'],
    check(c) {
      status(c, 'answered');
      mentions(c, /明天|周|号|日/);
    },
  },

  // --- looking back -----------------------------------------------------------------------------
  {
    group: 'review',
    name: '这周做了什么',
    seed: {
      tasks: [
        { title: '交季度报告', doneDaysAgo: 0 },
        { title: '面试候选人', doneDaysAgo: 0 },
        { title: '还没做的', day: 2 },
      ],
    },
    say: ['这周做了什么'],
    check(c) {
      status(c, 'answered');
      ok(c.called('review-period'), `tools: ${c.turns.flatMap((t) => t.tools)}`);
      mentions(c, /报告|面试|2|两/);
    },
  },
  {
    group: 'review',
    name: '回顾一下这周',
    seed: {
      tasks: [
        { title: '交季度报告', doneDaysAgo: 0 },
        { title: '续签护照', day: -1 },
      ],
    },
    say: ['回顾一下这周'],
    check(c) {
      status(c, 'answered');
      ok(c.called('review-period'), `tools: ${c.turns.flatMap((t) => t.tools)}`);
    },
  },
  {
    group: 'review',
    name: '昨天完成了哪些',
    seed: {
      tasks: [
        { title: '买牛奶', doneDaysAgo: 1 },
        { title: '今天做的', doneDaysAgo: 0 },
      ],
    },
    say: ['昨天完成了哪些'],
    check(c) {
      status(c, 'answered');
      mentions(c, /牛奶/);
    },
  },
  {
    group: 'review',
    name: '上周干了啥',
    seed: { tasks: [{ title: '面试候选人', doneDaysAgo: 'last-week' }] },
    say: ['上周干了啥'],
    check(c) {
      status(c, 'answered');
      mentions(c, /面试/);
    },
  },
  {
    group: 'review',
    name: '今天完成了几件',
    seed: {
      tasks: [
        { title: 'x1', doneDaysAgo: 0 },
        { title: 'x2', doneDaysAgo: 0 },
        { title: 'x3', day: 0 },
      ],
    },
    say: ['今天完成了几件'],
    check(c) {
      status(c, 'answered');
      mentions(c, /2|两|二/);
    },
  },
  {
    group: 'review',
    name: '这个月完成了多少',
    seed: { tasks: [{ title: 'y1', doneDaysAgo: 0 }] },
    say: ['这个月完成了多少'],
    check(c) {
      status(c, 'answered');
      unchanged(c);
    },
  },

  // --- ambiguity: ask, don't guess --------------------------------------------------------------
  {
    group: 'ask',
    name: '两个张三：问，再按回答做',
    seed: { tasks: [{ title: '给张三打电话' }, { title: '给张三发合同' }] },
    say: ['张三那个做完了'],
    check(c) {
      asked(c);
      notDone(c, /打电话/);
      notDone(c, /合同/);
    },
  },
  {
    group: 'ask',
    name: '回答问题后完成',
    seed: { tasks: [{ title: '给张三打电话' }, { title: '给张三发合同' }] },
    say: ['张三那个做完了', '打电话那个'],
    check(c) {
      done(c, /打电话/);
      notDone(c, /合同/);
    },
  },
  {
    group: 'ask',
    name: '两个评审会',
    seed: {
      tasks: [
        { title: '产品评审会', day: 1, time: '10:00' },
        { title: '设计评审会', day: 2, time: '10:00' },
      ],
    },
    say: ['评审会改到下午四点'],
    check(c) {
      asked(c);
      ok(
        c.open().every((t) => t.scheduled?.time === '10:00'),
        'nothing should change before the answer',
      );
    },
  },
  {
    group: 'ask',
    name: '“那个删掉”没有所指',
    seed: { tasks: [{ title: '买牛奶' }, { title: '取快递' }, { title: '洗车' }] },
    say: ['那个删掉'],
    check(c) {
      ok(c.last.status === 'answered', `status ${c.last.status}`);
      ok(c.open().length === 3, 'nothing deleted');
    },
  },
  {
    group: 'ask',
    name: '买东西那个',
    seed: { tasks: [{ title: '买牛奶' }, { title: '买菜' }] },
    say: ['买东西那个做完了'],
    check(c) {
      asked(c);
      notDone(c, /牛奶/);
      notDone(c, /菜/);
    },
  },
  {
    group: 'ask',
    name: '周报还是月报',
    seed: {
      tasks: [
        { title: '写周报', day: 0 },
        { title: '写月报', day: 0 },
      ],
    },
    say: ['把报告挪到明天'],
    check(c) {
      asked(c);
      on(c, /周报/, c.d(0));
      on(c, /月报/, c.d(0));
    },
  },
  {
    group: 'ask',
    name: '没有匹配的就别乱做',
    seed: { tasks: [{ title: '给张三打电话' }] },
    say: ['李四的电话打了'],
    check(c) {
      notDone(c, /张三/);
    },
  },
  {
    group: 'ask',
    name: '只有一个像就直接做',
    seed: { tasks: [{ title: '给张三打电话' }, { title: '买菜' }] },
    say: ['张三的电话打了'],
    check(c) {
      done(c, /张三/);
      ok(!c.called('ask-user'), 'should not ask');
    },
  },

  // --- memory and preferences -------------------------------------------------------------------
  {
    group: 'memory',
    name: '记住一件事',
    say: ['记住张三是我老板'],
    check(c) {
      ok(
        c.memory().some((m) => /张三/.test(m) && /老板/.test(m)),
        `memory ${JSON.stringify(c.memory())}`,
      );
      ok(c.open().length === 0, 'should not add a task');
    },
  },
  {
    group: 'memory',
    name: '记住一条规则',
    seed: { projects: ['生活', '工作'] },
    say: ['以后健身相关的都放到生活项目'],
    check(c) {
      ok(
        c.memory().some((m) => /健身/.test(m)),
        `memory ${JSON.stringify(c.memory())}`,
      );
    },
  },
  {
    group: 'memory',
    name: '按记住的规则放项目',
    seed: { projects: ['生活', '工作'], memory: ['健身相关的任务放到生活项目'] },
    say: ['加一个明天去健身房'],
    check(c) {
      const t = c.task(/健身/);
      ok(c.project(t?.projectId ?? null) === '生活', fmt(t));
    },
  },
  {
    group: 'memory',
    name: '早上是几点',
    say: ['我说早上一般是指八点'],
    check(c) {
      const v = c.r.store.get('setting', 'dayParts')?.value as Partial<DayParts> | undefined;
      ok(v?.morning === '08:00', `dayParts ${JSON.stringify(v)}`);
    },
  },
  {
    group: 'memory',
    name: '按设置的早上时间',
    seed: { dayParts: { morning: '07:30' } },
    say: ['明天早上跑步'],
    check(c) {
      on(c, /跑步/, c.d(1), '07:30');
    },
  },
  {
    group: 'memory',
    name: '忘掉一条',
    seed: { memory: ['张三是我老板', '周报每周五交'] },
    say: ['忘掉张三那条'],
    check(c) {
      ok(!c.memory().some((m) => /张三/.test(m)), `memory ${JSON.stringify(c.memory())}`);
      ok(
        c.memory().some((m) => /周报/.test(m)),
        `memory ${JSON.stringify(c.memory())}`,
      );
    },
  },
  {
    group: 'memory',
    name: '你记得什么',
    seed: { memory: ['张三是我老板'] },
    say: ['你都记得我哪些事'],
    check(c) {
      status(c, 'answered');
      mentions(c, /老板/);
    },
  },
  {
    group: 'memory',
    name: '晚上是几点',
    say: ['晚上一般指九点'],
    check(c) {
      const v = c.r.store.get('setting', 'dayParts')?.value as Partial<DayParts> | undefined;
      ok(v?.evening === '21:00', `dayParts ${JSON.stringify(v)}`);
    },
  },
  {
    group: 'memory',
    name: '默认项目的记忆',
    seed: { projects: ['工作', '生活'], memory: ['工作上的事默认放到工作项目'] },
    say: ['明天下午三点开项目周会'],
    check(c) {
      const t = c.task(/周会/);
      ok(c.project(t?.projectId ?? null) === '工作', fmt(t));
      on(c, /周会/, c.d(1), '15:00');
    },
  },
  {
    group: 'memory',
    name: '记住作息',
    say: ['记住 我每天九点上班'],
    check(c) {
      ok(
        c.memory().some((m) => /九点|9/.test(m)),
        `memory ${JSON.stringify(c.memory())}`,
      );
    },
  },

  // --- deleting, undo, follow-ups ---------------------------------------------------------------
  {
    group: 'followup',
    name: '删除要确认',
    seed: { tasks: [{ title: '买牛奶' }, { title: '取快递' }] },
    say: ['把买牛奶那条删掉', '好'],
    check(c) {
      ok(c.turns[0]?.answer === '好', `first turn should wait for a yes: ${c.turns[0]?.status}`);
      ok(!c.task(/牛奶/), 'milk should be in the trash');
      ok(c.task(/快递/), 'parcel stays');
    },
  },
  {
    group: 'followup',
    name: '算了',
    seed: { tasks: [{ title: '取快递' }] },
    say: ['删掉取快递', '算了'],
    check(c) {
      status(c, 'cancelled');
      ok(c.task(/快递/), 'still there');
    },
  },
  {
    group: 'followup',
    name: '接着上一句改',
    say: ['加一个买菜', '不对 改成明天晚上'],
    check(c) {
      ok(c.open().length === 1, `${c.open().length} tasks`);
      on(c, /菜/, c.d(1), '20:00');
    },
  },
  {
    group: 'followup',
    name: '撤销',
    say: ['加一个写周报', '撤销'],
    check(c) {
      ok(c.open().length === 0, `${c.open().length} tasks`);
    },
  },
  {
    group: 'followup',
    name: '加任务并拆三步',
    say: ['加一个准备年会的任务 帮我拆成三步'],
    check(c) {
      const parent = c.open().find((t) => !t.parentId && /年会/.test(t.title));
      ok(parent, 'no parent task');
      ok(c.open().filter((t) => t.parentId === parent.id).length >= 2, 'too few subtasks');
    },
  },
  {
    group: 'followup',
    name: '拆已有任务',
    seed: { tasks: [{ title: '准备下周的产品发布会' }] },
    say: ['帮我把发布会这个任务拆一下'],
    check(c) {
      const parent = c.task(/发布会/);
      ok(c.open().filter((t) => t.parentId === parent?.id).length >= 2, 'too few subtasks');
    },
  },
  {
    group: 'followup',
    name: '再加一个',
    say: ['加一个买菜', '再加一个买水果'],
    check(c) {
      ok(
        c.open().length === 2,
        c
          .open()
          .map((t) => t.title)
          .join(),
      );
    },
  },
  {
    group: 'followup',
    name: '改正待确认的删除',
    seed: { tasks: [{ title: '买牛奶' }, { title: '取快递' }] },
    say: ['把买牛奶删了', '不对 是取快递', '好'],
    check(c) {
      ok(!c.task(/快递/), 'parcel should be in the trash');
      ok(c.task(/牛奶/), 'milk stays');
    },
  },

  // --- projects, labels, sections ---------------------------------------------------------------
  {
    group: 'project',
    name: '新建项目并放进任务',
    say: ['新建一个装修项目 把买油漆和找师傅放进去'],
    check(c) {
      const p = c.r.store.all('project').find((x) => /装修/.test(x.name));
      ok(p, 'no project');
      const titles = c
        .open()
        .filter((t) => t.projectId === p.id)
        .map((t) => t.title)
        .join();
      ok(/油漆/.test(titles) && /师傅/.test(titles), titles);
    },
  },
  {
    group: 'project',
    name: '移到已有项目',
    seed: { projects: ['生活'], tasks: [{ title: '去健身' }] },
    say: ['健身放到生活里面'],
    check(c) {
      ok(c.project(c.task(/健身/)?.projectId ?? null) === '生活', fmt(c.task(/健身/)));
      ok(c.r.store.all('project').length === 1, 'no new project');
    },
  },
  {
    group: 'project',
    name: '听错的项目名',
    seed: { projects: ['装修'], tasks: [{ title: '买油漆' }] },
    say: ['买油漆放到装秀项目'],
    check(c) {
      ok(c.project(c.task(/油漆/)?.projectId ?? null) === '装修', fmt(c.task(/油漆/)));
      ok(c.r.store.all('project').length === 1, 'no new project');
    },
  },
  {
    group: 'project',
    name: '这个设成最高优先级',
    seed: { tasks: [{ title: '续签护照' }, { title: '修自行车' }], focus: '修自行车' },
    say: ['这个设成最高优先级'],
    check(c) {
      ok(c.task(/自行车/)?.priority === 3, fmt(c.task(/自行车/)));
      ok(c.task(/护照/)?.priority === 0, fmt(c.task(/护照/)));
    },
  },
  {
    group: 'project',
    name: '加标签',
    seed: { labels: ['重要'], tasks: [{ title: '写周报', day: 0 }] },
    say: ['给周报加个重要标签'],
    check(c) {
      ok(c.task(/周报/)?.labels.length === 1, fmt(c.task(/周报/)));
    },
  },
  {
    group: 'project',
    name: '放进分区',
    seed: {
      projects: [{ name: '工作', sections: ['本周', '以后'] }],
      tasks: [{ title: '写方案', project: '工作' }],
    },
    say: ['把写方案放到工作的本周分区'],
    check(c) {
      const t = c.task(/方案/);
      const sec = t?.sectionId ? c.r.store.get('section', t.sectionId)?.name : null;
      ok(sec === '本周', `section ${sec}`);
    },
  },
  {
    group: 'project',
    name: '改名',
    seed: { tasks: [{ title: '写周报', day: 0 }] },
    say: ['把写周报改名叫写周报和月报'],
    check(c) {
      ok(
        c.task(/月报/),
        c
          .open()
          .map((t) => t.title)
          .join(),
      );
      ok(c.open().length === 1, 'should rename, not add');
    },
  },
  {
    group: 'project',
    name: 'English question',
    seed: { tasks: [{ title: 'Call the bank', day: 0 }] },
    say: ["what's on today"],
    check(c) {
      status(c, 'answered');
      mentions(c, /bank/i);
    },
  },
];

/** Resolve phrases the way the app does (shared by cases). */
export function phrase(
  text: string,
  now: Date,
  timeZone: string,
  dayParts?: DayParts,
): { date?: LocalDate; time?: string; deadline?: LocalDate } {
  const r = parseQuickAdd(text, { now, timeZone, ...(dayParts ? { dayParts } : {}) });
  return {
    ...(r.scheduled ? { date: r.scheduled.date } : {}),
    ...(r.scheduled?.time ? { time: r.scheduled.time } : {}),
    ...(r.deadline ? { deadline: r.deadline } : {}),
  };
}

export { addDays };
