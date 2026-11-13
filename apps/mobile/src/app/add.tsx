import {
  addDays,
  createLabel,
  createProject,
  isoWeekday,
  type Priority,
  parseQuickAdd,
  sortByOrder,
} from '@ai-todo/core';
import { describeRecurrence, formatScheduled, t } from '@ai-todo/shared';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { Calendar, Flag, Hash, Inbox, Repeat, Tag } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, Txt } from '../components/ui';
import { addTasks, run } from '../state/actions';
import { timeZone, useQuery, useToday } from '../state/replica';
import { PRIORITY_COLOR, useColors } from '../theme';

/** Quick add: type naturally, see what was understood, tap a chip to undo a recognition. */
export default function AddSheet() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string; projectId?: string }>();
  const today = useToday();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<string[]>([]);
  const [date, setDate] = useState<string | null | undefined>(params.date);
  const [priority, setPriority] = useState<Priority | undefined>();
  const [projectId, setProjectId] = useState<string | null | undefined>(params.projectId);
  const [picker, setPicker] = useState<'date' | 'project' | null>(null);
  const [added, setAdded] = useState(0);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  const names = useQuery((s) => ({
    projects: sortByOrder(s.all('project').filter((p) => !p.deletedAt && !p.archivedAt)).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
    })),
    labels: s
      .all('label')
      .filter((l) => !l.deletedAt)
      .map((l) => ({ id: l.id, name: l.name })),
    sections: s
      .all('section')
      .filter((x) => !x.deletedAt)
      .map((x) => ({ id: x.id, name: x.name, projectId: x.projectId })),
  }));
  const parsed = useMemo(
    () => parseQuickAdd(text, { now: new Date(), timeZone: timeZone(), ...names, ignore }),
    [text, names, ignore],
  );

  const scheduled =
    date !== undefined ? (date ? { ...(parsed.scheduled ?? {}), date } : null) : (parsed.scheduled ?? null);
  const pid = projectId !== undefined ? projectId : (parsed.project?.id ?? null);
  const newProject =
    projectId === undefined && parsed.project && !parsed.project.id ? parsed.project.name : null;
  const prio = priority ?? parsed.priority ?? 0;
  const project = names.projects.find((p) => p.id === pid);

  const submit = () => {
    if (!parsed.title) return;
    const projectFinal = newProject ? (run(createProject({ name: newProject })) ?? null) : pid;
    const labels = [
      ...parsed.labels.flatMap((l) => (l.id ? [l.id] : [])),
      ...parsed.labels
        .filter((l) => !l.id)
        .map((l) => run(createLabel({ name: l.name })))
        .filter((x): x is string => !!x),
    ];
    addTasks([
      {
        title: parsed.title,
        projectId: projectFinal,
        sectionId: projectId === undefined ? (parsed.section?.id ?? null) : null,
        priority: prio,
        ...(labels.length ? { labels } : {}),
        ...(scheduled ? { scheduled } : {}),
        ...(parsed.recurrence && scheduled ? { recurrence: parsed.recurrence } : {}),
      },
    ]);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAdded((n) => n + 1);
    setText('');
    setIgnore([]);
    setPriority(undefined);
    if (!params.date) setDate(undefined);
    input.current?.focus();
  };

  const weekend = addDays(today, Math.max(0, 6 - isoWeekday(today)));
  const nextWeek = addDays(today, 8 - isoWeekday(today));
  const cyclePriority = () => {
    void Haptics.selectionAsync();
    setPriority(((prio + 1) % 4) as Priority);
  };

  return (
    <View style={{ backgroundColor: c.surface, paddingBottom: Math.max(insets.bottom, 12) }}>
      <View style={styles.inputRow}>
        <TextInput
          ref={input}
          autoFocus
          value={text}
          onChangeText={setText}
          placeholder={t('qa.placeholder')}
          placeholderTextColor={c.ink3}
          onSubmitEditing={submit}
          submitBehavior="submit"
          returnKeyType="done"
          style={[styles.input, { color: c.ink }]}
        />
      </View>
      {parsed.tokens.length > 0 && (
        <View style={styles.tokens}>
          {parsed.tokens.map((tok) => (
            <Pressable
              key={`${tok.kind}${tok.start}`}
              onPress={() => setIgnore((x) => [...x, tok.text])}
              accessibilityHint={t('qa.unrecognize')}
            >
              <View style={[styles.token, { backgroundColor: c.hover }]}>
                <Txt variant="meta" tone={c.ink2}>
                  {tok.text} ×
                </Txt>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="always"
      >
        <Chip
          active={!!scheduled}
          icon={<Calendar size={15} color={scheduled ? c.jade : c.ink2} />}
          onPress={() => setPicker(picker === 'date' ? null : 'date')}
        >
          {scheduled ? formatScheduled(scheduled, today) : t('task.date')}
        </Chip>
        {parsed.recurrence && scheduled ? (
          <Chip active icon={<Repeat size={15} color={c.jade} />}>
            {describeRecurrence(parsed.recurrence)}
          </Chip>
        ) : null}
        <Chip
          active={!!pid || !!newProject}
          tone={c.p3}
          icon={
            pid || newProject ? (
              <Hash size={15} color={project?.color ?? c.p3} />
            ) : (
              <Inbox size={15} color={c.ink2} />
            )
          }
          onPress={() => setPicker(picker === 'project' ? null : 'project')}
        >
          {newProject ? t('qa.newProject', { name: newProject }) : (project?.name ?? t('nav.inbox'))}
        </Chip>
        <Chip
          active={prio > 0}
          tone={PRIORITY_COLOR(c, prio)}
          icon={<Flag size={15} color={PRIORITY_COLOR(c, prio)} />}
          onPress={cyclePriority}
        >
          {prio ? `P${4 - prio}` : t('task.priority')}
        </Chip>
        {parsed.labels.map((l) => (
          <Chip key={l.name} active tone={c.p2} icon={<Tag size={15} color={c.p2} />}>
            {l.name}
          </Chip>
        ))}
      </ScrollView>
      {picker === 'date' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="always"
        >
          {(
            [
              [t('date.today'), today],
              [t('date.tomorrow'), addDays(today, 1)],
              [t('date.thisWeekend'), weekend],
              [t('date.nextWeek'), nextWeek],
              [t('date.none'), null],
            ] as const
          ).map(([label, d]) => (
            <Chip
              key={label}
              active={scheduled?.date === d}
              onPress={() => {
                setDate(d);
                setPicker(null);
              }}
            >
              {label}
            </Chip>
          ))}
        </ScrollView>
      )}
      {picker === 'project' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="always"
        >
          <Chip
            active={pid === null && !newProject}
            onPress={() => {
              setProjectId(null);
              setPicker(null);
            }}
          >
            {t('nav.inbox')}
          </Chip>
          {names.projects.map((p) => (
            <Chip
              key={p.id}
              active={pid === p.id}
              tone={p.color ?? undefined}
              onPress={() => {
                setProjectId(p.id);
                setPicker(null);
              }}
            >
              {p.name}
            </Chip>
          ))}
        </ScrollView>
      )}
      <View style={styles.footer}>
        <Txt variant="meta" style={{ flex: 1 }}>
          {added ? t('toast.addedN', { n: added }) : ''}
        </Txt>
        <Pressable
          onPress={submit}
          disabled={!parsed.title}
          style={[styles.addBtn, { backgroundColor: c.jade, opacity: parsed.title ? 1 : 0.4 }]}
        >
          <Txt style={{ color: c.jadeInk, fontWeight: '600' }}>{t('qa.add')}</Txt>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: { paddingHorizontal: 20, paddingTop: 22 },
  input: { fontSize: 19, lineHeight: 25, minHeight: 44, paddingVertical: 8 },
  tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 20, paddingBottom: 4 },
  token: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  chips: { gap: 8, paddingHorizontal: 20, paddingVertical: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 6 },
  addBtn: {
    height: 40,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
