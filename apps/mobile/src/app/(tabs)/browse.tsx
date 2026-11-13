import { createProject, sidebar } from '@ai-todo/core';
import { getLocale, t } from '@ai-todo/shared';
import { router } from 'expo-router';
import { CheckCircle2, ChevronRight, Hash, Plus, Sparkles, Tag, Trash2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/ui';
import { run } from '../../state/actions';
import { useQuery } from '../../state/replica';
import { useColors } from '../../theme';

const COLORS = ['#d64545', '#e0731d', '#dd8f12', '#1f8f6a', '#2b9bb0', '#3d6fd9', '#6b5bd6', '#b0519b'];

export default function BrowseScreen() {
  const c = useColors();
  const tree = useQuery((s) => {
    const sb = sidebar(s);
    const open = new Map<string, number>();
    for (const task of s.all('task')) {
      if (task.projectId && !task.completedAt && !task.deletedAt && !task.parentId)
        open.set(task.projectId, (open.get(task.projectId) ?? 0) + 1);
    }
    return { ...sb, open };
  });
  const newProject = () =>
    Alert.prompt(t('nav.newProject'), undefined, (name) => {
      if (!name?.trim()) return;
      const id = run(createProject({ name, color: COLORS[tree.projects.length % COLORS.length] ?? null }));
      if (id) router.push({ pathname: '/project/[id]', params: { id } });
    });
  return (
    <Screen title={t('nav.browse')}>
      <Group>
        <Row
          icon={<Sparkles size={20} color={c.jade} />}
          label={t('palette.brainDump')}
          onPress={() => router.push('/dump')}
        />
      </Group>
      <GroupTitle title={t('nav.projects')} onAdd={newProject} />
      <Group>
        {tree.projects.flatMap(({ project, children }) =>
          [project, ...children].map((p) => (
            <Row
              key={p.id}
              indent={p.parentId ? 1 : 0}
              icon={<Hash size={20} color={p.color ?? c.ink3} />}
              label={p.name}
              count={tree.open.get(p.id)}
              onPress={() => router.push({ pathname: '/project/[id]', params: { id: p.id } })}
            />
          )),
        )}
        {!tree.projects.length && (
          <Row icon={<Plus size={20} color={c.ink3} />} label={t('nav.newProject')} onPress={newProject} />
        )}
      </Group>
      {tree.labels.length > 0 && (
        <>
          <GroupTitle title={t('nav.labels')} />
          <Group>
            {tree.labels.map((l) => (
              <Row
                key={l.id}
                icon={<Tag size={20} color={l.color ?? c.p2} />}
                label={l.name}
                onPress={() => router.push({ pathname: '/label/[id]', params: { id: l.id } })}
              />
            ))}
          </Group>
        </>
      )}
      <GroupTitle title={getLocale() === 'zh' ? '更多' : 'More'} />
      <Group>
        <Row
          icon={<CheckCircle2 size={20} color={c.ink3} />}
          label={t('nav.logbook')}
          onPress={() => router.push('/logbook')}
        />
        <Row
          icon={<Trash2 size={20} color={c.ink3} />}
          label={t('nav.trash')}
          onPress={() => router.push('/trash')}
        />
      </Group>
    </Screen>
  );
}

function GroupTitle({ title, onAdd }: { title: string; onAdd?: () => void }) {
  const c = useColors();
  return (
    <View style={styles.groupTitle}>
      <Txt variant="meta" style={{ fontWeight: '600', fontSize: 13 }}>
        {title}
      </Txt>
      {onAdd ? (
        <Pressable onPress={onAdd} hitSlop={12} accessibilityLabel={title}>
          <Plus size={18} color={c.ink3} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Group({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.line }]}>{children}</View>;
}

function Row({
  icon,
  label,
  count,
  onPress,
  indent = 0,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  onPress: () => void;
  indent?: number;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? c.active : 'transparent', paddingLeft: 16 + indent * 22 },
      ]}
    >
      {icon}
      <Txt style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Txt>
      {count ? <Txt variant="meta">{count}</Txt> : null}
      <ChevronRight size={18} color={c.lineStrong} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  groupTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 8,
  },
  group: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 50, paddingRight: 14 },
});
