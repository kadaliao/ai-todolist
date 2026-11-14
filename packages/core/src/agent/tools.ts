import { z } from 'zod';
import {
  addMemory,
  type Command,
  CommandError,
  completeTasks,
  createLabel,
  createProject,
  createTasks,
  DAY_PART_NAMES,
  deleteMemory,
  deleteTasks,
  moveTasks,
  type NewTask,
  rescheduleTasks,
  setSetting,
  type TaskPatch,
  uncompleteTask,
  updateTask,
} from '../commands';
import type { DayParts, Priority, Reminder, Task } from '../model';
import { sortByOrder } from '../order';
import type { ReadStore } from '../overlay';
import { parseQuickAdd, type QuickAddResult } from '../parser';
import { addDays, compareDates, isoWeekday, type LocalDate, wallClock } from '../time';
import {
  DAY_PARTS_KEY,
  dayParts,
  isOverdue,
  logbook,
  memories,
  search,
  sidebar,
  today as todayView,
  upcoming,
} from '../views';

/**
 * The task-list tools an agent can call. The same definitions back the MCP server (Claude and
 * other external agents) and the in-app voice assistant; only {@link ToolEnv} differs:
 * MCP applies each call right away, the assistant stages a whole turn first.
 *
 * Tools are few and workflow-shaped rather than raw CRUD. Dates are never computed by the
 * model: it passes the user's wording (`when: "下周四下午3点"`) and the app's parser resolves it.
 */

export interface ToolPolicy {
  /** Unknown project/label names are created (MCP) instead of rejected (voice, where names get misheard). */
  createMissing: boolean;
  /** Only tasks an agent created may be trashed (MCP). */
  deleteOnlyAgentMade: boolean;
}

export interface ToolEnv {
  /** Current data, including this turn's staged edits. */
  readonly store: ReadStore;
  readonly now: Date;
  readonly today: LocalDate;
  readonly timeZone: string;
  readonly policy: ToolPolicy;
  run<R>(cmd: Command<R>): R;
  newId(): string;
  /** Task id → the handle shown to the model (short refs in the app, raw ids over MCP). */
  ref(id: string): string;
  resolve(ref: string): string | undefined;
  /** Revert the most recent agent change. */
  undoLast(): boolean;
}

export class ToolError extends Error {}

export interface AgentTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly shape: z.ZodRawShape;
  readonly schema: z.ZodObject<z.ZodRawShape>;
  readonly readOnly: boolean;
  readonly destructive: boolean;
  /** Only for the in-app assistant (e.g. asking the user a question), not offered over MCP. */
  readonly appOnly: boolean;
  run(env: ToolEnv, input: unknown): unknown;
}

function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly?: boolean;
  destructive?: boolean;
  appOnly?: boolean;
  run(env: ToolEnv, input: z.infer<z.ZodObject<S>>): unknown;
}): AgentTool {
  const schema = z.object(def.input);
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    shape: def.input,
    schema: schema as unknown as z.ZodObject<z.ZodRawShape>,
    readOnly: def.readOnly ?? false,
    destructive: def.destructive ?? false,
    appOnly: def.appOnly ?? false,
    run: (env, input) => def.run(env, input as z.infer<z.ZodObject<S>>),
  };
}

// --- shared helpers --------------------------------------------------------------------------

export const PRIORITY_NAME: Record<Priority, 'p1' | 'p2' | 'p3' | 'p4'> = {
  3: 'p1',
  2: 'p2',
  1: 'p3',
  0: 'p4',
};
const PRIORITY_VALUE: Record<'p1' | 'p2' | 'p3' | 'p4', Priority> = { p1: 3, p2: 2, p3: 1, p4: 0 };

export interface TaskBrief {
  id: string;
  title: string;
  date?: string;
  time?: string;
  deadline?: string;
  repeat?: string;
  repeatFrom?: string;
  project: string;
  section?: string;
  labels?: string[];
  priority: string;
  notes?: string;
  parentId?: string;
  completed?: true;
}

