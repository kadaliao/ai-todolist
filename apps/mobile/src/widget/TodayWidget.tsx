import { FlexWidget, ListWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import { palette } from '../theme';
import { localDay, type WidgetSnapshot, type WidgetTask, widgetDays } from './model';

/** Android home-screen widget: today and overdue at a glance, a circle to check each task off. */

type Hex = `#${string}`;

const CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const MIC =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="#FFFFFF"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/></svg>';
const PLUS =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round"/></svg>';

function strings(locale: string) {
  const zh = locale.startsWith('zh');
  return {
    today: zh ? '今天' : 'Today',
    overdue: zh ? '已过期' : 'Overdue',
    tomorrow: zh ? '明天' : 'Tomorrow',
    yesterday: zh ? '昨天' : 'Yesterday',
    allClear: zh ? '今天没有任务了' : 'All clear today',
    hint: zh ? '点 + 添加新任务' : 'Tap + to add a task',
    talk: zh ? '跟 Docket 说' : 'Talk to Docket',
    openApp: zh ? '打开 Docket 开始使用' : 'Open Docket to get started',
    remaining: (n: number) => (zh ? `${n} 项待办` : n === 1 ? '1 task' : `${n} tasks`),
    weekday: (d: Date) =>
      zh ? `周${'日一二三四五六'[d.getDay()]}` : d.toLocaleDateString('en-US', { weekday: 'short' }),
    monthDay: (date: string) => {
      const [, m = 1, d = 1] = date.split('-').map(Number);
      return zh ? `${m}月${d}日` : `${'JanFebMarAprMayJunJulAugSepOctNovDec'.slice((m - 1) * 3, m * 3)} ${d}`;
    },
    time: (hhmm: string) => {
      if (zh) return hhmm;
      const [h, m] = hhmm.split(':').map(Number) as [number, number];
      return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    },
  };
}

export interface TodayWidgetProps {
  snapshot: WidgetSnapshot | null;
  done: readonly string[];
  now: Date;
  dark: boolean;
}

export function TodayWidget({ snapshot, done, now, dark }: TodayWidgetProps) {
  const c = palette[dark ? 'dark' : 'light'];
  const s = strings(snapshot?.locale ?? 'en');
  const days = snapshot ? widgetDays(snapshot, now) : { overdue: [], today: [], tomorrow: [] };
  const due = [...days.overdue, ...days.today];
  const remaining = due.filter((t) => !done.includes(t.id)).length;
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const priorityColor = (p: number) => (p === 3 ? c.p1 : p === 2 ? c.p2 : p === 1 ? c.p3 : c.ink3) as Hex;

  const row = (t: WidgetTask, kind: 'overdue' | 'today' | 'tomorrow') => {
    const checked = done.includes(t.id);
    const meta =
      kind === 'overdue'
        ? t.date === yesterday
          ? s.yesterday
          : s.monthDay(t.date)
        : [t.time ? s.time(t.time) : null, t.project].filter(Boolean).join(' · ');
    return (
      <FlexWidget
        key={t.id}
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 9,
          borderBottomWidth: 1,
          borderBottomColor: c.line as Hex,
        }}
      >
        <FlexWidget
          clickAction="TOGGLE"
          clickActionData={{ id: t.id }}
          accessibilityLabel={t.title}
          style={{ padding: 4, marginLeft: -4 }}
        >
          <FlexWidget
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              borderWidth: checked ? 0 : 2,
              borderColor: priorityColor(t.priority),
              backgroundColor: (checked ? c.jade : c.surface) as Hex,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {checked ? <SvgWidget svg={CHECK} style={{ width: 12, height: 12 }} /> : null}
          </FlexWidget>
        </FlexWidget>
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: `docket://task/${t.id}` }}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}
        >
          <FlexWidget style={{ flex: 1 }}>
            <TextWidget
              text={t.title}
              maxLines={1}
              truncate="END"
              style={{
                fontSize: 14,
                color: (checked ? c.ink3 : kind === 'tomorrow' ? c.ink2 : c.ink) as Hex,
              }}
            />
          </FlexWidget>
          {meta ? (
            <TextWidget
              text={meta}
              maxLines={1}
              style={{
                marginLeft: 8,
                fontSize: 11,
                color: (kind === 'overdue' && !checked ? c.p1 : c.ink3) as Hex,
              }}
            />
          ) : null}
        </FlexWidget>
      </FlexWidget>
    );
  };

  const section = (label: string, color: string) => (
    <FlexWidget key={`h-${label}`} style={{ width: 'match_parent', paddingTop: 8, paddingBottom: 2 }}>
      <TextWidget text={label} style={{ fontSize: 12, fontWeight: '600', color: color as Hex }} />
    </FlexWidget>
  );

  const rows = [
    ...(days.overdue.length ? [section(s.overdue, c.p1), ...days.overdue.map((t) => row(t, 'overdue'))] : []),
    ...(days.overdue.length && days.today.length ? [section(s.today, c.ink2)] : []),
    ...days.today.map((t) => row(t, 'today')),
    ...(days.tomorrow.length
      ? [section(s.tomorrow, c.ink3), ...days.tomorrow.map((t) => row(t, 'tomorrow'))]
      : []),
  ];

  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        flexDirection: 'column',
        backgroundColor: c.surface as Hex,
        borderRadius: 24,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
      }}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget clickAction="OPEN_APP" style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          <TextWidget
            text={String(now.getDate())}
            style={{ fontSize: 30, fontFamily: 'BricolageGrotesque_700Bold', color: c.jade as Hex }}
          />
          <FlexWidget style={{ marginLeft: 10, flexDirection: 'column' }}>
            <TextWidget text={s.today} style={{ fontSize: 15, fontWeight: '700', color: c.ink as Hex }} />
            <TextWidget
              text={due.length ? `${s.weekday(now)} · ${s.remaining(remaining)}` : s.weekday(now)}
              style={{ fontSize: 11, color: c.ink3 as Hex }}
            />
          </FlexWidget>
        </FlexWidget>
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: 'docket://voice' }}
          accessibilityLabel={s.talk}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: c.jade as Hex,
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 8,
          }}
        >
          <SvgWidget svg={MIC} style={{ width: 18, height: 18 }} />
        </FlexWidget>
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: 'docket://add' }}
          accessibilityLabel={s.hint}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: c.jade as Hex,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <SvgWidget svg={PLUS} style={{ width: 18, height: 18 }} />
        </FlexWidget>
      </FlexWidget>
      {rows.length ? (
        <ListWidget style={{ height: 'match_parent', width: 'match_parent', marginTop: 4 }}>
          {rows}
        </ListWidget>
      ) : (
        <FlexWidget
          clickAction="OPEN_APP"
          style={{ width: 'match_parent', height: 'match_parent', justifyContent: 'center' }}
        >
          <TextWidget
            text={snapshot ? s.allClear : s.openApp}
            style={{ fontSize: 14, fontWeight: '600', color: c.ink as Hex }}
          />
          {snapshot ? <TextWidget text={s.hint} style={{ fontSize: 12, color: c.ink3 as Hex }} /> : null}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
