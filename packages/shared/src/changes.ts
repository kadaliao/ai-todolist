import type { Change, LocalDate, ReadStore, Task } from '@ai-todo/core';
import { describeRecurrence, formatScheduled } from './dates';
import { t } from './i18n';

/**
 * One line of the assistant's "what changed" card. Subtasks that were added or completed along
 * with their parent fold into the parent's line.
 */
export interface ChangeLine {
  key: string;
  kind: Change['kind'];
  entity: Change['entity'];
  /** Task title or project/label/section name. */
  title: string;
  /** "明天 09:00 · #工作", "→ 周四", "含 3 个子任务"… */
  detail: string;
  taskId?: string;
}

const PRIORITY = ['p4', 'p3', 'p2', 'p1'];

function where(store: ReadStore, task: Task): string {
  if (task.parentId) return '';
  if (!task.projectId) return '';
  const p = store.get('project', task.projectId);
  return p ? `#${p.name}` : '';
}

function when(task: Task, today: LocalDate): string {
  if (!task.scheduled) return '';
  const base = formatScheduled(task.scheduled, today);
  return task.recurrence ? `${base} · ${describeRecurrence(task.recurrence)}` : base;
}

function reminders(task: Task): string {
  const r = task.reminders[0];
  if (!r) return t('change.noRemind');
  if (r.kind === 'relative')
    return r.minutesBefore ? t('change.remindBefore', { n: r.minutesBefore }) : t('change.remindAt');
  return `${t('change.remindAt')} ${r.at}`;
}

function updatedDetail(store: ReadStore, c: Extract<Change, { entity: 'task' }>, today: LocalDate): string {
  const a = c.after as Task;
  const b = c.before as Task;
  const out: string[] = [];
  const f = new Set(c.fields);
  if (f.has('date') || f.has('time')) {
    if (!a.scheduled) out.push(`→ ${t('change.noDate')}`);
    else if (!a.scheduled.time && b.scheduled?.time && !f.has('date')) out.push(`→ ${t('change.allDay')}`);
    else out.push(`→ ${formatScheduled(a.scheduled, today)}`);
  }
  if (f.has('repeat')) out.push(a.recurrence ? describeRecurrence(a.recurrence) : t('change.noRepeat'));
  if (f.has('project') || f.has('section')) {
    const p = a.projectId ? store.get('project', a.projectId)?.name : t('change.inbox');
    const s = a.sectionId ? store.get('section', a.sectionId)?.name : null;
    out.push(`→ #${p ?? ''}${s ? ` / ${s}` : ''}`);
  }
  if (f.has('parent') && a.parentId) {
    const parent = store.get('task', a.parentId);
    if (parent) out.push(`→ ${parent.title}`);
  }
  if (f.has('priority')) out.push(`→ ${PRIORITY[a.priority]}`);
  if (f.has('labels')) {
    const names = a.labels.map((id) => store.get('label', id)?.name).filter(Boolean);
    out.push(names.length ? names.map((n) => `@${n}`).join(' ') : `${t('change.labels')} ✕`);
  }
  if (f.has('reminders')) out.push(reminders(a));
  if (f.has('notes')) out.push(t('change.notes'));
  if (f.has('title')) out.push(t('change.renamed', { old: b.title }));
  return out.join(' · ');
}

/** `store` is the data after the changes (to name projects and labels). */
export function describeChanges(changes: Change[], store: ReadStore, today: LocalDate): ChangeLine[] {
  const tasks = new Map<string, Extract<Change, { entity: 'task' }>>();
  for (const c of changes) if (c.entity === 'task') tasks.set(c.id, c);
  const parentOf = (c: Extract<Change, { entity: 'task' }>) => (c.after ?? c.before)?.parentId ?? null;
  const folded = new Map<string, number>();
  for (const c of tasks.values()) {
    const pid = parentOf(c);
    const parent = pid ? tasks.get(pid) : undefined;
    if (
      parent &&
      parent.kind === c.kind &&
      (c.kind === 'added' || c.kind === 'completed' || c.kind === 'deleted')
    ) {
      folded.set(pid as string, (folded.get(pid as string) ?? 0) + 1);
    }
  }
  const lines: ChangeLine[] = [];
  for (const c of changes) {
    if (c.entity !== 'task') {
      if (c.kind !== 'added') continue;
      const key =
        c.entity === 'project'
          ? 'change.projectAdded'
          : c.entity === 'label'
            ? 'change.labelAdded'
            : 'change.sectionAdded';
      lines.push({
        key: `${c.entity}:${c.id}`,
        kind: c.kind,
        entity: c.entity,
        title: c.name,
        detail: t(key),
      });
      continue;
    }
    const pid = parentOf(c);
    const parent = pid ? tasks.get(pid) : undefined;
    if (
      parent &&
      parent.kind === c.kind &&
      (c.kind === 'added' || c.kind === 'completed' || c.kind === 'deleted')
    )
      continue;
    const task = (c.after ?? c.before) as Task;
    const parts: string[] = [];
    if (c.kind === 'added') {
      parts.push(when(task, today), where(store, task));
      if (task.parentId) {
        const p = store.get('task', task.parentId);
        if (p) parts.push(`↳ ${p.title}`);
      }
    } else if (c.kind === 'completed') {
      if (c.after?.recurrence && c.after.scheduled)
        parts.push(t('change.next', { when: formatScheduled(c.after.scheduled, today) }));
    } else if (c.kind === 'updated') parts.push(updatedDetail(store, c, today));
    const n = folded.get(c.id);
    if (n) parts.push(t('change.subtasks', { n }));
    lines.push({
      key: `task:${c.id}`,
      kind: c.kind,
      entity: 'task',
      title: task.title,
      detail: parts.filter(Boolean).join(' · '),
      taskId: c.id,
    });
  }
  return lines;
}
