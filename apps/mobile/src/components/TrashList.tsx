import { restoreTask, trash } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { RotateCcw } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { run } from '../state/actions';
import { useQuery } from '../state/replica';
import { readable, useColors } from '../theme';
import { Empty, Txt } from './ui';

export function TrashList() {
  const c = useColors();
  const tasks = useQuery((s) => trash(s));
  const roots = tasks.filter((x) => !x.parentId || !tasks.some((p) => p.id === x.parentId));
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[readable, { paddingBottom: 80 }]}
    >
      {!roots.length && <Empty title={t('trash.empty.title')} body={t('trash.empty.body')} />}
      {roots.map((task) => (
        <View key={task.id} style={styles.row}>
          <Txt style={{ flex: 1, color: c.ink2 }} numberOfLines={2}>
            {task.title}
          </Txt>
          <Pressable onPress={() => run(restoreTask(task.id))} hitSlop={10} style={styles.restore}>
            <RotateCcw size={16} color={c.jade} />
            <Txt variant="meta" tone={c.jade} style={{ fontWeight: '600', fontSize: 14 }}>
              {t('task.restore')}
            </Txt>
          </Pressable>
        </View>
      ))}
    </ScrollView>
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
  restore: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
