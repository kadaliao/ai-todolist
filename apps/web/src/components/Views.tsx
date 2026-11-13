import {
  archiveProject,
  createSection,
  deleteSection,
  inbox,
  type LogbookEntry,
  labelTasks,
  logbook,
  projectView,
  restoreTask,
  search,
  today as todayView,
  trash,
  upcoming,
  updateProject,
  updateSection,
} from '@ai-todo/core';
import { daysBetween, formatDay, formatMonthDay, getLocale, t, weekdayName } from '@ai-todo/shared';
import { useDroppable } from '@dnd-kit/react';
import { Archive, Hash, MoreHorizontal, Pencil, Plus, Repeat, RotateCcw, Tag, Trash2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { removeProject, rescheduleAllOverdue, run, toggleComplete } from '../state/actions';
import { useQuery, useReplica, useToday } from '../state/replica';
import { useUI } from '../state/ui';
import { Checkbox } from './Checkbox';
import { QuickAdd } from './QuickAdd';
import { flatten, parseGroup, scopeGroup, TaskList, useChildMap, useRegisterVisible } from './TaskList';
import { Button, cx, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './ui';

export function ViewHeader({
  title,
  sub,
  actions,
  numeral,
  dot,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  numeral?: string;
  /** Project color shown before the title. */
  dot?: string | null;
}) {
  return (
    <header className="flex items-end gap-3 pb-4 pt-7">
      {numeral && (
        <span
          className="font-display text-[44px] font-[640] leading-[0.82] tracking-[-0.04em] text-jade tabular-nums"
          aria-hidden
        >
          {numeral}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2.5 truncate font-display text-[26px] font-[650] leading-[1.05] tracking-[-0.02em]">
          {dot !== undefined && (
            <span
              className="size-[11px] shrink-0 rounded-full"
              style={{ background: dot ?? 'var(--ink-3)' }}
              aria-hidden
            />
          )}
          {title}
        </h1>
        {sub && <div className="mt-1 text-[12.5px] text-ink-3">{sub}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1 pb-0.5">{actions}</div>}
    </header>
  );
}

export function Empty({ title, body, icon }: { title: string; body?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 pb-10 pt-16 text-center">
      <div className="mb-4 text-jade">{icon ?? <EmptyMark />}</div>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-[320px] text-[13px] leading-relaxed text-ink-3">{body}</p>}
    </div>
  );
}

function EmptyMark() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden>
      <circle cx="32" cy="32" r="22" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      <circle
        cx="32"
        cy="32"
        r="22"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="34 200"
        strokeLinecap="round"
        transform="rotate(-90 32 32)"
      />
      <path
        d="M23.5 32.5 29 38l11.5-12"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GroupHeader({
  children,
  right,
  count,
  tone,
}: {
  children: ReactNode;
  right?: ReactNode;
  count?: number;
  tone?: 'overdue';
}) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-line pl-1.5">
      <h2 className={cx('text-[13px] font-semibold', tone === 'overdue' ? 'text-p1' : 'text-ink')}>
        {children}
      </h2>
      {count !== undefined && count > 0 && (
        <span className="text-[12px] tabular-nums text-ink-3">{count}</span>
      )}
      <div className="ml-auto flex items-center">{right}</div>
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[760px] px-6 pb-32 max-md:px-4">{children}</div>;
}

// ---------------------------------------------------------------------------------------------

export function TodayView() {
  const today = useToday();
  const data = useQuery((s) => todayView(s, today), [today]);
  const childMap = useChildMap();
  const ids = [...data.overdue, ...data.today].map((t) => t.id);
  useRegisterVisible(ids);
  const [, m, d] = today.split('-').map(Number) as [number, number, number];
  const zh = getLocale() === 'zh';
  return (
    <Page>
      <ViewHeader
        numeral={String(d)}
        title={t('nav.today')}
        sub={
          zh
            ? `${m}月 · ${weekdayName(today)}`
            : `${weekdayName(today)}, ${new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { month: 'long' })}`
        }
      />
      <QuickAdd defaults={{ date: today }} />
      {data.overdue.length > 0 && (
        <section className="mt-6">
          <GroupHeader
            tone="overdue"
            count={data.overdue.length}
            right={
              <Button
                variant="ghost"
                size="sm"
                onClick={rescheduleAllOverdue}
                className="text-jade hover:text-jade"
              >
                {t('today.rescheduleAll')}
              </Button>
            }
          >
            {t('today.overdue')}
          </GroupHeader>
          <div className="pt-1">
            <TaskList
              tasks={data.overdue}
              group="day:overdue"
              options={{ showProject: true }}
              childMap={childMap}
            />
          </div>
        </section>
      )}
      <section className="mt-6">
        {data.overdue.length > 0 && <GroupHeader count={data.today.length}>{t('nav.today')}</GroupHeader>}
        <div className="pt-1">
          <TaskList
            tasks={data.today}
            group={`day:${today}`}
            options={{ showProject: true, showDate: false }}
            childMap={childMap}
            empty={
              !data.overdue.length ? (
                <Empty title={t('today.empty.title')} body={t('today.empty.body')} />
              ) : null
            }
          />
        </div>
      </section>
    </Page>
  );
}

export function InboxView() {
  const tasks = useQuery((s) => inbox(s));
  const childMap = useChildMap();
  const collapsed = useUI((s) => s.collapsed);
  useRegisterVisible(flatten(tasks, childMap, collapsed, true));
  return (
    <Page>
      <ViewHeader title={t('nav.inbox')} />
      <QuickAdd defaults={{ projectId: null }} />
      <div className="mt-4">
        <TaskList
          tasks={tasks}
          group={scopeGroup(null, null, null)}
          nest
          childMap={childMap}
          empty={<Empty title={t('inbox.empty.title')} body={t('inbox.empty.body')} />}
        />
      </div>
    </Page>
  );
}

export function UpcomingView() {
  const today = useToday();
  const [days, setDays] = useState(21);
  const buckets = useQuery((s) => upcoming(s, today, days), [today, days]);
  const childMap = useChildMap();
  useRegisterVisible(buckets.flatMap((b) => b.tasks.map((t) => t.id)));
  const [adding, setAdding] = useState<string | null>(null);
  return (
    <Page>
      <ViewHeader title={t('nav.upcoming')} />
      <div className="flex flex-col">
        {buckets.map((b) => {
          const diff = daysBetween(today, b.date);
          const [, , day] = b.date.split('-').map(Number) as [number, number, number];
          const empty = !b.tasks.length && adding !== b.date;
          return (
            <section key={b.date} className={empty ? 'pt-2' : 'pb-3 pt-4'}>
              <DayDrop date={b.date}>
                <div className="group flex h-9 items-center gap-2 border-b border-line pl-1.5">
                  <span
                    className={cx(
                      'font-display text-[17px] font-[640] tabular-nums tracking-[-0.02em]',
                      diff === 0 ? 'text-jade' : empty ? 'text-ink-3' : 'text-ink',
                    )}
                  >
                    {day}
                  </span>
                  <span
                    className={cx(
                      'text-[13px] font-semibold',
                      diff === 0 ? 'text-jade' : empty && 'font-medium text-ink-3',
                    )}
                  >
                    {diff <= 1 ? formatDay(b.date, today) : weekdayName(b.date)}
                  </span>
                  {diff > 1 && <span className="text-[12px] text-ink-3">{formatMonthDay(b.date)}</span>}
                  <button
                    type="button"
                    aria-label={t('qa.placeholderShort')}
                    onClick={() => setAdding(b.date)}
                    className="ml-auto mr-1 grid size-6 place-items-center rounded-[6px] text-ink-3 opacity-0 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </DayDrop>
              {(b.tasks.length > 0 || adding === b.date) && (
                <div className="pt-1">
                  <TaskList
                    tasks={b.tasks}
                    group={`day:${b.date}`}
                    options={{ showProject: true, showDate: false }}
                    childMap={childMap}
                  />
                  {adding === b.date && (
                    <div className="py-1.5">
                      <QuickAdd
                        defaults={{ date: b.date }}
                        autoFocus
                        compact
                        onDone={() => setAdding(null)}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        <Button variant="ghost" className="mt-4 self-start" onClick={() => setDays((d) => d + 21)}>
          {getLocale() === 'zh' ? '显示更多日期' : 'Show more days'}
        </Button>
      </div>
    </Page>
  );
}

/** Day headers in Upcoming accept tasks dropped onto them. */
function DayDrop({ date, children }: { date: string; children: ReactNode }) {
  const { ref, isDropTarget } = useDroppable({
    id: `drop:day:${date}`,
    accept: 'task',
    data: { kind: 'day', date },
  });
  return (
    <div ref={ref} className={cx('rounded-[8px] transition-colors', isDropTarget && 'bg-jade-soft')}>
      {children}
    </div>
  );
}

export function ProjectPage({ id }: { id: string }) {
  const view = useQuery((s) => projectView(s, id), [id]);
  const childMap = useChildMap();
  const collapsed = useUI((s) => s.collapsed);
  const [addingSection, setAddingSection] = useState(false);
  const allTop = view?.groups.flatMap((g) => g.tasks) ?? [];
  useRegisterVisible(flatten(allTop, childMap, collapsed, true));
  if (!view)
    return (
      <Page>
        <Empty title={t('project.empty.title')} />
      </Page>
    );
  const total = allTop.length;
  return (
    <Page>
      <ViewHeader
        title={view.project.name}
        dot={view.project.color}
        sub={total ? t('count.tasks', { n: total }) : undefined}
        actions={<ProjectMenu id={id} onAddSection={() => setAddingSection(true)} />}
      />
      <QuickAdd defaults={{ projectId: id }} />
      <div className="mt-4 flex flex-col gap-6">
        {view.groups.map((g) =>
          g.section ? (
            <section key={g.section.id}>
              <SectionHeader id={g.section.id} name={g.section.name} count={g.tasks.length} />
              <div className="pt-1">
                <TaskList
                  tasks={g.tasks}
                  group={scopeGroup(id, g.section.id, null)}
                  nest
                  childMap={childMap}
                />
                {!g.tasks.length && (
                  <p className="py-2 pl-1.5 text-[12.5px] text-ink-3">{t('upcoming.empty')}</p>
                )}
              </div>
            </section>
          ) : (
            <div key="none">
              <TaskList
                tasks={g.tasks}
                group={scopeGroup(id, null, null)}
                nest
                childMap={childMap}
                empty={
                  view.groups.length === 1 ? (
                    <Empty title={t('project.empty.title')} body={t('project.empty.body')} />
                  ) : null
                }
              />
            </div>
          ),
        )}
        {addingSection ? (
          <NameInput
            placeholder={t('section.namePlaceholder')}
            onSubmit={(name) => {
              run(createSection({ projectId: id, name }));
              setAddingSection(false);
            }}
            onCancel={() => setAddingSection(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingSection(true)}
            className="group flex items-center gap-3 py-1 text-[13px] text-ink-3 hover:text-jade"
          >
            <span className="h-px flex-1 bg-line group-hover:bg-jade-line" />
            {t('section.add')}
            <span className="h-px flex-1 bg-line group-hover:bg-jade-line" />
          </button>
        )}
      </div>
    </Page>
  );
}

function SectionHeader({ id, name, count }: { id: string; name: string; count: number }) {
  const [renaming, setRenaming] = useState(false);
  if (renaming)
    return (
      <NameInput
        initial={name}
        placeholder={t('section.namePlaceholder')}
        onSubmit={(n) => {
          run(updateSection(id, { name: n }));
          setRenaming(false);
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  return (
    <GroupHeader
      count={count}
      right={
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label="Section actions"
              className="grid size-6 place-items-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => setRenaming(true)}>
              <Pencil />
              {t('rename')}
            </MenuItem>
            <MenuItem danger onSelect={() => run(deleteSection(id))}>
              <Trash2 />
              {t('delete')}
            </MenuItem>
          </MenuContent>
        </Menu>
      }
    >
      <span onDoubleClick={() => setRenaming(true)}>{name}</span>
    </GroupHeader>
  );
}

export const PROJECT_COLORS = [
  '#d64545',
  '#e0731d',
  '#dd8f12',
  '#1f8f6a',
  '#2b9bb0',
  '#3d6fd9',
  '#6b5bd6',
  '#b0519b',
  '#7b8494',
];

function ProjectMenu({ id, onAddSection }: { id: string; onAddSection: () => void }) {
  const r = useReplica();
  const [renaming, setRenaming] = useState(false);
  const project = useQuery((s) => s.get('project', id), [id]);
  if (!project) return null;
  return (
    <>
      {renaming && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setRenaming(false)}
          onKeyDown={() => {}}
          role="presentation"
        >
          <div
            className="absolute left-1/2 top-[18vh] w-[360px] -translate-x-1/2 rounded-[12px] border border-line bg-raised p-3 shadow-float"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={() => {}}
            role="presentation"
          >
            <NameInput
              initial={project.name}
              placeholder={t('project.namePlaceholder')}
              onSubmit={(name) => {
                run(updateProject(id, { name }));
                setRenaming(false);
              }}
              onCancel={() => setRenaming(false)}
            />
          </div>
        </div>
      )}
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label="Project actions"
            className="grid size-8 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink data-[state=open]:bg-hover"
          >
            <MoreHorizontal className="size-[18px]" />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={() => setRenaming(true)}>
            <Pencil />
            {t('rename')}
          </MenuItem>
          <MenuItem onSelect={onAddSection}>
            <Plus />
            {t('section.add')}
          </MenuItem>
          <div className="flex flex-wrap gap-1.5 px-2 py-2">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => run(updateProject(id, { color: c }))}
                className={cx(
                  'size-[18px] rounded-full ring-offset-2 ring-offset-[var(--raised)]',
                  project.color === c && 'ring-2 ring-[var(--ink-3)]',
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              run(archiveProject(id));
              useUI.getState().navigate({ kind: 'inbox' });
            }}
          >
            <Archive />
            {t('archive')}
          </MenuItem>
          <MenuItem
            danger
            onSelect={() => {
              const n = r.store.all('task').filter((x) => x.projectId === id && !x.deletedAt).length;
              if (!n || confirm(t('project.delete.confirm', { name: project.name, n }))) removeProject(id);
            }}
          >
            <Trash2 />
            {t('delete')}
          </MenuItem>
        </MenuContent>
      </Menu>
    </>
  );
}

export function NameInput({
  initial = '',
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: shown on demand
      autoFocus
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (v.trim() && v !== initial ? onSubmit(v.trim()) : onCancel())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && v.trim()) onSubmit(v.trim());
        if (e.key === 'Escape') onCancel();
      }}
      className="h-9 w-full rounded-[8px] border border-jade-line bg-surface px-3 text-[13.5px] font-medium outline-none placeholder:font-normal placeholder:text-ink-3"
    />
  );
}

export function LabelPage({ id }: { id: string }) {
  const label = useQuery((s) => s.get('label', id), [id]);
  const tasks = useQuery((s) => labelTasks(s, id), [id]);
  useRegisterVisible(tasks.map((t) => t.id));
  return (
    <Page>
      <ViewHeader title={label ? `@${label.name}` : ''} />
      <QuickAdd defaults={{ labels: [id] }} />
      <div className="mt-4">
        <TaskList
          tasks={tasks}
          group="static"
          options={{ showProject: true }}
          empty={<Empty title={t('label.empty.title')} icon={<Tag className="size-10 opacity-60" />} />}
        />
      </div>
    </Page>
  );
}

export function LogbookView() {
  const today = useToday();
  const entries = useQuery((s) => logbook(s, 500));
  const groups = useMemo(() => {
    const map = new Map<string, LogbookEntry[]>();
    for (const e of entries) {
      const day = localDay(e.completedAt);
      const list = map.get(day);
      if (list) list.push(e);
      else map.set(day, [e]);
    }
    return [...map];
  }, [entries]);
  return (
    <Page>
      <ViewHeader title={t('nav.logbook')} />
      {!groups.length && <Empty title={t('logbook.empty.title')} body={t('logbook.empty.body')} />}
      <div className="flex flex-col gap-5">
        {groups.map(([day, list]) => (
          <section key={day}>
            <GroupHeader count={list.length}>{formatDay(day, today)}</GroupHeader>
            <div className="flex flex-col pt-1">
              {list.map((e) =>
                e.kind === 'task' ? (
                  <DoneRow
                    key={e.task.id}
                    title={e.task.title}
                    time={e.completedAt}
                    onUndo={() => toggleComplete(e.task.id)}
                  />
                ) : (
                  <DoneRow key={e.completion.id} title={e.completion.title} time={e.completedAt} repeating />
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function DoneRow({
  title,
  time,
  onUndo,
  repeating,
}: {
  title: string;
  time: string;
  onUndo?: () => void;
  repeating?: boolean;
}) {
  const d = new Date(time);
  return (
    <div className="flex min-h-[38px] items-center gap-2.5 rounded-[8px] py-2 pl-[26px] pr-2 hover:bg-hover">
      <Checkbox priority={0} done onToggle={() => onUndo?.()} />
      <span className="flex-1 truncate text-ink-2">{title}</span>
      {repeating && <Repeat className="size-3 text-ink-3" />}
      <span className="text-[12px] tabular-nums text-ink-3">
        {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
      </span>
    </div>
  );
}

export function TrashView() {
  const tasks = useQuery((s) => trash(s));
  const roots = tasks.filter((t) => !t.parentId || !tasks.some((p) => p.id === t.parentId));
  return (
    <Page>
      <ViewHeader title={t('nav.trash')} />
      {!roots.length && (
        <Empty
          title={t('trash.empty.title')}
          body={t('trash.empty.body')}
          icon={<Trash2 className="size-10 opacity-60" />}
        />
      )}
      <div className="flex flex-col">
        {roots.map((task) => (
          <div
            key={task.id}
            className="group flex min-h-[38px] items-center gap-2.5 rounded-[8px] py-2 pl-[26px] pr-2 hover:bg-hover"
          >
            <span className="check opacity-50" data-priority={task.priority} />
            <span className="flex-1 truncate text-ink-2">{task.title}</span>
            <Button variant="ghost" size="sm" onClick={() => run(restoreTask(task.id))}>
              <RotateCcw className="size-3.5" />
              {t('task.restore')}
            </Button>
          </div>
        ))}
      </div>
    </Page>
  );
}

export function SearchView({ q }: { q: string }) {
  const results = useQuery((s) => search(s, q, 100), [q]);
  useRegisterVisible(results.map((r) => r.id));
  return (
    <Page>
      <ViewHeader title={q ? `“${q}”` : t('nav.search')} />
      {q && !results.length && <Empty title={t('search.empty', { q })} />}
      <TaskList tasks={results} group="static" options={{ showProject: true }} />
    </Page>
  );
}

export function ViewIcon({ projectColor }: { projectColor?: string | null }) {
  return <Hash className="size-[18px]" style={{ color: projectColor ?? 'var(--ink-3)' }} />;
}

export { parseGroup };