/** Compact, model-friendly view of a task. */
export function briefTask(s: ReadStore, t: Task, ref: (id: string) => string = (id) => id): TaskBrief {
  const project = t.projectId ? s.get('project', t.projectId) : null;
  const section = t.sectionId ? s.get('section', t.sectionId) : null;
  const labels = t.labels.map((id) => s.get('label', id)?.name).filter((x): x is string => !!x);
  return {
    id: ref(t.id),
    title: t.title,
    ...(t.scheduled
      ? { date: t.scheduled.date, ...(t.scheduled.time ? { time: t.scheduled.time } : {}) }
      : {}),
    ...(t.deadline ? { deadline: t.deadline } : {}),
    ...(t.recurrence ? { repeat: t.recurrence.rule, repeatFrom: t.recurrence.from } : {}),
    project: project?.name ?? 'Inbox',
    ...(section ? { section: section.name } : {}),
    ...(labels.length ? { labels } : {}),
    priority: PRIORITY_NAME[t.priority],
    ...(t.notes ? { notes: t.notes.length > 400 ? `${t.notes.slice(0, 400)}…` : t.notes } : {}),
    ...(t.parentId ? { parentId: ref(t.parentId) } : {}),
    ...(t.completedAt ? { completed: true as const } : {}),
  };
}

const live = <T extends { deletedAt: string | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt);
const lower = (s: string) => s.trim().toLowerCase();

function findProject(s: ReadStore, name: string): { id: string | null } | undefined {
  const n = lower(name);
  if (n === 'inbox' || n === '收件箱') return { id: null };
  const p = live(s.all('project')).find((x) => lower(x.name) === n);
  return p ? { id: p.id } : undefined;
}

function projectNames(s: ReadStore): string {
  const names = live(s.all('project'))
    .filter((p) => !p.archivedAt)
    .map((p) => `“${p.name}”`);
  return names.length ? names.join(', ') : '(none)';
}

function projectId(env: ToolEnv, name: string, created: string[]): string | null {
  const found = findProject(env.store, name);
  if (found) return found.id;
  if (!env.policy.createMissing) {
    throw new ToolError(
      `No project named “${name}”. Existing projects: ${projectNames(env.store)}, or "Inbox". It may be a speech-recognition error; pick the closest existing one, or call create-project only if the user asked for a new project.`,
    );
  }
  const id = env.run(createProject({ name }));
  created.push(`project “${name}”`);
  return id;
}

function labelIds(env: ToolEnv, names: string[], created: string[]): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const l = live(env.store.all('label')).find((x) => lower(x.name) === lower(name));
    if (l) ids.push(l.id);
    else if (env.policy.createMissing) {
      ids.push(env.run(createLabel({ name })));
      created.push(`label “${name}”`);
    } else {
      const all = live(env.store.all('label')).map((x) => `“${x.name}”`);
      throw new ToolError(
        `No label named “${name}”. Existing labels: ${all.length ? all.join(', ') : '(none)'}.`,
      );
    }
  }
  return [...new Set(ids)];
}

type When = Pick<QuickAddResult, 'scheduled' | 'recurrence' | 'deadline'>;

function parsePhrase(env: ToolEnv, phrase: string): When {
  return /^\d{4}-\d{2}-\d{2}$/.test(phrase.trim())
    ? { scheduled: { date: phrase.trim() } }
    : parseQuickAdd(phrase, { now: env.now, timeZone: env.timeZone, dayParts: dayParts(env.store) });
}

/** A date phrase; “周五之前” comes back as a deadline rather than a planned day. */
function parseWhen(env: ToolEnv, when: string): When {
  const parsed = parsePhrase(env, when);
  if (!parsed.scheduled && !parsed.deadline) {
    throw new ToolError(
      `Could not understand when="${when}". Use the user's wording, e.g. "tomorrow 3pm", "下周五", "每周一", or YYYY-MM-DD.`,
    );
  }
  return parsed;
}

function parseDeadline(env: ToolEnv, phrase: string): LocalDate {
  const parsed = parsePhrase(env, phrase);
  const date = parsed.deadline ?? parsed.scheduled?.date;
  if (!date) {
    throw new ToolError(
      `Could not understand deadline="${phrase}". Use the user's wording, e.g. "周五", "月底".`,
    );
  }
  return date;
}

function taskId(env: ToolEnv, ref: string): string {
  const id = env.resolve(ref);
  const t = id ? env.store.get('task', id) : undefined;
  if (!id || !t || t.deletedAt) throw new ToolError(`No task with id ${ref}. Use find-tasks to look it up.`);
  return id;
}

function normalizeTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const h = Number(m?.[1]);
  const min = Number(m?.[2]);
  if (!m || h > 23 || min > 59) throw new ToolError(`time must be HH:mm, got "${time}"`);
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function reminder(env: ToolEnv, minutesBefore: number | null): Reminder[] {
  return minutesBefore === null ? [] : [{ id: env.newId(), kind: 'relative', minutesBefore }];
}

const brief = (env: ToolEnv, id: string) => {
  const t = env.store.get('task', id);
  return t ? briefTask(env.store, t, (x) => env.ref(x)) : { id: env.ref(id), deleted: true };
};

// --- schemas ---------------------------------------------------------------------------------

const priority = z.enum(['p1', 'p2', 'p3', 'p4']).describe('p1 urgent … p4 none');
const remind = z
  .number()
  .int()
  .min(0)
  .max(10080)
  .nullable()
  .describe(
    'Remind this many minutes before the task’s time (0 = at the time; null = no reminder). Tasks with a time already remind at that time by default.',
  );

const newTaskInput = z.object({
  title: z
    .string()
    .min(1)
    .describe(
      'Short imperative title in the user’s language, without the date/time words. May include quick-add syntax like "#Project @label p1".',
    ),
  when: z
    .string()
    .optional()
    .describe(
      'Date/time/recurrence in the user’s own words: "明天下午3点", "下周五", "每周一", "tomorrow 3pm"',
    ),
  project: z.string().optional().describe('Existing project name, or "Inbox"'),
  section: z.string().optional(),
  labels: z.array(z.string()).optional(),
  priority: priority.optional(),
  notes: z.string().optional(),
  deadline: z
    .string()
    .optional()
    .describe(
      'Hard deadline in the user’s words (“周五之前交” → "周五", "月底", "due Monday"), separate from when they plan to do it',
    ),
  parentId: z.string().optional().describe('Make it a subtask of this task id'),
  remindMinutesBefore: remind.optional(),
});

// --- tools -----------------------------------------------------------------------------------

export const getOverview = defineTool({
  name: 'get-overview',
  title: 'Overview',
  description:
    'Start here. Returns today’s date, overdue and today’s tasks, Inbox count, and every project with sections and open-task counts, plus labels.',
  input: {},
  readOnly: true,
  run(env) {
    const s = env.store;
    const td = todayView(s, env.today);
    const sb = sidebar(s);
    const open = (pid: string) =>
      s.all('task').filter((t) => t.projectId === pid && !t.completedAt && !t.deletedAt).length;
    const b = (t: Task) => briefTask(s, t, (x) => env.ref(x));
    return {
      today: env.today,
      timeZone: env.timeZone,
      overdue: td.overdue.map(b),
      todayTasks: td.today.map(b),
      inboxOpen: s.all('task').filter((t) => !t.projectId && !t.completedAt && !t.deletedAt && !t.parentId)
        .length,
      projects: sb.projects.flatMap(({ project, children }) =>
        [project, ...children].map((p) => ({
          name: p.name,
          ...(p.parentId ? { group: s.get('project', p.parentId)?.name } : {}),
          openTasks: open(p.id),
          sections: sortByOrder(live(s.all('section')).filter((x) => x.projectId === p.id)).map(
            (x) => x.name,
          ),
        })),
      ),
      labels: sb.labels.map((l) => l.name),
      memory: memories(s).map((m) => m.text),
      dayParts: dayParts(s),
    };
  },
});

