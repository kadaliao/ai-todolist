import { sortByOrder, type Task } from '@ai-todo/core';
import { SortableKeyboardPlugin } from '@dnd-kit/dom/sortable';
import { useSortable } from '@dnd-kit/react/sortable';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { useQuery, useToday } from '../state/replica';
import { useUI } from '../state/ui';
import { type DragItem, type RowOptions, TaskRow } from './TaskRow';

/**
 * A sortable list of tasks. `group` names the list scope so a drop can be translated back into a
 * move (see `onDragEnd` in App): `scope:<projectId|inbox>:<sectionId|->:<parentId|->` for project
 * lists, `day:<date>` for date buckets, `static` where order is derived (search, logbook).
 */

export type ChildMap = Map<string, Task[]>;

/** Rendered order per group, read on drop to turn a list index into a sibling position. */
export const groupOrder = new Map<string, string[]>();

export function useChildMap(): ChildMap {
  return useQuery((s) => {
    const map: ChildMap = new Map();
    for (const t of s.all('task')) {
      if (!t.parentId || t.deletedAt) continue;
      const list = map.get(t.parentId);
      if (list) list.push(t);
      else map.set(t.parentId, [t]);
    }
    for (const [k, v] of map) map.set(k, sortByOrder(v));
    return map;
  });
}

export function scopeGroup(
  projectId: string | null,
  sectionId: string | null,
  parentId: string | null,
): string {
  return `scope:${projectId ?? 'inbox'}:${sectionId ?? '-'}:${parentId ?? '-'}`;
}

export function parseGroup(
  group: string,
):
  | { kind: 'scope'; projectId: string | null; sectionId: string | null; parentId: string | null }
  | { kind: 'day'; date: string }
  | { kind: 'static' } {
  const [kind, a, b, c] = group.split(':');
  if (kind === 'scope') {
    return {
      kind,
      projectId: a === 'inbox' ? null : (a ?? null),
      sectionId: b === '-' ? null : (b ?? null),
      parentId: c === '-' ? null : (c ?? null),
    };
  }
  if (kind === 'day' && a) return { kind, date: a };
  return { kind: 'static' };
}

/** Flattened order of what a list shows, for keyboard navigation and shift-select. */
export function flatten(
  tasks: Task[],
  children: ChildMap,
  collapsed: Record<string, boolean>,
  nest: boolean,
): string[] {
  const out: string[] = [];
  const walk = (list: Task[]) => {
    for (const t of list) {
      out.push(t.id);
      if (nest && !collapsed[t.id]) walk((children.get(t.id) ?? []).filter((c) => !c.completedAt));
    }
  };
  walk(tasks);
  return out;
}

export function useRegisterVisible(ids: string[]): void {
  const key = ids.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by content
  useEffect(() => {
    useUI.setState({ visibleIds: ids });
  }, [key]);
}

export function TaskList({
  tasks,
  group,
  options,
  nest = false,
  depth = 0,
  childMap: childMapProp,
  empty,
}: {
  tasks: Task[];
  group: string;
  options?: RowOptions;
  nest?: boolean;
  depth?: number;
  childMap?: ChildMap;
  empty?: ReactNode;
}) {
  const today = useToday();
  const ownMap = useChildMap();
  const childMap = childMapProp ?? ownMap;
  groupOrder.set(
    group,
    tasks.map((t) => t.id),
  );
  if (!tasks.length && empty) return <>{empty}</>;
  return (
    <div role="listbox" aria-multiselectable className="flex flex-col">
      <AnimatePresence initial={false}>
        {tasks.map((task, i) => (
          <TaskItem
            key={task.id}
            task={task}
            index={i}
            group={group}
            today={today}
            options={{ ...options, depth }}
            nest={nest}
            childMap={childMap}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function TaskItem({
  task,
  index,
  group,
  today,
  options,
  nest,
  childMap,
}: {
  task: Task;
  index: number;
  group: string;
  today: string;
  options: RowOptions;
  nest: boolean;
  childMap: ChildMap;
}) {
  const editing = useUI((s) => s.editingId === task.id);
  const collapsed = useUI((s) => !!s.collapsed[task.id]);
  const draggable = options.draggable !== false && group !== 'static';
  // Only manually ordered lists reorder live while dragging; date lists are sorted by time and
  // priority, so dropping there just reschedules.
  const live = group.startsWith('scope:');
  const { ref, isDragSource } = useSortable({
    id: task.id,
    index,
    group,
    type: 'task',
    accept: 'task',
    data: { kind: 'task', taskId: task.id, group } satisfies DragItem,
    disabled: !draggable || editing,
    transition: { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' },
    ...(live ? {} : { plugins: [SortableKeyboardPlugin] }),
  });

  const kids = childMap.get(task.id) ?? [];
  const openKids = useMemo(() => kids.filter((k) => !k.completedAt), [kids]);
  const childCount = kids.length ? { done: kids.length - openKids.length, total: kids.length } : undefined;

  return (
    <motion.div
      ref={ref}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0, transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] } }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ overflow: 'hidden' }}
    >
      <TaskRow
        task={task}
        today={today}
        options={options}
        childCount={childCount}
        isDragSource={isDragSource}
      />
      {nest && !collapsed && openKids.length > 0 && (
        <TaskList
          tasks={openKids}
          group={scopeGroup(task.projectId, task.sectionId, task.id)}
          options={{ ...options, showProject: false }}
          nest
          depth={(options.depth ?? 0) + 1}
          childMap={childMap}
        />
      )}
    </motion.div>
  );
}
