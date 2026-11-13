import { type LogbookEntry, logbook } from '@ai-todo/core';
import { formatDay, t } from '@ai-todo/shared';
import { Stack } from 'expo-router';
import { Repeat } from 'lucide-react-native';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Checkbox } from '../components/Checkbox';
import { Empty, SectionHeader, Txt } from '../components/ui';
import { toggleComplete } from '../state/actions';
import { useQuery, useToday } from '../state/replica';
import { readable, useColors } from '../theme';

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function LogbookScreen() {
  const c = useColors();
  const today = useToday();
  const entries = useQuery((s) => logbook(s, 400));
  const groups = useMemo(() => {
    const map = new Map<string, LogbookEntry[]>();
    for (const e of entries)
      map.set(localDay(e.completedAt), [...(map.get(localDay(e.completedAt)) ?? []), e]);
    return [...map];
  }, [entries]);
  return (
    <>
      <Stack.Screen options={{ title: t('nav.logbook') }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.bg }}
        contentContainerStyle={[readable, { paddingBottom: 80 }]}
      >
        {!groups.length && <Empty title={t('logbook.empty.title')} body={t('logbook.empty.body')} />}
        {groups.map(([day, list]) => (
          <View key={day} style={{ marginBottom: 12 }}>
            <SectionHeader title={formatDay(day, today)} count={list.length} />
            {list.map((e) => {
              const title = e.kind === 'task' ? e.task.title : e.completion.title;
              const d = new Date(e.completedAt);
              return (
                <View key={e.kind === 'task' ? e.task.id : e.completion.id} style={styles.row}>
                  <Checkbox
                    priority={0}
                    checked
                    onPress={() => e.kind === 'task' && toggleComplete(e.task.id)}
                  />
                  <Txt style={{ flex: 1, color: c.ink2 }} numberOfLines={2}>
                    {title}
                  </Txt>
                  {e.kind === 'occurrence' ? <Repeat size={13} color={c.ink3} /> : null}
                  <Txt variant="meta">
                    {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
                  </Txt>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    minHeight: 52,
    paddingVertical: 10,
  },
});
