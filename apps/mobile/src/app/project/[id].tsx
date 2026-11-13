import { createSection, deleteProject, projectView, updateProject } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { MoreHorizontal } from 'lucide-react-native';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import { TaskTree } from '../../components/TaskTree';
import { Empty, SectionHeader, Txt } from '../../components/ui';
import { run } from '../../state/actions';
import { useQuery, useToday } from '../../state/replica';
import { useColors } from '../../theme';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const today = useToday();
  const view = useQuery((s) => projectView(s, id), [id]);
  if (!view) return <Empty title={t('project.empty.title')} />;
  const total = view.groups.reduce((n, g) => n + g.tasks.length, 0);

  const menu = () => {
    const options = [t('rename'), t('section.add'), t('delete'), t('cancel')];
    const pick = (i: number) => {
      if (i === 0)
        Alert.prompt(
          t('rename'),
          undefined,
          (name) => name?.trim() && run(updateProject(id, { name })),
          'plain-text',
          view.project.name,
        );
      if (i === 1)
        Alert.prompt(
          t('section.add'),
          undefined,
          (name) => name?.trim() && run(createSection({ projectId: id, name })),
        );
      if (i === 2)
        Alert.alert(t('project.delete.confirm', { name: view.project.name, n: total }), undefined, [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('delete'),
            style: 'destructive',
            onPress: () => {
              run(deleteProject(id));
              router.back();
            },
          },
        ]);
    };
    if (Platform.OS === 'ios')
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 3, destructiveButtonIndex: 2 },
        pick,
      );
    else
      Alert.alert(
        view.project.name,
        undefined,
        options.slice(0, 3).map((text, i) => ({ text, onPress: () => pick(i) })),
      );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable onPress={menu} hitSlop={12} accessibilityLabel="Project actions">
              <MoreHorizontal size={24} color={c.ink2} />
            </Pressable>
          ),
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 160 }}>
        <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: view.project.color ?? c.ink3,
              }}
            />
            <Txt variant="large">{view.project.name}</Txt>
          </View>
          {total ? (
            <Txt variant="meta" style={{ marginTop: 4, fontSize: 14 }}>
              {t('count.tasks', { n: total })}
            </Txt>
          ) : null}
        </View>
        {view.groups.map((g) => (
          <View key={g.section?.id ?? 'none'} style={{ marginBottom: g.section ? 12 : 0 }}>
            {g.section && <SectionHeader title={g.section.name} count={g.tasks.length} />}
            <TaskTree tasks={g.tasks} today={today} />
          </View>
        ))}
        {!total && <Empty title={t('project.empty.title')} body={t('project.empty.body')} />}
      </ScrollView>
    </>
  );
}
