import { createTask, createTasks, moveTasks, type Priority, sortByOrder, type Task } from '@ai-todo/core';
import { describeRecurrence, formatScheduled, getLocale, t } from '@ai-todo/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Bell, Calendar, Flag, Hash, Inbox, Plus, Repeat, Sparkles, Tag, Trash2 } from 'lucide-react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Checkbox } from '../../components/Checkbox';
import { Chip, Txt } from '../../components/ui';
import { editTask, removeTasks, run, toggleComplete } from '../../state/actions';
import { breakdownTask } from '../../state/ai';
import { useQuery, useReplica, useToday } from '../../state/replica';
import { PRIORITY_COLOR, useColors } from '../../theme';

export default function TaskSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useQuery((s) => s.get('task', id), [id]);
  const today = useToday();
  if (!task || task.deletedAt) return null;
  return <Detail key={task.id} task={task} today={today} />;
}

function pickFrom(title: string, options: string[], onPick: (i: number) => void) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...options, t('cancel')], cancelButtonIndex: options.length },
      (i) => i < options.length && onPick(i),
    );
  } else {
    Alert.alert(title, undefined, [
      ...options.map((text, i) => ({ text, onPress: () => onPick(i) })),
      { text: t('cancel'), style: 'cancel' as const },
    ]);
  }
}

