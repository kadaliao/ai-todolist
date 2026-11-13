import { addDays, type Task } from '@ai-todo/core';
import { dateTone, formatScheduled, formatTime, t } from '@ai-todo/shared';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { CalendarDays, Check, FileText, Repeat, Sparkles, SunMedium, Trash2 } from 'lucide-react-native';
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { removeTasks, schedule, toggleComplete } from '../state/actions';
import { useQuery } from '../state/replica';
import { useColors } from '../theme';
import { Checkbox } from './Checkbox';
import { Txt } from './ui';

/** Pause after checking so the check-off is seen (and can be undone) before the row leaves. */
const COMPLETE_DELAY = 560;

export const TaskRow = memo(function TaskRow({
  task,
  today,
  showProject,
  showDate = true,
  depth = 0,
}: {
  task: Task;
  today: string;
  showProject?: boolean;
  showDate?: boolean;
  depth?: number;
}) {
  const c = useColors();
  const [completing, setCompleting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const swipe = useRef<SwipeableMethods>(null);
  const done = !!task.completedAt;
  useEffect(() => () => clearTimeout(timer.current), []);

  const meta = useQuery(
    (s) => {
      const project = showProject && task.projectId ? s.get('project', task.projectId) : null;
      const labels = task.labels.map((id) => s.get('label', id)).filter((l) => !!l && !l.deletedAt);
      const kids = s.all('task').filter((x) => x.parentId === task.id && !x.deletedAt);
      return {
        project: project ? { name: project.name, color: project.color } : null,
        labels: labels.map((l) => ({
          id: l?.id as string,
          name: l?.name as string,
          color: l?.color ?? null,
        })),
        kids: kids.length ? { done: kids.filter((k) => k.completedAt).length, total: kids.length } : null,
      };
    },
    [task.id, task.projectId, task.labels, showProject],
  );

  const complete = () => {
    if (done) return toggleComplete(task.id);
    if (completing) {
      clearTimeout(timer.current);
      setCompleting(false);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCompleting(true);
    timer.current = setTimeout(() => {
      setCompleting(false);
      toggleComplete(task.id);
    }, COMPLETE_DELAY);
  };

  const tone = dateTone(task.scheduled, today);
  const dateColor = tone === 'overdue' ? c.p1 : tone === 'today' ? c.jade : c.ink2;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(180)}
      layout={LinearTransition.duration(200)}
    >
      <ReanimatedSwipeable
        ref={swipe}
        friction={1.6}
        leftThreshold={70}
        rightThreshold={60}
        overshootLeft={false}
        renderLeftActions={(progress) => <CompleteAction progress={progress} done={done} />}
        renderRightActions={() => (
          <View style={styles.rightActions}>
            <SwipeButton
              color={c.p2}
              label={t('date.tomorrow')}
              icon={<SunMedium size={20} color="#fff" />}
              onPress={() => {
                swipe.current?.close();
                void schedule([task.id], addDays(today, 1));
              }}
            />
            <SwipeButton
              color={c.purple}
              label={t('task.date')}
              icon={<CalendarDays size={20} color="#fff" />}
              onPress={() => {
                swipe.current?.close();
                router.push({ pathname: '/schedule', params: { ids: task.id } });
              }}
            />
            <SwipeButton
              color={c.danger}
              label={t('delete')}
              icon={<Trash2 size={20} color="#fff" />}
              onPress={() => {
                swipe.current?.close();
                removeTasks([task.id]);
              }}
            />
          </View>
        )}
        onSwipeableWillOpen={(direction) => {
          // A rightward swipe (row moves right, revealing the left panel) is reported as 'right'.
          if (direction === 'right') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            swipe.current?.close();
            setTimeout(() => toggleComplete(task.id), 120);
          }
        }}
      >
        <Pressable
          onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: pressed ? c.active : c.bg, paddingLeft: 20 + depth * 28 },
          ]}
        >
          <View style={{ paddingTop: 1 }}>
            <Checkbox priority={task.priority} checked={done || completing} onPress={complete} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt
              style={[
                styles.title,
                (done || completing) && { color: c.ink3, textDecorationLine: 'line-through' },
              ]}
            >
              {task.title || t('task.untitled')}
            </Txt>
            {(task.scheduled ||
              meta.project ||
              meta.labels.length ||
              meta.kids ||
              task.notes ||
              task.origin === 'ai') && (
              <View style={styles.meta}>
                {showDate && task.scheduled ? (
                  <View style={styles.metaItem}>
                    <Txt variant="meta" tone={dateColor} style={{ fontWeight: '500' }}>
                      {formatScheduled(task.scheduled, today)}
                    </Txt>
                    {task.recurrence ? <Repeat size={12} color={dateColor} /> : null}
                  </View>
                ) : !showDate && task.scheduled?.time ? (
                  <View style={styles.metaItem}>
                    <Txt variant="meta" tone={c.ink2} style={{ fontWeight: '500' }}>
                      {formatTime(task.scheduled.time)}
                    </Txt>
                    {task.recurrence ? <Repeat size={12} color={c.ink2} /> : null}
                  </View>
                ) : task.recurrence ? (
                  <Repeat size={12} color={c.ink3} />
                ) : null}
                {meta.kids ? <Txt variant="meta">{t('subtasks.progress', meta.kids)}</Txt> : null}
                {task.notes ? <FileText size={12} color={c.ink3} /> : null}
                {task.origin === 'ai' ? <Sparkles size={12} color={c.jade} /> : null}
                {meta.labels.map((l) => (
                  <Txt key={l.id} variant="meta" tone={l.color ?? c.p2}>
                    @{l.name}
                  </Txt>
                ))}
                {meta.project ? (
                  <View style={[styles.metaItem, { marginLeft: 'auto' }]}>
                    <View style={[styles.dot, { backgroundColor: meta.project.color ?? c.ink3 }]} />
                    <Txt variant="meta">{meta.project.name}</Txt>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        </Pressable>
      </ReanimatedSwipeable>
    </Animated.View>
  );
});

function CompleteAction({ progress, done }: { progress: SharedValue<number>; done: boolean }) {
  const c = useColors();
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 1.4),
    transform: [{ scale: 0.7 + Math.min(progress.value, 1) * 0.3 }],
  }));
  return (
    <View style={[styles.leftAction, { backgroundColor: done ? c.ink3 : c.jade }]}>
      <Animated.View style={style}>
        <Check size={26} color="#fff" strokeWidth={3} />
      </Animated.View>
    </View>
  );
}

function SwipeButton({
  color,
  label,
  icon,
  onPress,
}: {
  color: string;
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.swipeBtn, { backgroundColor: color }]}
      accessibilityLabel={label}
    >
      {icon}
      <Txt style={{ color: '#fff', fontSize: 12, marginTop: 3, fontWeight: '600' }}>{label}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 12,
    paddingRight: 20,
    minHeight: 52,
  },
  title: { fontSize: 16.5, lineHeight: 23 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 3 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  leftAction: { flex: 1, justifyContent: 'center', paddingLeft: 26 },
  rightActions: { flexDirection: 'row' },
  swipeBtn: { width: 76, alignItems: 'center', justifyContent: 'center' },
});
