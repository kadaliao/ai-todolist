import { addDays, isoWeekday } from '@ai-todo/core';
import { monthGrid, monthTitle, t, weekdayName } from '@ai-todo/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarDays, ChevronLeft, ChevronRight, Sofa, Sun, SunMedium, X } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../components/ui';
import { schedule } from '../state/actions';
import { useQuery, useToday } from '../state/replica';
import { useColors } from '../theme';

export default function ScheduleSheet() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { ids: idParam } = useLocalSearchParams<{ ids: string }>();
  const ids = (idParam ?? '').split(',').filter(Boolean);
  const today = useToday();
  const current = useQuery(
    (s) => (ids[0] ? s.get('task', ids[0])?.scheduled?.date : undefined) ?? null,
    [idParam],
  );
  const [cursor, setCursor] = useState(() => {
    const [y, m] = (current ?? today).split('-').map(Number) as [number, number];
    return { y, m };
  });
  const pick = (d: string | null) => {
    router.back();
    setTimeout(() => void schedule(ids, d), 250);
  };
  const weekend = addDays(today, Math.max(0, 6 - isoWeekday(today)));
  const nextWeek = addDays(today, 8 - isoWeekday(today));
  const shift = (k: number) => {
    const idx = cursor.y * 12 + cursor.m - 1 + k;
    setCursor({ y: Math.floor(idx / 12), m: (idx % 12) + 1 });
  };
  const days = monthGrid(cursor.y, cursor.m);
  return (
    <View style={{ backgroundColor: c.surface, paddingTop: 18, paddingBottom: Math.max(insets.bottom, 16) }}>
      <Option
        icon={<Sun size={20} color={c.jade} />}
        label={t('date.today')}
        hint={weekdayName(today)}
        onPress={() => pick(today)}
      />
      <Option
        icon={<SunMedium size={20} color={c.p2} />}
        label={t('date.tomorrow')}
        hint={weekdayName(addDays(today, 1))}
        onPress={() => pick(addDays(today, 1))}
      />
      <Option
        icon={<Sofa size={20} color={c.p3} />}
        label={t('date.thisWeekend')}
        hint={weekdayName(weekend)}
        onPress={() => pick(weekend)}
      />
      <Option
        icon={<CalendarDays size={20} color={c.purple} />}
        label={t('date.nextWeek')}
        hint={weekdayName(nextWeek)}
        onPress={() => pick(nextWeek)}
      />
      {current ? (
        <Option icon={<X size={20} color={c.ink3} />} label={t('date.none')} onPress={() => pick(null)} />
      ) : null}
      <View style={[styles.cal, { borderTopColor: c.line }]}>
        <View style={styles.calHead}>
          <Txt variant="section">{monthTitle(cursor.y, cursor.m)}</Txt>
          <View style={{ flexDirection: 'row' }}>
            <Pressable
              onPress={() => shift(-1)}
              hitSlop={10}
              style={styles.nav}
              accessibilityLabel="Previous month"
            >
              <ChevronLeft size={20} color={c.ink2} />
            </Pressable>
            <Pressable
              onPress={() => shift(1)}
              hitSlop={10}
              style={styles.nav}
              accessibilityLabel="Next month"
            >
              <ChevronRight size={20} color={c.ink2} />
            </Pressable>
          </View>
        </View>
        <View style={styles.grid}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <Txt key={d} variant="meta" style={styles.wd}>
              {t('weekday.short').split(',')[d]}
            </Txt>
          ))}
          {days.map((d) => {
            const [, m, day] = d.split('-').map(Number) as [number, number, number];
            const sel = d === current;
            const isToday = d === today;
            const muted = m !== cursor.m || d < today;
            return (
              <Pressable key={d} onPress={() => pick(d)} style={styles.cell}>
                <View style={[styles.dayCircle, sel && { backgroundColor: c.jade }]}>
                  <Txt
                    style={{
                      fontSize: 15,
                      fontWeight: isToday || sel ? '700' : '400',
                      color: sel ? c.jadeInk : isToday ? c.jade : muted ? c.ink3 : c.ink,
                    }}
                  >
                    {day}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function Option({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: c.active }]}
    >
      {icon}
      <Txt style={{ flex: 1 }}>{label}</Txt>
      {hint ? <Txt variant="meta">{hint}</Txt> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 50, paddingHorizontal: 22 },
  cal: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8, paddingTop: 10, paddingHorizontal: 14 },
  calHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  nav: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  wd: { width: `${100 / 7}%`, textAlign: 'center', paddingVertical: 6 },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
  dayCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
