import type { Task } from '@ai-todo/core';
import { dateTone, formatScheduled, formatTime, t } from '@ai-todo/shared';
import { ChevronRight, FileText, MoreHorizontal, Repeat, Sparkles } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { editTask, toggleComplete } from '../state/actions';
import { useQuery } from '../state/replica';
import { useUI } from '../state/ui';
import { Checkbox } from './Checkbox';
import { TaskContextMenu, TaskDropdownMenu } from './TaskMenu';
import { Context, ContextTrigger, cx, Menu, MenuTrigger } from './ui';

export interface RowOptions {
  showProject?: boolean;
  showDate?: boolean;
  /** Indentation level for subtasks. */
  depth?: number;
  draggable?: boolean;
}

export interface DragItem {
  kind: 'task';
  taskId: string;
  /** Sortable group (list scope); see TaskList. */
  group: string;
}

/** Pause before a checked task leaves the list, so the check-off is seen (and can be undone). */
const COMPLETE_DELAY = 620;

export const TaskRow = memo(function TaskRow({
  task,
  today,
  options = {},
  childCount,
  isDragSource,
}: {
  task: Task;
  today: string;
  options?: RowOptions;
  childCount?: { done: number; total: number };
  isDragSource?: boolean;
}) {
  const selected = useUI((s) => s.selection.includes(task.id));
  const focused = useUI((s) => s.focusId === task.id);
  const editing = useUI((s) => s.editingId === task.id);
  const collapsed = useUI((s) => !!s.collapsed[task.id]);
  const [completing, setCompleting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const done = !!task.completedAt;

  const project = useQuery(
    (s) => (options.showProject && task.projectId ? s.get('project', task.projectId) : undefined),
    [options.showProject, task.projectId],
  );
  const labels = useQuery(
    (s) =>
      task.labels
        .map((id) => s.get('label', id))
        .filter((l): l is NonNullable<typeof l> => !!l && !l.deletedAt),
    [task.labels],
  );

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  const onCheck = () => {
    if (done) return toggleComplete(task.id);
    if (completing) {
      clearTimeout(timer.current);
      setCompleting(false);
      return;
    }
    setCompleting(true);
    timer.current = setTimeout(() => {
      setCompleting(false);
      toggleComplete(task.id);
    }, COMPLETE_DELAY);
  };

  const onClick = (e: React.MouseEvent) => {
    const ui = useUI.getState();
    if (e.metaKey || e.ctrlKey) {
      const sel = ui.selection.includes(task.id)
        ? ui.selection.filter((x) => x !== task.id)
        : [...ui.selection, task.id];
      ui.select(sel, task.id);
      return;
    }
    if (e.shiftKey && ui.focusId) {
      const ids = ui.visibleIds;
      const a = ids.indexOf(ui.focusId);
      const b = ids.indexOf(task.id);
      if (a >= 0 && b >= 0) {
        ui.select(ids.slice(Math.min(a, b), Math.max(a, b) + 1), task.id);
        return;
      }
    }
    ui.openDetail(task.id);
  };

  const tone = dateTone(task.scheduled, today);
  const contextIds = () => {
    const sel = useUI.getState().selection;
    return sel.includes(task.id) ? sel : [task.id];
  };
  const [menuIds, setMenuIds] = useState<string[]>([task.id]);

  return (
    <Context onOpenChange={(open) => open && setMenuIds(contextIds())}>
      <ContextTrigger asChild>
        <div
          ref={rowRef}
          data-task-row={task.id}
          data-completing={completing}
          role="option"
          aria-selected={selected}
          tabIndex={-1}
          onClick={onClick}
          onDoubleClick={() => useUI.getState().setEditing(task.id)}
          className={cx(
            'group relative flex min-h-[38px] items-start gap-2.5 rounded-[8px] py-[9px] pr-2 outline-none',
            'transition-[background,opacity] duration-100',
            selected ? 'bg-select' : 'hover:bg-hover',
            focused && !selected && 'shadow-[inset_0_0_0_1.5px_var(--select-line)]',
            focused && selected && 'shadow-[inset_0_0_0_1.5px_var(--select-line)]',
            isDragSource && 'opacity-40',
            task.origin === 'ai' && task.createdAt > recentCutoff() && 'draft',
          )}
          style={{ paddingLeft: 26 + (options.depth ?? 0) * 26 }}
        >
          {childCount && childCount.total > 0 ? (
            <button
              type="button"
              aria-label={collapsed ? 'Expand' : 'Collapse'}
              onClick={(e) => {
                e.stopPropagation();
                useUI.getState().toggleCollapsed(task.id);
              }}
              className="absolute top-[11px] grid size-4 place-items-center rounded text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100"
              style={{ left: 5 + (options.depth ?? 0) * 26 }}
            >
              <ChevronRight className={cx('size-3.5 transition-transform', !collapsed && 'rotate-90')} />
            </button>
          ) : null}

          <div className="pt-[1px]">
            <Checkbox priority={task.priority} done={done} completing={completing} onToggle={onCheck} />
          </div>

          <div className="min-w-0 flex-1">
            {editing ? (
              <InlineTitle task={task} />
            ) : (
              <div className={cx('leading-[20px]', done && 'text-ink-3 line-through decoration-ink-3/60')}>
                <span className="strike break-words">{task.title || t('task.untitled')}</span>
              </div>
            )}
            <Meta
              task={task}
              today={today}
              tone={tone}
              showDate={options.showDate !== false}
              project={project ? { name: project.name, color: project.color } : null}
              labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
              childCount={childCount}
            />
          </div>

          <Menu onOpenChange={(open) => open && setMenuIds(contextIds())}>
            <MenuTrigger asChild>
              <button
                type="button"
                aria-label="More"
                onClick={(e) => e.stopPropagation()}
                className="grid size-6 shrink-0 place-items-center rounded-[6px] text-ink-3 opacity-0 hover:bg-active hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </MenuTrigger>
            <TaskDropdownMenu ids={menuIds} />
          </Menu>
        </div>
      </ContextTrigger>
      <TaskContextMenu ids={menuIds} />
    </Context>
  );
});

/** Tasks the AI created in the last minute keep their "draft" outline as a visual receipt. */
function recentCutoff(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

function Meta({
  task,
  today,
  tone,
  showDate,
  project,
  labels,
  childCount,
}: {
  task: Task;
  today: string;
  tone: ReturnType<typeof dateTone>;
  showDate: boolean;
  project: { name: string; color: string | null } | null;
  labels: { id: string; name: string; color: string | null }[];
  childCount?: { done: number; total: number };
}) {
  const hasDate = showDate && task.scheduled;
  const timeOnly = !showDate && task.scheduled?.time;
  const hasAny =
    hasDate || timeOnly || project || labels.length || childCount?.total || task.notes || task.recurrence;
  if (!hasAny) return null;
  return (
    <div className="mt-[3px] flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] leading-4 text-ink-3">
      {hasDate && task.scheduled && (
        <span
          className={cx(
            'inline-flex items-center gap-1 font-medium',
            tone === 'overdue' && 'text-p1',
            tone === 'today' && 'text-jade',
            tone === 'soon' && 'text-ink-2',
          )}
        >
          {formatScheduled(task.scheduled, today)}
          {task.recurrence && <Repeat className="size-3" />}
        </span>
      )}
      {timeOnly && task.scheduled?.time && (
        <span className="inline-flex items-center gap-1 font-medium tabular-nums text-ink-2">
          {formatTime(task.scheduled.time)}
          {task.recurrence && <Repeat className="size-3" />}
        </span>
      )}
      {!hasDate && !timeOnly && task.recurrence && <Repeat className="size-3" />}
      {childCount && childCount.total > 0 && (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Progress done={childCount.done} total={childCount.total} />
          {t('subtasks.progress', childCount)}
        </span>
      )}
      {task.notes && <FileText className="size-3" aria-label={t('task.notes')} />}
      {task.origin === 'ai' && <Sparkles className="size-3 text-jade" aria-label="AI" />}
      {labels.map((l) => (
        <span key={l.id} style={{ color: l.color ?? 'var(--p2)' }}>
          @{l.name}
        </span>
      ))}
      {project && (
        <span className="ml-auto inline-flex items-center gap-1.5 text-ink-3">
          <span className="size-[7px] rounded-full" style={{ background: project.color ?? 'var(--ink-3)' }} />
          {project.name}
        </span>
      )}
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 12 12" className="size-3 -rotate-90" aria-hidden>
      <circle cx="6" cy="6" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="1.6" />
      <circle
        cx="6"
        cy="6"
        r={r}
        fill="none"
        stroke="var(--jade)"
        strokeWidth="1.6"
        strokeDasharray={`${(done / total) * c} ${c}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

function InlineTitle({ task }: { task: Task }) {
  const [value, setValue] = useState(task.title);
  const commit = () => {
    if (value.trim() && value !== task.title) editTask(task.id, { title: value });
    useUI.getState().setEditing(null);
  };
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: entering rename mode
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
        if (e.key === 'Escape') useUI.getState().setEditing(null);
      }}
      className="-my-[1px] h-[22px] w-full rounded-[4px] bg-surface px-1 text-[14px] leading-[20px] outline-none ring-1 ring-jade-line"
    />
  );
}