export const findTasks = defineTool({
  name: 'find-tasks',
  title: 'Find tasks',
  description:
    'Search tasks by text and/or filter them (project, label, date, deadline, priority), e.g. to act on a group: “工作里没日期的” = project "工作" + date "none". Open tasks only unless includeCompleted. Searches are substring matches, so try a shorter keyword if nothing is found.',
  input: {
    query: z.string().optional().describe('Text to match in titles and notes'),
    project: z.string().optional().describe('Project name, or "Inbox"'),
    label: z.string().optional(),
    date: z
      .enum(['none', 'any', 'overdue', 'today', 'future'])
      .optional()
      .describe(
        'none = no date set, any = has a date, overdue = date or deadline passed, today = listed today, future = after today',
      ),
    deadline: z
      .string()
      .optional()
      .describe(
        'Only tasks with a deadline on or before this day ("周五", "下周", "月底"); "any" = any deadline',
      ),
    priority: priority.optional(),
    topLevel: z.boolean().optional().describe('Leave out subtasks'),
    includeCompleted: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  readOnly: true,
  run(env, { query, project, label, date, deadline, priority: p, topLevel, includeCompleted, limit = 50 }) {
    const s = env.store;
    let tasks = query ? search(s, query, 500) : live(s.all('task'));
    if (!includeCompleted) tasks = tasks.filter((t) => !t.completedAt);
    if (topLevel) tasks = tasks.filter((t) => !t.parentId);
    if (date) {
      const listed = new Set(
        Object.values(todayView(s, env.today))
          .flat()
          .map((t) => t.id),
      );
      tasks = tasks.filter((t) => {
        if (date === 'none') return !t.scheduled;
        if (date === 'any') return !!t.scheduled;
        if (date === 'overdue') return !t.completedAt && isOverdue(t, env.today);
        if (date === 'today') return listed.has(t.id) && !isOverdue(t, env.today);
        return !!t.scheduled && compareDates(t.scheduled.date, env.today) > 0;
      });
    }
    if (deadline) {
      const by = deadline.trim().toLowerCase() === 'any' ? null : parseDeadline(env, deadline);
      tasks = tasks.filter((t) => t.deadline && (!by || compareDates(t.deadline, by) <= 0));
    }
    if (p) tasks = tasks.filter((t) => t.priority === PRIORITY_VALUE[p]);
    if (project) {
      const p = findProject(s, project);
      if (!p) throw new ToolError(`No project named “${project}”. Projects: ${projectNames(s)}.`);
      tasks = tasks.filter((t) => t.projectId === p.id);
    }
    if (label) {
      const l = live(s.all('label')).find((x) => lower(x.name) === lower(label));
      if (!l) throw new ToolError(`No label named “${label}”.`);
      tasks = tasks.filter((t) => t.labels.includes(l.id));
    }
    return {
      count: tasks.length,
      tasks: sortByOrder(tasks)
        .slice(0, limit)
        .map((t) => briefTask(s, t, (x) => env.ref(x))),
    };
  },
});

export const findTasksByDate = defineTool({
  name: 'find-tasks-by-date',
  title: 'Tasks by date',
  description:
    'Open tasks scheduled in a date range, grouped by day. Includes overdue tasks when the range starts today.',
  input: {
    startDate: z
      .string()
      .optional()
      .describe('YYYY-MM-DD, "today", or a phrase like "下周一" (default today)'),
    days: z.number().int().min(1).max(60).optional().describe('Number of days (default 7)'),
  },
  readOnly: true,
  run(env, { startDate, days = 7 }) {
    const s = env.store;
    const start = !startDate || startDate === 'today' ? env.today : parseWhen(env, startDate).scheduled?.date;
    if (!start) throw new ToolError('startDate must be YYYY-MM-DD or "today"');
    const buckets = upcoming(s, start, days).filter((b) => b.tasks.length);
    const overdue = start === env.today ? todayView(s, env.today).overdue : [];
    const b = (t: Task) => briefTask(s, t, (x) => env.ref(x));
    return {
      ...(overdue.length ? { overdue: overdue.map(b) } : {}),
      days: buckets.map((x) => ({ date: x.date, tasks: x.tasks.map(b) })),
    };
  },
});

export const addTasks = defineTool({
  name: 'add-tasks',
  title: 'Add tasks',
  description:
    'Create one or more tasks (or subtasks, with parentId) in a single undoable step. Dates are parsed from `when` (or from the title) by the app’s own parser, in English or Chinese.',
  input: { tasks: z.array(newTaskInput).min(1).max(50) },
  run(env, { tasks }) {
    const created: string[] = [];
    const inputs: NewTask[] = [];
    for (const t of tasks) {
      const s = env.store;
      const fromTitle = parseQuickAdd(t.title, {
        now: env.now,
        timeZone: env.timeZone,
        projects: live(s.all('project')).map((p) => ({ id: p.id, name: p.name })),
        sections: live(s.all('section')).map((x) => ({ id: x.id, name: x.name, projectId: x.projectId })),
        labels: live(s.all('label')).map((l) => ({ id: l.id, name: l.name })),
        dayParts: dayParts(s),
      });
      const fromWhen = t.when ? parseWhen(env, t.when) : null;
      const parentId = t.parentId ? taskId(env, t.parentId) : null;
      let pid: string | null = fromTitle.project?.id ?? null;
      const projectName =
        t.project ?? (fromTitle.project && !fromTitle.project.id ? fromTitle.project.name : undefined);
      if (projectName && !parentId) pid = projectId(env, projectName, created);
      let sectionId: string | null = null;
      const sectionName = t.section ?? fromTitle.section?.name;
      if (sectionName && pid && !parentId) {
        sectionId =
          live(env.store.all('section')).find(
            (x) => x.projectId === pid && lower(x.name) === lower(sectionName),
          )?.id ?? null;
      }
      const labels = [
        ...fromTitle.labels.flatMap((l) => (l.id ? [l.id] : [])),
        ...labelIds(
          env,
          [...(t.labels ?? []), ...fromTitle.labels.filter((l) => !l.id).map((l) => l.name)],
          created,
        ),
      ];
      const source = fromWhen ?? fromTitle;
      const deadline = t.deadline ? parseDeadline(env, t.deadline) : (source.deadline ?? fromTitle.deadline);
      if (t.remindMinutesBefore != null && !source.scheduled?.time) {
        throw new ToolError(`“${t.title}” needs a time of day for a reminder; include it in \`when\`.`);
      }
      inputs.push({
        title: fromTitle.title || t.title,
        projectId: parentId ? null : pid,
        sectionId,
        ...(parentId ? { parentId } : {}),
        ...(labels.length ? { labels: [...new Set(labels)] } : {}),
        priority: t.priority ? PRIORITY_VALUE[t.priority] : (fromTitle.priority ?? 0),
        ...(t.notes ? { notes: t.notes } : {}),
        ...(source.scheduled ? { scheduled: source.scheduled } : {}),
        ...(source.recurrence ? { recurrence: source.recurrence } : {}),
        ...(deadline ? { deadline } : {}),
        ...(t.remindMinutesBefore != null ? { reminders: reminder(env, t.remindMinutesBefore) } : {}),
      });
    }
    const ids = env.run(createTasks(inputs));
    return {
      created: ids.map((id) => brief(env, id)),
      ...(created.length ? { alsoCreated: created } : {}),
    };
  },
});

export const updateTasks = defineTool({
  name: 'update-tasks',
  title: 'Update tasks',
  description:
    'Edit title, notes, priority, labels, project/section, date, time, deadline or reminder of one or more tasks in one undoable step. To only move tasks to another day, reschedule-tasks is simpler.',
  input: {
    tasks: z
      .array(
        z.object({
          id: z.string(),
          title: z.string().optional(),
          notes: z.string().optional().describe('Replaces the notes'),
          priority: priority.optional(),
          labels: z.array(z.string()).optional().describe('Replaces the labels (names)'),
          project: z.string().optional().describe('Move to this project ("Inbox" for none)'),
          section: z
            .string()
            .nullable()
            .optional()
            .describe('Section in the (new) project, or null for none'),
          when: z
            .string()
            .nullable()
            .optional()
            .describe('New date/time/recurrence phrase in the user’s words, or null to remove the date'),
          time: z
            .string()
            .nullable()
            .optional()
            .describe(
              'Only change the time of day, keeping the date: "16:00"; null makes it an all-day task',
            ),
          deadline: z
            .string()
            .nullable()
            .optional()
            .describe('New deadline in the user’s words ("周五", "月底"), or null to remove it'),
          remindMinutesBefore: remind.optional(),
        }),
      )
      .min(1)
      .max(50),
  },
  run(env, { tasks }) {
    const created: string[] = [];
    for (const t of tasks) {
      const id = taskId(env, t.id);
      const patch: TaskPatch = {
        ...(t.title !== undefined ? { title: t.title } : {}),
        ...(t.notes !== undefined ? { notes: t.notes } : {}),
        ...(t.priority ? { priority: PRIORITY_VALUE[t.priority] } : {}),
        ...(t.labels ? { labels: labelIds(env, t.labels, created) } : {}),
      };
      if (Object.keys(patch).length) env.run(updateTask(id, patch));
      if (t.project !== undefined || t.section !== undefined) {
        const task = env.store.get('task', id) as Task;
        const pid = t.project !== undefined ? projectId(env, t.project, created) : task.projectId;
        let sectionId: string | null = null;
        if (t.section && pid) {
          const sec = live(env.store.all('section')).find(
            (x) => x.projectId === pid && lower(x.name) === lower(t.section as string),
          );
          if (!sec) throw new ToolError(`No section “${t.section}” in that project.`);
          sectionId = sec.id;
        }
        const keepSection = t.section === undefined && pid === task.projectId;
        if (pid !== task.projectId || (!keepSection && sectionId !== task.sectionId)) {
          env.run(
            moveTasks(
              [id],
              sectionId ? { sectionId } : { projectId: pid, ...(keepSection ? {} : { sectionId: null }) },
            ),
          );
        }
      }
      if (t.when !== undefined) {
        if (t.when === null) env.run(rescheduleTasks([id], null));
        else {
          const parsed = parseWhen(env, t.when);
          if (parsed.scheduled) {
            env.run(
              updateTask(id, {
                scheduled: parsed.scheduled,
                ...(parsed.recurrence ? { recurrence: parsed.recurrence } : {}),
              }),
            );
          }
          // “改成周五之前” sets the deadline and leaves the planned day alone.
          if (parsed.deadline && t.deadline === undefined)
            env.run(updateTask(id, { deadline: parsed.deadline }));
        }
      }
      if (t.deadline !== undefined) {
        env.run(updateTask(id, { deadline: t.deadline === null ? null : parseDeadline(env, t.deadline) }));
      }
      if (t.time !== undefined) {
        const task = env.store.get('task', id) as Task;
        if (!task.scheduled) throw new ToolError(`“${task.title}” has no date; set one with \`when\` first.`);
        const { time: _old, ...rest } = task.scheduled;
        env.run(
          updateTask(id, { scheduled: t.time === null ? rest : { ...rest, time: normalizeTime(t.time) } }),
        );
      }
      if (t.remindMinutesBefore !== undefined) {
        const task = env.store.get('task', id) as Task;
        if (t.remindMinutesBefore !== null && !task.scheduled?.time) {
          throw new ToolError(`“${task.title}” needs a time of day for a reminder; set \`time\` too.`);
        }
        env.run(updateTask(id, { reminders: reminder(env, t.remindMinutesBefore) }));
      }
    }
    return {
      updated: tasks.map((t) => brief(env, taskId(env, t.id))),
      ...(created.length ? { alsoCreated: created } : {}),
    };
  },
});

export const completeTasksTool = defineTool({
  name: 'complete-tasks',
  title: 'Complete tasks',
  description: 'Mark tasks done (recurring tasks move to their next date), or reopen them with reopen=true.',
  input: { ids: z.array(z.string()).min(1).max(100), reopen: z.boolean().optional() },
  run(env, { ids, reopen }) {
    const resolved = ids.map((r) => taskId(env, r));
    if (reopen) for (const id of resolved) env.run(uncompleteTask(id));
    else env.run(completeTasks(resolved));
    return { tasks: resolved.map((id) => brief(env, id)) };
  },
});

export const rescheduleTasksTool = defineTool({
  name: 'reschedule-tasks',
  title: 'Reschedule tasks',
  description:
    'Move tasks to another day. The time of day is kept unless the phrase names one. For recurring tasks, mode "occurrence" (default) moves only this one, "series" changes the rule.',
  input: {
    ids: z.array(z.string()).min(1).max(100),
    when: z
      .string()
      .nullable()
      .describe(
        'Date phrase in the user’s words like "明天", "下周一", "周四下午3点", or YYYY-MM-DD; null removes the date',
      ),
    mode: z.enum(['occurrence', 'series']).optional(),
  },
  run(env, { ids, when, mode = 'occurrence' }) {
    const resolved = ids.map((r) => taskId(env, r));
    const parsed = when ? parseWhen(env, when) : null;
    const scheduled = parsed ? (parsed.scheduled ?? { date: parsed.deadline as string }) : null;
    env.run(rescheduleTasks(resolved, scheduled?.date ?? null, mode));
    if (scheduled?.time) {
      for (const id of resolved) {
        const cur = env.store.get('task', id)?.scheduled;
        if (cur) env.run(updateTask(id, { scheduled: { ...cur, time: scheduled.time } }));
      }
    }
    return { tasks: resolved.map((id) => brief(env, id)) };
  },
});

export const deleteTasksTool = defineTool({
  name: 'delete-tasks',
  title: 'Delete tasks',
  description:
    'Move tasks to the trash (they can be restored from there). Prefer complete-tasks when the user finished something.',
  input: { ids: z.array(z.string()).min(1).max(50) },
  destructive: true,
  run(env, { ids }) {
    const resolved = ids.map((r) => taskId(env, r));
    if (env.policy.deleteOnlyAgentMade) {
      const notAllowed = resolved.filter((id) => {
        const t = env.store.get('task', id);
        return !t || (t.origin !== 'mcp' && t.origin !== 'ai');
      });
      if (notAllowed.length) {
        throw new ToolError(
          `These tasks were created by the user and can only be deleted in the app: ${notAllowed.map((id) => env.ref(id)).join(', ')}. Complete them instead, or ask the user.`,
        );
      }
    }
    env.run(deleteTasks(resolved));
    return { trashed: resolved.length };
  },
});

export const createProjectTool = defineTool({
  name: 'create-project',
  title: 'Create project',
  description: 'Create a new project, optionally inside an existing top-level project used as a group.',
  input: {
    name: z.string().min(1),
    group: z.string().optional().describe('Existing top-level project to nest it under'),
  },
  run(env, { name, group }) {
    const existing = findProject(env.store, name);
    if (existing) return { project: name, existed: true };
    let parentId: string | null = null;
    if (group) {
      const g = findProject(env.store, group);
      if (!g?.id) throw new ToolError(`No project named “${group}”.`);
      parentId = g.id;
    }
    env.run(createProject({ name, parentId }));
    return { project: name, created: true };
  },
});

export const undoLastChange = defineTool({
  name: 'undo-last-change',
  title: 'Undo last agent change',
  description: 'Revert the most recent change made by an agent (keeps later edits made in the apps).',
  input: {},
  run(env) {
    if (!env.undoLast()) throw new ToolError('Nothing to undo.');
    return { undone: true };
  },
});

const PERIODS = ['today', 'yesterday', 'this-week', 'last-week', 'last-7-days', 'this-month'] as const;
type Period = (typeof PERIODS)[number];

/** First and last day of a review period, weeks starting on Monday. */
export function periodRange(period: Period, today: LocalDate): { from: LocalDate; to: LocalDate } {
  const monday = addDays(today, 1 - isoWeekday(today));
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'this-week':
      return { from: monday, to: today };
    case 'last-week':
      return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case 'last-7-days':
      return { from: addDays(today, -6), to: today };
    case 'this-month':
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

export const reviewTool = defineTool({
  name: 'review-period',
  title: 'Review a period',
  description:
    'What got done in a period (“这周做了什么”, “回顾一下这周”, “昨天完成了哪些”): completed tasks by day and project, plus what is overdue now and how much is planned for the next 7 days.',
  input: {
    period: z.enum(PERIODS).optional().describe('Default this-week (Monday until today)'),
  },
  readOnly: true,
  run(env, { period = 'this-week' }) {
    const s = env.store;
    const { from, to } = periodRange(period, env.today);
    const done: { date: LocalDate; title: string; project: string }[] = [];
    const projectName = (id: string | null) => (id ? (s.get('project', id)?.name ?? 'Inbox') : 'Inbox');
    for (const e of logbook(s, 2000)) {
      const date = wallClock(new Date(e.completedAt), env.timeZone).date;
      if (compareDates(date, from) < 0) break;
      if (compareDates(date, to) > 0) continue;
      if (e.kind === 'task') {
        if (e.task.parentId) continue;
        done.push({ date, title: e.task.title, project: projectName(e.task.projectId) });
      } else done.push({ date, title: e.completion.title, project: projectName(e.completion.projectId) });
    }
    const byProject: Record<string, number> = {};
    for (const d of done) byProject[d.project] = (byProject[d.project] ?? 0) + 1;
    const added = live(s.all('task')).filter((t) => {
      const d = wallClock(new Date(t.createdAt), env.timeZone).date;
      return !t.parentId && compareDates(d, from) >= 0 && compareDates(d, to) <= 0;
    }).length;
    const td = todayView(s, env.today);
    const next = upcoming(s, addDays(env.today, 1), 7).reduce((n, b) => n + b.tasks.length, 0);
    return {
      from,
      to,
      completedCount: done.length,
      completedByProject: byProject,
      completed: done.slice(0, 80).reverse(),
      added,
      overdue: td.overdue.slice(0, 20).map((t) => briefTask(s, t, (x) => env.ref(x))),
      today: td.today.length,
      next7Days: next,
    };
  },
});

export const rememberTool = defineTool({
  name: 'remember',
  title: 'Remember',
  description:
    'Save something the user wants you to keep in mind from now on (“记住张三是我老板”, “以后健身的事都放生活”). For what a bare 早上/晚上 means, use set-preferences instead.',
  input: { text: z.string().min(1).max(500).describe('One short sentence, in the user’s language') },
  run(env, { text }) {
    const same = memories(env.store).find((m) => lower(m.text) === lower(text));
    if (same) return { remembered: same.text, existed: true };
    env.run(addMemory(text));
    return { remembered: text.trim() };
  },
});

export const forgetTool = defineTool({
  name: 'forget',
  title: 'Forget',
  description: 'Drop something you were told to remember (“别再记着张三的事了”).',
  input: { text: z.string().min(1).describe('Words from the memory to drop') },
  run(env, { text }) {
    const all = memories(env.store);
    const q = lower(text);
    const hits = all.filter((m) => lower(m.text).includes(q) || q.includes(lower(m.text)));
    if (!hits.length) {
      throw new ToolError(
        `Nothing remembered matches “${text}”. Memories: ${all.map((m) => `“${m.text}”`).join(', ') || '(none)'}.`,
      );
    }
    for (const m of hits) env.run(deleteMemory(m.id));
    return { forgot: hits.map((m) => m.text) };
  },
});

export const setPreferences = defineTool({
  name: 'set-preferences',
  title: 'Set preferences',
  description:
    'Change what a bare day-part word means when the user gives no clock time (“我说早上一般是8点”, “晚上指九点”). The app’s date parser uses these times for 早上/中午/下午/晚上.',
  input: Object.fromEntries(
    DAY_PART_NAMES.map((k) => [k, z.string().optional().describe(`HH:mm for ${k}`)]),
  ) as Record<(typeof DAY_PART_NAMES)[number], z.ZodOptional<z.ZodString>>,
  run(env, input) {
    const next: DayParts = { ...dayParts(env.store) };
    for (const k of DAY_PART_NAMES) {
      const v = input[k];
      if (v !== undefined) next[k] = normalizeTime(v);
    }
    env.run(setSetting(DAY_PARTS_KEY, next));
    return { dayParts: next };
  },
});

export const askUser = defineTool({
  name: 'ask-user',
  title: 'Ask the user',
  description:
    'Ask one short question when the request is ambiguous, e.g. two tasks both match “张三那个”. The app shows the options as buttons and ends your turn; the user’s answer comes as the next message. Don’t guess between candidates, and don’t ask when one clearly matches.',
  input: {
    question: z.string().min(1).describe('One short spoken-style question in the user’s language'),
    options: z
      .array(z.string().min(1).max(60))
      .min(2)
      .max(6)
      .optional()
      .describe('Short answers to pick from, e.g. the candidate task titles'),
  },
  readOnly: true,
  appOnly: true,
  run(_env, { question, options }) {
    return { asked: question, ...(options ? { options } : {}) };
  },
});

export const AGENT_TOOLS: readonly AgentTool[] = [
  getOverview,
  findTasks,
  findTasksByDate,
  reviewTool,
  addTasks,
  updateTasks,
  completeTasksTool,
  rescheduleTasksTool,
  deleteTasksTool,
  createProjectTool,
  rememberTool,
  forgetTool,
  setPreferences,
  askUser,
  undoLastChange,
];

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function agentTool(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}

/** Validate and run one tool call. Errors meant for the model come back as `{ error: true }`. */
export function executeTool(
  env: ToolEnv,
  name: string,
  input: unknown,
  allowed: readonly AgentTool[] = AGENT_TOOLS,
): { output: unknown; error?: true } {
  const tool = allowed.find((t) => t.name === name);
  if (!tool) return { output: `Unknown tool “${name}”.`, error: true };
  const parsed = tool.schema.safeParse(input ?? {});
  if (!parsed.success) return { output: `Invalid input: ${z.prettifyError(parsed.error)}`, error: true };
  try {
    return { output: tool.run(env, parsed.data) };
  } catch (e) {
    if (e instanceof ToolError || e instanceof CommandError) return { output: e.message, error: true };
    throw e;
  }
}
