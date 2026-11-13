import { labelTasks } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { TaskRow } from '../../components/TaskRow';
import { Empty, Txt } from '../../components/ui';
import { useQuery, useToday } from '../../state/replica';
import { readable, useColors } from '../../theme';

export default function LabelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const today = useToday();
  const label = useQuery((s) => s.get('label', id), [id]);
  const tasks = useQuery((s) => labelTasks(s, id), [id]);
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.bg }}
        contentContainerStyle={[readable, { paddingBottom: 160 }]}
      >
        <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
          <Txt variant="large">@{label?.name}</Txt>
        </View>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} today={today} showProject />
        ))}
        {!tasks.length && <Empty title={t('label.empty.title')} />}
      </ScrollView>
    </>
  );
}