function Detail({ task, today }: { task: Task; today: string }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setNotes(task.notes), [task.notes]);

  const data = useQuery(
    (s) => ({
      project: task.projectId ? s.get('project', task.projectId) : null,
      projects: sortByOrder(s.all('project').filter((p) => !p.deletedAt && !p.archivedAt)),
      labels: sortByOrder(s.all('label').filter((l) => !l.deletedAt)),
      subtasks: sortByOrder(s.all('task').filter((x) => x.parentId === task.id && !x.deletedAt)),
    }),
    [task.id, task.projectId],
  );

  const reminder = task.reminders.find((x) => x.kind === 'relative');
  const zh = getLocale() === 'zh';
  const reminderLabel = (m: number) =>
    m === 0
      ? zh
        ? '准时'
        : 'At time'
      : m >= 1440
        ? zh
          ? `提前 ${m / 1440} 天`
          : `${m / 1440} day before`
        : zh
          ? `提前 ${m} 分钟`
          : `${m} min before`;

  return (
    <ScrollView
      style={{ backgroundColor: c.surface }}
      contentContainerStyle={{ paddingTop: 26, paddingBottom: insets.bottom + 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.titleRow}>
        <View style={{ paddingTop: 4 }}>
          <Checkbox
            priority={task.priority}
            checked={!!task.completedAt}
            onPress={() => toggleComplete(task.id)}
            size={26}
          />
        </View>
        <TextInput
          value={title}
          onChangeText={setTitle}
          onEndEditing={() => title.trim() && title !== task.title && editTask(task.id, { title })}
          multiline
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          style={[styles.title, { color: task.completedAt ? c.ink3 : c.ink }]}
        />
      </View>

      <View style={[styles.fields, { borderColor: c.line }]}>
        <Field
          icon={<Calendar size={19} color={task.scheduled ? c.jade : c.ink3} />}
          label={t('task.date')}
          value={task.scheduled ? formatScheduled(task.scheduled, today) : t('task.noDate')}
          tone={task.scheduled && task.scheduled.date < today && !task.completedAt ? c.p1 : undefined}
          onPress={() => router.push({ pathname: '/schedule', params: { ids: task.id } })}
        />
        {task.recurrence && (
          <Field
            icon={<Repeat size={19} color={c.jade} />}
            label={t('task.repeat')}
            value={describeRecurrence(task.recurrence)}
          />
        )}
        <Field
          icon={<Flag size={19} color={PRIORITY_COLOR(c, task.priority)} />}
          label={t('task.priority')}
          value={t(`priority.${task.priority}` as 'priority.0')}
          onPress={() =>
            pickFrom(
              t('task.priority'),
              [3, 2, 1, 0].map((p) => t(`priority.${p}` as 'priority.0')),
              (i) => editTask(task.id, { priority: [3, 2, 1, 0][i] as Priority }),
            )
          }
        />
        {!task.parentId && (
          <Field
            icon={
              data.project ? (
                <Hash size={19} color={data.project.color ?? c.ink3} />
              ) : (
                <Inbox size={19} color={c.p3} />
              )
            }
            label={t('task.project')}
            value={data.project?.name ?? t('nav.inbox')}
            onPress={() =>
              pickFrom(t('task.project'), [t('nav.inbox'), ...data.projects.map((p) => p.name)], (i) =>
                run(moveTasks([task.id], { projectId: i === 0 ? null : (data.projects[i - 1]?.id ?? null) })),
              )
            }
          />
        )}
        {task.scheduled?.time ? (
          <Field
            icon={<Bell size={19} color={reminder ? c.jade : c.ink3} />}
            label={t('task.reminder')}
            value={
              reminder && reminder.kind === 'relative'
                ? reminderLabel(reminder.minutesBefore)
                : zh
                  ? '默认'
                  : 'Default'
            }
            onPress={() =>
              pickFrom(t('task.reminder'), [0, 5, 15, 30, 60, 1440].map(reminderLabel), (i) => {
                const m = [0, 5, 15, 30, 60, 1440][i] as number;
                editTask(task.id, { reminders: [{ id: `r${m}`, kind: 'relative', minutesBefore: m }] });
              })
            }
          />
        ) : null}
      </View>

      {data.labels.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.labels}>
          {data.labels.map((l) => {
            const on = task.labels.includes(l.id);
            return (
              <Chip
                key={l.id}
                active={on}
                tone={l.color ?? c.p2}
                icon={<Tag size={14} color={on ? (l.color ?? c.p2) : c.ink3} />}
                onPress={() =>
                  editTask(task.id, {
                    labels: on ? task.labels.filter((x) => x !== l.id) : [...task.labels, l.id],
                  })
                }
              >
                {l.name}
              </Chip>
            );
          })}
        </ScrollView>
      )}

      <TextInput
        value={notes}
        onChangeText={setNotes}
        onEndEditing={() => notes !== task.notes && editTask(task.id, { notes })}
        placeholder={t('task.notesPlaceholder')}
        placeholderTextColor={c.ink3}
        multiline
        style={[styles.notes, { color: c.ink, borderTopColor: c.line }]}
      />

      <Subtasks task={task} subtasks={data.subtasks} />

      <View style={styles.footer}>
        <Txt variant="meta" style={{ flex: 1 }}>
          {task.origin === 'ai' ? '✦ ' : ''}
          {t(task.origin === 'ai' ? 'task.createdByAi' : 'task.created', {
            date: new Date(task.createdAt).toLocaleDateString(zh ? 'zh-CN' : 'en-US', {
              month: 'short',
              day: 'numeric',
            }),
          })}
        </Txt>
        <Pressable
          onPress={() => {
            router.back();
            setTimeout(() => removeTasks([task.id]), 200);
          }}
          hitSlop={10}
          style={styles.delete}
          accessibilityLabel={t('task.delete')}
        >
          <Trash2 size={18} color={c.danger} />
          <Txt variant="meta" tone={c.danger} style={{ fontSize: 14 }}>
            {t('task.delete')}
          </Txt>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Field({
  icon,
  label,
  value,
  onPress,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onPress?: () => void;
  tone?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.field, pressed && { backgroundColor: c.active }]}
    >
      {icon}
      <Txt variant="label" style={{ width: 84 }}>
        {label}
      </Txt>
      <Txt style={{ flex: 1, textAlign: 'right' }} tone={tone} numberOfLines={1}>
        {value}
      </Txt>
    </Pressable>
  );
}

