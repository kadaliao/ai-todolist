import { describe, expect, it } from 'vitest';
import { parseQuickAdd, type QuickAddOptions } from '../src/parser';

/**
 * Quick-add regression corpus. Reference time: Friday 2026-11-13 10:00 in Asia/Shanghai.
 * Each row lists only the fields it asserts; unlisted fields must be absent.
 */

const NOW = new Date('2026-11-13T02:00:00Z');
const BASE: QuickAddOptions = {
  now: NOW,
  timeZone: 'Asia/Shanghai',
  projects: [
    { id: 'p_work', name: '工作' },
    { id: 'p_life', name: '生活' },
    { id: 'p_personal', name: 'Personal' },
    { id: 'p_w', name: 'Work' },
  ],
  sections: [{ id: 's_ideas', name: 'Ideas', projectId: 'p_personal' }],
  labels: [
    { id: 'l_imp', name: '重要' },
    { id: 'l_home', name: 'home' },
  ],
};

interface Case {
  in: string;
  title: string;
  date?: string;
  time?: string;
  duration?: number;
  rule?: string;
  from?: 'completion';
  project?: string;
  projectId?: string;
  section?: string;
  labels?: string[];
  priority?: number;
  ignore?: string[];
}

const cases: Case[] = [
  // --- 中文：相对日期与时间
  { in: '明天下午3点开会', title: '开会', date: '2026-11-14', time: '15:00' },
  { in: '后天交报告', title: '交报告', date: '2026-11-15' },
  { in: '大后天体检', title: '体检', date: '2026-11-16' },
  { in: '今天买牛奶', title: '买牛奶', date: '2026-11-13' },
  { in: '今晚8点看电影', title: '看电影', date: '2026-11-13', time: '20:00' },
  { in: '3天后还书', title: '还书', date: '2026-11-16' },
  { in: '下周五下午三点评审', title: '评审', date: '2026-11-20', time: '15:00' },
  { in: '周一提交周报', title: '提交周报', date: '2026-11-16' },
  { in: '这周日大扫除', title: '大扫除', date: '2026-11-15' },
  { in: '下周一早上9点站会', title: '站会', date: '2026-11-16', time: '09:00' },
  { in: '11月20日交房租', title: '交房租', date: '2026-11-20' },
  { in: '12月1号上午10点面试', title: '面试', date: '2026-12-01', time: '10:00' },
  { in: '下个月5号还信用卡', title: '还信用卡', date: '2026-12-05' },
  { in: '15号交水电费', title: '交水电费', date: '2026-11-15' },
  { in: '十号开会', title: '开会', date: '2026-12-10' },
  { in: '月底写总结', title: '写总结', date: '2026-11-30' },
  { in: '周末去爬山', title: '去爬山', date: '2026-11-14' },
  { in: '下周末聚餐', title: '聚餐', date: '2026-11-21' },
  { in: '下周做计划', title: '做计划', date: '2026-11-16' },
  { in: '下个月体检', title: '体检', date: '2026-12-01' },
  { in: '下午两点打电话', title: '打电话', date: '2026-11-13', time: '14:00' },
  { in: '中午12点吃饭', title: '吃饭', date: '2026-11-13', time: '12:00' },
  { in: '晚上十点复盘', title: '复盘', date: '2026-11-13', time: '22:00' },
  { in: '早上8点半跑步', title: '跑步', date: '2026-11-14', time: '08:30' },
  { in: '4点开会', title: '开会', date: '2026-11-13', time: '16:00' },
  { in: '凌晨5点赶飞机', title: '赶飞机', date: '2026-11-14', time: '05:00' },
  { in: '明天9:30开会', title: '开会', date: '2026-11-14', time: '09:30' },
  { in: '1小时后喝水', title: '喝水', date: '2026-11-13', time: '11:00' },
  { in: '明天下午3点到5点开会', title: '开会', date: '2026-11-14', time: '15:00', duration: 120 },

  // --- 中文：重复
  { in: '每天背单词', title: '背单词', date: '2026-11-13', rule: 'FREQ=DAILY' },
  { in: '每天早上8点吃药', title: '吃药', date: '2026-11-14', time: '08:00', rule: 'FREQ=DAILY' },
  { in: '每天晚上10点复盘', title: '复盘', date: '2026-11-13', time: '22:00', rule: 'FREQ=DAILY' },
  { in: '每周一例会', title: '例会', date: '2026-11-16', rule: 'FREQ=WEEKLY;BYDAY=MO' },
  { in: '每周一三五健身', title: '健身', date: '2026-11-13', rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
  { in: '每周一、三、五健身', title: '健身', date: '2026-11-13', rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
  { in: '每周二和周四上课', title: '上课', date: '2026-11-17', rule: 'FREQ=WEEKLY;BYDAY=TU,TH' },
  { in: '每周一到周五打卡', title: '打卡', date: '2026-11-13', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { in: '每个工作日写日报', title: '写日报', date: '2026-11-13', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { in: '每周末打扫', title: '打扫', date: '2026-11-14', rule: 'FREQ=WEEKLY;BYDAY=SA,SU' },
  { in: '每两周周五发版', title: '发版', date: '2026-11-13', rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR' },
  { in: '每隔一天浇花', title: '浇花', date: '2026-11-13', rule: 'FREQ=DAILY;INTERVAL=2' },
  { in: '每3天换水', title: '换水', date: '2026-11-13', rule: 'FREQ=DAILY;INTERVAL=3' },
  { in: '每月15号还房贷', title: '还房贷', date: '2026-11-15', rule: 'FREQ=MONTHLY;BYMONTHDAY=15' },
  { in: '每月最后一天对账', title: '对账', date: '2026-11-30', rule: 'FREQ=MONTHLY;BYMONTHDAY=-1' },
  { in: '每月底交报销', title: '交报销', date: '2026-11-30', rule: 'FREQ=MONTHLY;BYMONTHDAY=-1' },
  {
    in: '每月31号发工资',
    title: '发工资',
    date: '2026-11-30',
    rule: 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1',
  },
  { in: '每三个月体检', title: '体检', date: '2026-11-13', rule: 'FREQ=MONTHLY;INTERVAL=3' },
  { in: '每年3月8日送花', title: '送花', date: '2027-03-08', rule: 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=8' },
  {
    in: '完成后每3天给植物浇水',
    title: '给植物浇水',
    date: '2026-11-13',
    rule: 'FREQ=DAILY;INTERVAL=3',
    from: 'completion',
  },
  { in: '每周一下午3点周会', title: '周会', date: '2026-11-16', time: '15:00', rule: 'FREQ=WEEKLY;BYDAY=MO' },
  { in: '每周一次大扫除', title: '大扫除', date: '2026-11-13', rule: 'FREQ=WEEKLY' },
  { in: '每周一早上健身', title: '健身', date: '2026-11-16', rule: 'FREQ=WEEKLY;BYDAY=MO' },
  { in: '每天晚上背单词', title: '背单词', date: '2026-11-13', rule: 'FREQ=DAILY' },
  { in: '每周一 从下周开始 例会', title: '例会', date: '2026-11-16', rule: 'FREQ=WEEKLY;BYDAY=MO' },
  {
    in: 'Gym every monday 7am',
    title: 'Gym',
    date: '2026-11-16',
    time: '07:00',
    rule: 'FREQ=WEEKLY;BYDAY=MO',
  },
  { in: '周五之前交房租', title: '交房租', date: '2026-11-13' },
  { in: '下周三前提交报销', title: '提交报销', date: '2026-11-18' },
  { in: 'Pay rent by friday', title: 'Pay rent', date: '2026-11-13' },
  { in: 'Report due next fri', title: 'Report', date: '2026-11-20' },

  // --- English
  { in: 'Call mom tomorrow 3pm', title: 'Call mom', date: '2026-11-14', time: '15:00' },
  { in: 'Pay rent next fri', title: 'Pay rent', date: '2026-11-20' },
  { in: 'Submit report in 3 days', title: 'Submit report', date: '2026-11-16' },
  { in: 'Dentist dec 1 at 10am', title: 'Dentist', date: '2026-12-01', time: '10:00' },
  { in: 'Gym every mon, wed and fri', title: 'Gym', date: '2026-11-13', rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
  {
    in: 'Standup every weekday at 9am',
    title: 'Standup',
    date: '2026-11-16',
    time: '09:00',
    rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  },
  {
    in: 'Water plants every 3 days',
    title: 'Water plants',
    date: '2026-11-13',
    rule: 'FREQ=DAILY;INTERVAL=3',
  },
  { in: 'Review every other week', title: 'Review', date: '2026-11-13', rule: 'FREQ=WEEKLY;INTERVAL=2' },
  { in: 'Pay bills every 15th', title: 'Pay bills', date: '2026-11-15', rule: 'FREQ=MONTHLY;BYMONTHDAY=15' },
  {
    in: 'Change filter every! 2 months',
    title: 'Change filter',
    date: '2026-11-13',
    rule: 'FREQ=MONTHLY;INTERVAL=2',
    from: 'completion',
  },
  {
    in: 'Weekly report every friday',
    title: 'Weekly report',
    date: '2026-11-13',
    rule: 'FREQ=WEEKLY;BYDAY=FR',
  },

  // --- 前缀 token
  {
    in: '写周报 #工作 @重要 p1 明天',
    title: '写周报',
    project: '工作',
    projectId: 'p_work',
    labels: ['l_imp'],
    priority: 3,
    date: '2026-11-14',
  },
  { in: '买菜#生活', title: '买菜', project: '生活', projectId: 'p_life' },
  { in: '#工作写周报', title: '写周报', project: '工作', projectId: 'p_work' },
  { in: '订机票 !2', title: '订机票', priority: 2 },
  { in: '订机票 ！1', title: '订机票', priority: 3 },
  { in: '整理 #新项目', title: '整理', project: '新项目' },
  {
    in: 'Plan trip #Personal /Ideas',
    title: 'Plan trip',
    project: 'Personal',
    projectId: 'p_personal',
    section: 's_ideas',
  },
  { in: 'Review #work', title: 'Review', project: 'Work', projectId: 'p_w' },
  { in: 'Plan #workshop', title: 'Plan', project: 'workshop' },
  { in: '打扫 @home @Home', title: '打扫', labels: ['l_home'] },

  // --- 不该识别的
  { in: '学习 C# 编程', title: '学习 C# 编程' },
  { in: 'email a@b.com about it', title: 'email a@b.com about it' },
  { in: 'Fix issue#12', title: 'Fix issue#12' },
  { in: 'Read 1/2 of the book', title: 'Read 1/2 of the book' },
  { in: '买3个苹果', title: '买3个苹果' },
  { in: '3 个苹果', title: '3 个苹果' },
  { in: 'Call May', title: 'Call May' },
  { in: 'buy 2 apples', title: 'buy 2 apples' },
  { in: '第2章笔记', title: '第2章笔记' },
  { in: '读《三体》', title: '读《三体》' },
  { in: '每个人都要交', title: '每个人都要交' },
  { in: '坐3号线去公司', title: '坐3号线去公司' },
  { in: '买5号电池', title: '买5号电池' },
  { in: 'top1 priority', title: 'top1 priority' },

  // --- 用户点掉的识别
  { in: '明天下午3点开会', ignore: ['明天下午3点'], title: '明天下午3点开会' },
  { in: '写周报 #工作', ignore: ['#工作'], title: '写周报 #工作' },
  { in: '每天背单词', ignore: ['每天'], title: '每天背单词' },
];

describe('quick-add corpus', () => {
  it('has at least 60 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
  });

  for (const c of cases) {
    it(c.ignore ? `${c.in} (ignore ${c.ignore.join(',')})` : c.in, () => {
      const r = parseQuickAdd(c.in, { ...BASE, ...(c.ignore ? { ignore: c.ignore } : {}) });
      expect({
        title: r.title,
        date: r.scheduled?.date,
        time: r.scheduled?.time,
        duration: r.scheduled?.duration,
        rule: r.recurrence?.rule,
        from: r.recurrence?.from === 'completion' ? 'completion' : undefined,
        project: r.project?.name,
        projectId: r.project?.id,
        section: r.section?.id,
        labels: r.labels.length ? r.labels.map((l) => l.id ?? l.name) : undefined,
        priority: r.priority,
      }).toEqual({
        title: c.title,
        date: c.date,
        time: c.time,
        duration: c.duration,
        rule: c.rule,
        from: c.from,
        project: c.project,
        projectId: c.projectId,
        section: c.section,
        labels: c.labels,
        priority: c.priority,
      });
    });
  }
});

describe('quick-add tokens', () => {
  it('reports ranges for highlighting', () => {
    const input = '明天下午3点开会 #工作 p2';
    const r = parseQuickAdd(input, BASE);
    expect(r.tokens.map((t) => [t.kind, t.text, input.slice(t.start, t.end)])).toEqual([
      ['date', '明天下午3点', '明天下午3点'],
      ['project', '#工作', '#工作'],
      ['priority', 'p2', 'p2'],
    ]);
  });

  it('recurrence and its time are separate tokens', () => {
    const r = parseQuickAdd('每周一下午3点周会', BASE);
    expect(r.tokens.map((t) => [t.kind, t.text])).toEqual([
      ['recurrence', '每周一'],
      ['date', '下午3点'],
    ]);
  });

  it('does not depend on the process time zone', () => {
    // 2026-11-13 23:30 in Shanghai is still the 13th there, though already the 14th in UTC+14.
    const late = parseQuickAdd('明天开会', { ...BASE, now: new Date('2026-11-13T15:30:00Z') });
    expect(late.scheduled?.date).toBe('2026-11-14');
    const ny = parseQuickAdd('明天开会', { ...BASE, timeZone: 'America/New_York' });
    expect(ny.scheduled?.date).toBe('2026-11-13'); // it's 21:00 on the 12th in New York
  });

  it('a bare weekday naming today means today at any time of day', () => {
    for (const hour of ['01:00', '10:00', '15:00', '23:30']) {
      const now = new Date(`2026-11-13T${hour}:00+08:00`);
      expect(parseQuickAdd('周五交房租', { ...BASE, now }).scheduled?.date, hour).toBe('2026-11-13');
      expect(parseQuickAdd('下周五交房租', { ...BASE, now }).scheduled?.date, hour).toBe('2026-11-20');
    }
  });

  it('is fast', () => {
    const inputs = cases.map((c) => c.in);
    parseQuickAdd(inputs[0] as string, BASE); // warm up
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) for (const s of inputs) parseQuickAdd(s, BASE);
    const perCall = (performance.now() - t0) / (inputs.length * 5);
    expect(perCall).toBeLessThan(10);
  });
});
