import { sortByOrder, type Task } from '@ai-todo/core';
import { Fragment } from 'react';
import { useQuery } from '../state/replica';
import { TaskRow } from './TaskRow';

/** Top-level tasks with their open subtasks indented underneath. */
export function TaskTree({
  tasks,
  today,
  showProject,
}: {
  tasks: Task[];
  today: string;
  showProject?: boolean;
}) {
  const children = useQuery((s) => {
    const map = new Map<string, Task[]>();
    for (const t of s.all('task')) {
      if (!t.parentId || t.deletedAt || t.completedAt) continue;
      map.set(t.parentId, [...(map.get(t.parentId) ?? []), t]);
    }
    return map;
  });
  const render = (list: Task[], depth: number) =>
    sortByOrder(list).map((task) => (
      <Fragment key={task.id}>
        <TaskRow task={task} today={today} depth={depth} showProject={showProject} />
        {depth < 3 && render(children.get(task.id) ?? [], depth + 1)}
      </Fragment>
    ));
  return <>{render(tasks, 0)}</>;
}
