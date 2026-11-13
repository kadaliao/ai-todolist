import { today as todayView } from '@ai-todo/core';
import { getLocale, t, weekdayName } from '@ai-todo/shared';
import { Screen } from '../../components/Screen';
import { TaskRow } from '../../components/TaskRow';
import { Empty, Press, SectionHeader, Txt } from '../../components/ui';
import { rescheduleAllOverdue } from '../../state/actions';
import { useQuery, useToday } from '../../state/replica';
import { useColors } from '../../theme';

export default function TodayScreen() {
  const c = useColors();
  const today = useToday();
  const data = useQuery((s) => todayView(s, today), [today]);
  const [, m, d] = today.split('-').map(Number) as [number, number, number];
  const sub = getLocale() === 'zh' ? `${m}月 · ${weekdayName(today)}` : weekdayName(today);
  return (
    <Screen title={t('nav.today')} numeral={String(d)} sub={sub}>
      {data.overdue.length > 0 && (
        <>
          <SectionHeader
            title={t('today.overdue')}
            tone={c.p1}
            count={data.overdue.length}
            right={
              <Press onPress={rescheduleAllOverdue}>
                <Txt
                  variant="meta"
                  tone={c.jade}
                  style={{ fontWeight: '600', fontSize: 14, paddingVertical: 8 }}
                >
                  {t('today.rescheduleAll')}
                </Txt>
              </Press>
            }
          />
          {data.overdue.map((task) => (
            <TaskRow key={task.id} task={task} today={today} showProject />
          ))}
          <SectionHeader title={t('nav.today')} count={data.today.length} />
        </>
      )}
      {data.today.map((task) => (
        <TaskRow key={task.id} task={task} today={today} showProject showDate={false} />
      ))}
      {!data.today.length && !data.overdue.length && (
        <Empty title={t('today.empty.title')} body={t('today.empty.bodyTouch')} />
      )}
    </Screen>
  );
}
