import { addDays, upcoming } from '@ai-todo/core';
import { daysBetween, formatDay, getLocale, t, weekdayName } from '@ai-todo/shared';
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { TaskRow } from '../../components/TaskRow';
import { Press, Txt } from '../../components/ui';
import { useQuery, useToday } from '../../state/replica';
import { fonts, useColors } from '../../theme';

export default function UpcomingScreen() {
  const c = useColors();
  const today = useToday();
  const [days, setDays] = useState(21);
  const buckets = useQuery((s) => upcoming(s, today, days), [today, days]);
  return (
    <Screen title={t('nav.upcoming')}>
      {buckets.map((b) => {
        const diff = daysBetween(today, b.date);
        const [, m, d] = b.date.split('-').map(Number) as [number, number, number];
        const empty = !b.tasks.length;
        return (
          <View key={b.date} style={{ marginTop: empty ? 4 : 14 }}>
            <View style={[styles.day, { borderBottomColor: c.line }]}>
              <Txt style={[styles.num, { color: diff === 0 ? c.jade : empty ? c.ink3 : c.ink }]}>{d}</Txt>
              <Txt variant="section" tone={diff === 0 ? c.jade : empty ? c.ink3 : c.ink}>
                {diff <= 1 ? formatDay(b.date, today) : weekdayName(b.date)}
              </Txt>
              {diff > 1 && (
                <Txt variant="meta">
                  {getLocale() === 'zh' ? `${m}月${d}日` : formatDay(b.date, addDays(b.date, -400))}
                </Txt>
              )}
              <View style={{ flex: 1 }} />
              <Press
                onPress={() => router.push({ pathname: '/add', params: { date: b.date } })}
                accessibilityLabel={t('qa.placeholderShort')}
              >
                <View style={styles.add}>
                  <Plus size={18} color={c.ink3} />
                </View>
              </Press>
            </View>
            {b.tasks.map((task) => (
              <TaskRow key={task.id} task={task} today={today} showProject showDate={false} />
            ))}
          </View>
        );
      })}
      <Press onPress={() => setDays((n) => n + 21)}>
        <Txt variant="label" tone={c.jade} style={{ padding: 20, fontWeight: '600' }}>
          {getLocale() === 'zh' ? '显示更多日期' : 'Show more days'}
        </Txt>
      </Press>
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    marginHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  num: { fontFamily: fonts.display, fontSize: 20, letterSpacing: -0.4, minWidth: 26 },
  add: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