function Subtasks({ task, subtasks }: { task: Task; subtasks: Task[] }) {
  const c = useColors();
  const r = useReplica();
  const [draft, setDraft] = useState('');
  const [ai, setAi] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<(() => void) | null>(null);
  useEffect(() => () => abort.current?.(), []);

  const breakdown = () => {
    setBusy(true);
    setAi([]);
    abort.current = breakdownTask(
      r,
      { title: task.title, notes: task.notes, existing: subtasks.map((s) => s.title) },
      (item) => setAi((xs) => [...(xs ?? []), item.title]),
      (err) => {
        setBusy(false);
        if (err) {
          setAi(null);
          Alert.alert(t('ai.unavailable', { message: err }));
        }
      },
    );
  };

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
      <View style={styles.subHead}>
        <Txt variant="section" tone={c.ink2}>
          {t('task.subtasks')}
        </Txt>
        <Pressable onPress={breakdown} disabled={busy} hitSlop={8} style={styles.aiBtn}>
          {busy ? <ActivityIndicator size="small" color={c.jade} /> : <Sparkles size={16} color={c.jade} />}
          <Txt variant="meta" tone={c.jade} style={{ fontSize: 14, fontWeight: '600' }}>
            {busy ? t('ai.breakdown.working') : t('ai.breakdown')}
          </Txt>
        </Pressable>
      </View>
      {subtasks.map((s) => (
        <View key={s.id} style={styles.sub}>
          <Checkbox
            priority={s.priority}
            checked={!!s.completedAt}
            onPress={() => toggleComplete(s.id)}
            size={22}
          />
          <Txt
            style={[
              { flex: 1 },
              s.completedAt ? { color: c.ink3, textDecorationLine: 'line-through' } : null,
            ]}
          >
            {s.title}
          </Txt>
        </View>
      ))}
      {ai && (
        <View style={[styles.drafts, { borderColor: c.jadeLine, backgroundColor: c.jadeSoft }]}>
          {ai.map((d, i) => (
            <View key={`${i}${d}`} style={styles.sub}>
              <View style={[styles.draftDot, { borderColor: c.jadeLine }]} />
              <Txt style={{ flex: 1 }}>{d}</Txt>
            </View>
          ))}
          {!busy && (
            <View style={{ flexDirection: 'row', gap: 10, paddingTop: 6 }}>
              <Pressable
                onPress={() => {
                  run(createTasks(ai.map((title) => ({ title, parentId: task.id }))), 'ai');
                  setAi(null);
                }}
                style={[styles.accept, { backgroundColor: c.jade }]}
              >
                <Txt style={{ color: c.jadeInk, fontWeight: '600', fontSize: 14 }}>
                  {t('ai.dump.addAll', { n: ai.length })}
                </Txt>
              </Pressable>
              <Pressable onPress={() => setAi(null)} style={styles.accept}>
                <Txt variant="meta" style={{ fontSize: 14 }}>
                  {t('cancel')}
                </Txt>
              </Pressable>
            </View>
          )}
        </View>
      )}
      <View style={styles.sub}>
        <Plus size={20} color={c.ink3} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('task.addSubtask')}
          placeholderTextColor={c.ink3}
          onSubmitEditing={() => {
            if (draft.trim()) run(createTask({ title: draft, parentId: task.id }));
            setDraft('');
          }}
          submitBehavior="submit"
          returnKeyType="done"
          style={{ flex: 1, fontSize: 16, color: c.ink, paddingVertical: 8 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', gap: 14, paddingHorizontal: 20, alignItems: 'flex-start' },
  title: { flex: 1, fontSize: 21, lineHeight: 28, fontWeight: '600', paddingTop: 0 },
  fields: {
    marginTop: 18,
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 50, paddingHorizontal: 14 },
  labels: { gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  notes: {
    marginTop: 18,
    marginHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    lineHeight: 23,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  subHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 40 },
  aiBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  drafts: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, padding: 10, marginVertical: 6 },
  draftDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed' },
  accept: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 28 },
  delete: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
