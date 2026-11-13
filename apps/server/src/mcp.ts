import {
  type Command,
  completeTasks,
  createLabel,
  createProject,
  createTasks,
  deleteTasks,
  moveTasks,
  type NewTask,
  type Priority,
  parseQuickAdd,
  type ReadStore,
  rescheduleTasks,
  search,
  sidebar,
  sortByOrder,
  type Task,
  today as todayView,
  uncompleteTask,
  upcoming,
  updateTask,
} from '@ai-todo/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Hub } from './hub';

/**
 * MCP server exposing the task list to agents (Claude Code, Claude Desktop, …).
 *
 * Tools are few and workflow-shaped (find, add several, update several, complete, reschedule,
 * overview) rather than raw CRUD. Every change goes through the same commands as the apps, is
 * tagged `mcp`, syncs to all devices, and can be undone (`undo-last-change`). Agents can only
 * delete tasks that an agent created; there is no hard delete.
 */

const PRIORITY_NAME: Record<Priority, string> = { 3: 'p1', 2: 'p2', 1: 'p3', 0: 'p4' };
const PRIORITY_VALUE: Record<string, Priority> = { p1: 3, p2: 2, p3: 1, p4: 0 };

function summarize(s: ReadStore, t: Task) {
  const project = t.projectId ? s.get('project', t.projectId) : null;
  const section = t.sectionId ? s.get('section', t.sectionId) : null;
  const labels = t.labels.map((id) => s.get('label', id)?.name).filter(Boolean);
  return {
    id: t.id,
    title: t.title,
    ...(t.scheduled
      ? { date: t.scheduled.date, ...(t.scheduled.time ? { time: t.scheduled.time } : {}) }
      : {}),
    ...(t.recurrence ? { repeat: t.recurrence.rule, repeatFrom: t.recurrence.from } : {}),
    project: project?.name ?? 'Inbox',
    ...(section ? { section: section.name } : {}),
    ...(labels.length ? { labels } : {}),
    priority: PRIORITY_NAME[t.priority],
    ...(t.notes ? { notes: t.notes.length > 400 ? `${t.notes.slice(0, 400)}…` : t.notes } : {}),
    ...(t.parentId ? { parentId: t.parentId } : {}),
    ...(t.completedAt ? { completed: true } : {}),
  };
}

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function createMcpServer(hub: Hub): McpServer {
  const server = new McpServer({ name: 'docket', version: '1.0.0' }, { capabilities: { tools: {} } });
  const store = () => hub.replica.store;
  const ctx = () => hub.replica.context('mcp');

  const findProject = (name: string) => {
    const n = name.trim().toLowerCase();
    if (n === 'inbox' || n === '收件箱') return { id: null as string | null };
    const p = store()
      .all('project')
      .find((x) => !x.deletedAt && x.name.toLowerCase() === n);
    return p ? { id: p.id } : undefined;
  };

  const run = <R>(cmd: Command<R>) => {
    try {
      return { value: hub.dispatch(cmd, 'mcp') };
    } catch (e) {
      return { error: (e as Error).message };
    }
  };

  server.registerTool(
    'get-overview',
    {
      title: 'Overview',
      description:
        'Start here. Returns today’s date, overdue and today’s tasks, Inbox count, and every project with sections and open-task counts, plus labels.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const s = store();
      const { today } = ctx();
      const td = todayView(s, today);
      const sb = sidebar(s);
      const open = (pid: string) =>
        s.all('task').filter((t) => t.projectId === pid && !t.completedAt && !t.deletedAt).length;
      return ok({
        today,
        timeZone: hub.replica.timeZone,
        overdue: td.overdue.map((t) => summarize(s, t)),
        todayTasks: td.today.map((t) => summarize(s, t)),
        inboxOpen: s.all('task').filter((t) => !t.projectId && !t.completedAt && !t.deletedAt && !t.parentId)
          .length,
        projects: sb.projects.flatMap(({ project, children }) =>
          [project, ...children].map((p) => ({
            name: p.name,
            ...(p.parentId ? { group: s.get('project', p.parentId)?.name } : {}),
            openTasks: open(p.id),
            sections: sortByOrder(s.all('section').filter((x) => x.projectId === p.id && !x.deletedAt)).map(
              (x) => x.name,
            ),
          })),
        ),
        labels: sb.labels.map((l) => l.name),
      });
    },
  );

  server.registerTool(
    'find-tasks',
    {
      title: 'Find tasks',
      description:
        'Search tasks by text and/or filter by project or label. Open tasks only unless includeCompleted.',
      inputSchema: {
        query: z.string().optional().describe('Text to match in titles and notes'),
        project: z.string().optional().describe('Project name, or "Inbox"'),
        label: z.string().optional(),
        includeCompleted: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, project, label, includeCompleted, limit = 50 }) => {
      const s = store();
      let tasks = query ? search(s, query, 500) : s.all('task').filter((t) => !t.deletedAt);
      if (!includeCompleted) tasks = tasks.filter((t) => !t.completedAt);
      if (project) {
        const p = findProject(project);
        if (!p) return fail(`No project named "${project}". Call get-overview to see projects.`);
        tasks = tasks.filter((t) => t.projectId === p.id);
      }
      if (label) {
        const l = s.all('label').find((x) => !x.deletedAt && x.name.toLowerCase() === label.toLowerCase());
        if (!l) return fail(`No label named "${label}".`);
        tasks = tasks.filter((t) => t.labels.includes(l.id));
      }
      return ok({
        count: tasks.length,
        tasks: sortByOrder(tasks)
          .slice(0, limit)
          .map((t) => summarize(s, t)),
      });
    },
  );

  server.registerTool(
    'find-tasks-by-date',
    {
      title: 'Tasks by date',
      description:
        'Open tasks scheduled in a date range, grouped by day. Includes overdue tasks when the range starts today.',
      inputSchema: {
        startDate: z.string().optional().describe('YYYY-MM-DD or "today" (default today)'),
        days: z.number().int().min(1).max(60).optional().describe('Number of days (default 7)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ startDate, days = 7 }) => {
      const s = store();
      const { today } = ctx();
      const start = !startDate || startDate === 'today' ? today : startDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return fail('startDate must be YYYY-MM-DD or "today"');
      const buckets = upcoming(s, start, days).filter((b) => b.tasks.length);
      const overdue = start === today ? todayView(s, today).overdue : [];
      return ok({
        ...(overdue.length ? { overdue: overdue.map((t) => summarize(s, t)) } : {}),
        days: buckets.map((b) => ({ date: b.date, tasks: b.tasks.map((t) => summarize(s, t)) })),
      });
    },
  );

  const taskInput = z.object({
    title: z
      .string()
      .min(1)
      .describe('Task title. May include quick-add syntax like "#Project @label p1 明天下午3点".'),
    when: z
      .string()
      .optional()
      .describe('Natural-language date/time/recurrence, e.g. "tomorrow 3pm", "下周五", "every Monday"'),
    project: z.string().optional().describe('Existing project name (created if missing), or "Inbox"'),
    section: z.string().optional(),
    labels: z.array(z.string()).optional(),
    priority: z.enum(['p1', 'p2', 'p3', 'p4']).optional(),
    notes: z.string().optional(),
    parentId: z.string().optional().describe('Make it a subtask of this task id'),
  });

  server.registerTool(
    'add-tasks',
    {
      title: 'Add tasks',
      description:
        'Create one or more tasks in a single undoable step. Dates are parsed from `when` (or from the title) by the app’s own parser, in English or Chinese.',
      inputSchema: { tasks: z.array(taskInput).min(1).max(50) },
    },
    async ({ tasks }) => {
      const s = store();
      const now = new Date();
      const created: string[] = [];
      const inputs: NewTask[] = [];
      for (const t of tasks) {
        const projects = s
          .all('project')
          .filter((p) => !p.deletedAt)
          .map((p) => ({ id: p.id, name: p.name }));
        const labelsAll = s
          .all('label')
          .filter((l) => !l.deletedAt)
          .map((l) => ({ id: l.id, name: l.name }));
        const fromTitle = parseQuickAdd(t.title, {
          now,
          timeZone: hub.replica.timeZone,
          projects,
          labels: labelsAll,
        });
        const fromWhen = t.when ? parseQuickAdd(t.when, { now, timeZone: hub.replica.timeZone }) : null;
        if (t.when && !fromWhen?.scheduled)
          return fail(`Could not understand when="${t.when}". Try e.g. "tomorrow 3pm" or "2026-12-01".`);
        let projectId: string | null = fromTitle.project?.id ?? null;
        const projectName =
          t.project ?? (fromTitle.project && !fromTitle.project.id ? fromTitle.project.name : undefined);
        if (projectName) {
          const found = findProject(projectName);
          if (found) projectId = found.id;
          else {
            const r = run(createProject({ name: projectName }));
            if (r.error) return fail(r.error);
            projectId = r.value?.result ?? null;
            created.push(`project “${projectName}”`);
          }
        }
        let sectionId: string | null = null;
        if (t.section && projectId) {
          sectionId =
            s
              .all('section')
              .find(
                (x) =>
                  x.projectId === projectId &&
                  !x.deletedAt &&
                  x.name.toLowerCase() === t.section?.toLowerCase(),
              )?.id ?? null;
        }
        const labelIds: string[] = fromTitle.labels.flatMap((l) => (l.id ? [l.id] : []));
        for (const name of [
          ...(t.labels ?? []),
          ...fromTitle.labels.filter((l) => !l.id).map((l) => l.name),
        ]) {
          const existing = s
            .all('label')
            .find((l) => !l.deletedAt && l.name.toLowerCase() === name.toLowerCase());
          if (existing) labelIds.push(existing.id);
          else {
            const r = run(createLabel({ name }));
            if (r.value) labelIds.push(r.value.result);
          }
        }
        const source = fromWhen ?? fromTitle;
        inputs.push({
          title: fromTitle.title || t.title,
          projectId: t.parentId ? null : projectId,
          sectionId,
          ...(t.parentId ? { parentId: t.parentId } : {}),
          ...(labelIds.length ? { labels: [...new Set(labelIds)] } : {}),
          priority: t.priority ? PRIORITY_VALUE[t.priority] : (fromTitle.priority ?? 0),
          ...(t.notes ? { notes: t.notes } : {}),
          ...(source.scheduled ? { scheduled: source.scheduled } : {}),
          ...(source.recurrence ? { recurrence: source.recurrence } : {}),
        });
      }
      const r = run(createTasks(inputs));
      if (r.error || !r.value) return fail(r.error ?? 'failed');
      const s2 = store();
      return ok({
        created: r.value.result.map((id) => summarize(s2, s2.get('task', id) as Task)),
        ...(created.length ? { alsoCreated: created } : {}),
        undo: 'Call undo-last-change to revert this.',
      });
    },
  );

  server.registerTool(
    'update-tasks',
    {
      title: 'Update tasks',
      description:
        'Edit title, notes, priority, labels, project or date of one or more tasks in one undoable step.',
      inputSchema: {
        tasks: z
          .array(
            z.object({
              id: z.string(),
              title: z.string().optional(),
              notes: z.string().optional(),
              priority: z.enum(['p1', 'p2', 'p3', 'p4']).optional(),
              labels: z.array(z.string()).optional().describe('Replaces the labels (names)'),
              project: z.string().optional().describe('Move to this project ("Inbox" for none)'),
              when: z.string().nullable().optional().describe('New date phrase, or null to remove the date'),
            }),
          )
          .min(1)
          .max(50),
      },
    },
    async ({ tasks }) => {
      const s = store();
      const now = new Date();
      const commands: Command<unknown>[] = [];
      for (const t of tasks) {
        const task = s.get('task', t.id);
        if (!task || task.deletedAt) return fail(`No task with id ${t.id}`);
        let labels: string[] | undefined;
        if (t.labels) {
          labels = [];
          for (const name of t.labels) {
            const l = s.all('label').find((x) => !x.deletedAt && x.name.toLowerCase() === name.toLowerCase());
            if (l) labels.push(l.id);
            else {
              const r = run(createLabel({ name }));
              if (r.value) labels.push(r.value.result);
            }
          }
        }
        commands.push(
          updateTask(t.id, {
            ...(t.title !== undefined ? { title: t.title } : {}),
            ...(t.notes !== undefined ? { notes: t.notes } : {}),
            ...(t.priority ? { priority: PRIORITY_VALUE[t.priority] } : {}),
            ...(labels ? { labels } : {}),
          }),
        );
        if (t.project !== undefined) {
          const p = findProject(t.project);
          if (!p) return fail(`No project named "${t.project}".`);
          commands.push(moveTasks([t.id], { projectId: p.id }));
        }
        if (t.when !== undefined) {
          if (t.when === null) commands.push(rescheduleTasks([t.id], null));
          else {
            const parsed = parseQuickAdd(t.when, { now, timeZone: hub.replica.timeZone });
            if (!parsed.scheduled) return fail(`Could not understand when="${t.when}".`);
            commands.push(
              updateTask(t.id, {
                scheduled: parsed.scheduled,
                ...(parsed.recurrence ? { recurrence: parsed.recurrence } : {}),
              }),
            );
          }
        }
      }
      const r = run({
        label: `update ${tasks.length} tasks`,
        run: (c) => {
          const mutations = commands.flatMap((cmd) => cmd.run(c).mutations);
          return { mutations, result: undefined };
        },
      });
      if (r.error) return fail(r.error);
      const s2 = store();
      return ok({ updated: tasks.map((t) => summarize(s2, s2.get('task', t.id) as Task)) });
    },
  );

  server.registerTool(
    'complete-tasks',
    {
      title: 'Complete tasks',
      description:
        'Mark tasks done (recurring tasks move to their next date), or reopen them with reopen=true.',
      inputSchema: { ids: z.array(z.string()).min(1).max(100), reopen: z.boolean().optional() },
    },
    async ({ ids, reopen }) => {
      const r = reopen
        ? run({
            label: `reopen ${ids.length} tasks`,
            run: (c) => ({
              mutations: ids.flatMap((id) => uncompleteTask(id).run(c).mutations),
              result: undefined,
            }),
          })
        : run(completeTasks(ids));
      if (r.error) return fail(r.error);
      const s = store();
      return ok({ tasks: ids.map((id) => summarize(s, s.get('task', id) as Task)) });
    },
  );

  server.registerTool(
    'reschedule-tasks',
    {
      title: 'Reschedule tasks',
      description:
        'Move tasks to another day (time of day is kept). For recurring tasks, mode "occurrence" moves only this one, "series" changes the rule.',
      inputSchema: {
        ids: z.array(z.string()).min(1).max(100),
        when: z
          .string()
          .nullable()
          .describe('Date phrase like "tomorrow", "下周一", "2026-12-01"; null removes the date'),
        mode: z.enum(['occurrence', 'series']).optional(),
      },
    },
    async ({ ids, when, mode = 'occurrence' }) => {
      let date: string | null = null;
      if (when) {
        const parsed = /^\d{4}-\d{2}-\d{2}$/.test(when)
          ? { scheduled: { date: when } }
          : parseQuickAdd(when, { now: new Date(), timeZone: hub.replica.timeZone });
        if (!parsed.scheduled) return fail(`Could not understand when="${when}".`);
        date = parsed.scheduled.date;
      }
      const r = run(rescheduleTasks(ids, date, mode));
      if (r.error) return fail(r.error);
      const s = store();
      return ok({ tasks: ids.map((id) => summarize(s, s.get('task', id) as Task)) });
    },
  );

  server.registerTool(
    'delete-tasks',
    {
      title: 'Delete tasks',
      description:
        'Move tasks to the trash. Only tasks created by an agent (MCP or AI) can be deleted this way.',
      inputSchema: { ids: z.array(z.string()).min(1).max(50) },
      annotations: { destructiveHint: true },
    },
    async ({ ids }) => {
      const s = store();
      const notAllowed = ids.filter((id) => {
        const t = s.get('task', id);
        return !t || (t.origin !== 'mcp' && t.origin !== 'ai');
      });
      if (notAllowed.length) {
        return fail(
          `These tasks were created by the user and can only be deleted in the app: ${notAllowed.join(', ')}. Complete them instead, or ask the user.`,
        );
      }
      const r = run(deleteTasks(ids));
      if (r.error) return fail(r.error);
      return ok({ trashed: ids.length });
    },
  );

  server.registerTool(
    'undo-last-change',
    {
      title: 'Undo last agent change',
      description:
        'Revert the most recent change made through this MCP server (keeps later edits made in the apps).',
      inputSchema: {},
    },
    async () => (hub.revert() ? ok({ undone: true }) : fail('Nothing to undo.')),
  );

  return server;
}
