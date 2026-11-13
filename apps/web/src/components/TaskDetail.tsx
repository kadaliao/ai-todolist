import { createTask, createTasks, type Reminder, sortByOrder, type Task, updateTask } from '@ai-todo/core';
import { describeRecurrence, formatScheduled, getLocale, t, weekdayName } from '@ai-todo/shared';
import {
  Bell,
  Calendar,
  Flag,
  Hash,
  Inbox,
  Loader2,
  MoreHorizontal,
  Plus,
  Repeat,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Markdown } from '../lib/markdown';
import { duplicate, editTask, move, removeTasks, run, schedule, toggleComplete } from '../state/actions';
import { AiError, breakdownTask } from '../state/ai';
import { useQuery, useReplica, useToday } from '../state/replica';
import { useUI } from '../state/ui';
import { Checkbox } from './Checkbox';
import { DatePicker } from './DatePicker';
import { LabelList, PRIORITY_COLOR, PriorityList, ProjectList } from './Pickers';
import {
  Button,
  cx,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui';

export function TaskDetail({ id }: { id: string }) {
  const task = useQuery((s) => s.get('task', id), [id]);
  const today = useToday();
  if (!task || task.deletedAt) return null;
  return <DetailBody key={task.id} task={task} today={today} />;
}

function DetailBody({ task, today }: { task: Task; today: string }) {
  const r = useReplica();
  const close = () => useUI.getState().openDetail(null);
  const project = useQuery(
    (s) => (task.projectId ? s.get('project', task.projectId) : null),
    [task.projectId],
  );
  const section = useQuery(
    (s) => (task.sectionId ? s.get('section', task.sectionId) : null),
    [task.sectionId],
  );
  const labels = useQuery(
    (s) => task.labels.map((l) => s.get('label', l)).filter((l) => !!l && !l.deletedAt),
    [task.labels],
  );
  const parent = useQuery((s) => (task.parentId ? s.get('task', task.parentId) : null), [task.parentId]);
  const subtasks = useQuery(
    (s) => sortByOrder(s.all('task').filter((x) => x.parentId === task.id && !x.deletedAt)),
    [task.id],
  );

  return (
    <aside aria-label={t('task.openDetail')} className="flex h-full flex-col bg-surface">
      <div data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-1 px-3">
        {parent ? (
          <button
            type="button"
            onClick={() => useUI.getState().openDetail(parent.id)}
            className="min-w-0 truncate rounded-[6px] px-1.5 py-1 text-[12.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
          >
            ↖ {parent.title}
          </button>
        ) : (
          <span className="px-1.5 text-[12.5px] text-ink-3">
            {project ? project.name : t('nav.inbox')}
            {section ? ` / ${section.name}` : ''}
          </span>
        )}
        <div className="ml-auto flex items-center">
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="More">
                <MoreHorizontal className="size-4" />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => duplicate(task.id)}>{t('task.duplicate')}</MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={() => removeTasks([task.id])}>
                <Trash2 />
                {t('task.delete')}
              </MenuItem>
            </MenuContent>
          </Menu>
          <IconButton label={t('task.close')} onClick={close}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10">
        <div className="flex items-start gap-3 pt-1">
          <div className="pt-[5px]">
            <Checkbox
              priority={task.priority}
              done={!!task.completedAt}
              onToggle={() => toggleComplete(task.id)}
            />
          </div>
          <TitleEditor task={task} />
        </div>

        <div className="mt-4 flex flex-col gap-0.5">
          <Field
            icon={<Calendar className={cx('size-4', task.scheduled && 'text-jade')} />}
            label={t('task.date')}
          >
            <Popover>
              <PopoverTrigger asChild>
                <FieldButton empty={!task.scheduled}>
                  {task.scheduled ? (
                    <span className="flex items-center gap-1.5">
                      <span className={cx(task.scheduled.date < today && !task.completedAt && 'text-p1')}>
                        {formatScheduled(task.scheduled, today)}
                      </span>
                      <span className="text-ink-3">{weekdayName(task.scheduled.date)}</span>
                    </span>
                  ) : (
                    t('task.noDate')
                  )}
                </FieldButton>
              </PopoverTrigger>
              <PopoverContent align="start" side="left" sideOffset={10}>
                <DatePicker
                  today={today}
                  value={task.scheduled}
                  recurrence={task.recurrence}
                  onDate={(date) => void schedule([task.id], date, { quiet: true })}
                  onTime={(time) => {
                    const base = task.scheduled ?? { date: today };
                    const { time: _t, ...rest } = base;
                    editTask(task.id, { scheduled: time ? { ...rest, time } : rest });
                  }}
                  onRecurrence={(rec) => editTask(task.id, { recurrence: rec })}
                  onParsed={(scheduled, rec) => {
                    run({
                      label: 'edit task',
                      run: (ctx) => ({
                        mutations: updateTask(task.id, {
                          scheduled,
                          ...(rec ? { recurrence: rec } : {}),
                        }).run(ctx).mutations,
                        result: undefined,
                      }),
                    });
                  }}
                />
              </PopoverContent>
            </Popover>
          </Field>

          {task.recurrence && (
            <Field icon={<Repeat className="size-4 text-jade" />} label={t('task.repeat')}>
              <span className="flex h-8 items-center px-2 text-[13px]">
                {describeRecurrence(task.recurrence)}
              </span>
            </Field>
          )}

          <Field
            icon={
              <Flag
                className="size-4"
                style={{ color: task.priority ? PRIORITY_COLOR[task.priority] : undefined }}
              />
            }
            label={t('task.priority')}
          >
            <Popover>
              <PopoverTrigger asChild>
                <FieldButton empty={!task.priority}>{t(`priority.${task.priority}`)}</FieldButton>
              </PopoverTrigger>
              <PopoverContent align="start" side="left" sideOffset={10}>
                <PriorityList value={task.priority} onPick={(priority) => editTask(task.id, { priority })} />
              </PopoverContent>
            </Popover>
          </Field>

          {!task.parentId && (
            <Field
              icon={
                project ? (
                  <Hash className="size-4" style={{ color: project.color ?? undefined }} />
                ) : (
                  <Inbox className="size-4 text-p3" />
                )
              }
              label={t('task.project')}
            >
              <Popover>
                <PopoverTrigger asChild>
                  <FieldButton>
                    {project ? project.name : t('nav.inbox')}
                    {section ? <span className="text-ink-3"> / {section.name}</span> : null}
                  </FieldButton>
                </PopoverTrigger>
                <PopoverContent align="start" side="left" sideOffset={10}>
                  <ProjectList
                    value={task.projectId}
                    sectionId={task.sectionId}
                    onPick={(projectId, sectionId) =>
                      move([task.id], sectionId ? { sectionId } : { projectId }, { quiet: true })
                    }
                  />
                </PopoverContent>
              </Popover>
            </Field>
          )}

          <Field icon={<Tag className="size-4" />} label={t('task.labels')}>
            <Popover>
              <PopoverTrigger asChild>
                <FieldButton empty={!labels.length}>
                  {labels.length ? (
                    <span className="flex flex-wrap gap-1">
                      {labels.map((l) => (
                        <span
                          key={l?.id}
                          className="rounded-[5px] bg-hover px-1.5 text-[12.5px]"
                          style={{ color: l?.color ?? 'var(--p2)' }}
                        >
                          @{l?.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    t('task.labels')
                  )}
                </FieldButton>
              </PopoverTrigger>
              <PopoverContent align="start" side="left" sideOffset={10}>
                <LabelList value={task.labels} onChange={(ids) => editTask(task.id, { labels: ids })} />
              </PopoverContent>
            </Popover>
          </Field>

          {task.scheduled && <ReminderField task={task} />}
        </div>

        <NotesEditor task={task} />

        <Subtasks task={task} subtasks={subtasks} today={today} />

        <p className="mt-8 text-[11.5px] text-ink-3">
          {task.origin === 'ai' && <Sparkles className="mr-1 inline size-3 text-jade" />}
          {t(task.origin === 'ai' ? 'task.createdByAi' : 'task.created', {
            date: new Date(task.createdAt).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </p>
        {r.recent(20).some((h) => h.actor === 'ai') && <AiActivity />}
      </div>
    </aside>
  );
}

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-2">
      <span className="flex w-[92px] shrink-0 items-center gap-2 text-[12.5px] text-ink-3">
        {icon}
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function FieldButton({
  children,
  empty,
  ...props
}: { children: ReactNode; empty?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'flex min-h-8 w-full items-center rounded-[7px] px-2 text-left text-[13px] hover:bg-hover data-[state=open]:bg-hover',
        empty ? 'text-ink-3' : 'text-ink',
      )}
    >
      {children}
    </button>
  );
}

function TitleEditor({ task }: { task: Task }) {
  const [value, setValue] = useState(task.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setValue(task.title), [task.title]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  const commit = () => {
    const v = value.replace(/\s+/g, ' ').trim();
    if (v && v !== task.title) editTask(task.id, { title: v });
    else setValue(task.title);
  };
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      aria-label={t('task.untitled')}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Escape') {
          setValue(task.title);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className={cx(
        'w-full resize-none bg-transparent font-display text-[19px] font-[620] leading-[1.35] tracking-[-0.01em] outline-none',
        task.completedAt && 'text-ink-3 line-through',
      )}
    />
  );
}

function NotesEditor({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.notes);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) setValue(task.notes);
  }, [task.notes, editing]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(72, el.scrollHeight)}px`;
  }, []);
  const commit = () => {
    setEditing(false);
    if (value !== task.notes) editTask(task.id, { notes: value });
  };
  return (
    <div className="mt-5 border-t border-line pt-4">
      {editing || !task.notes ? (
        <textarea
          ref={ref}
          value={value}
          // biome-ignore lint/a11y/noAutofocus: entering edit mode
          autoFocus={editing}
          onFocus={() => setEditing(true)}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
          }}
          placeholder={t('task.notesPlaceholder')}
          className="w-full resize-none bg-transparent text-[13.5px] leading-[1.6] outline-none placeholder:text-ink-3"
        />
      ) : (
        <div className="cursor-text text-[13.5px] leading-[1.6]" onClick={() => setEditing(true)}>
          <Markdown source={task.notes} />
        </div>
      )}
    </div>
  );
}

function Subtasks({ task, subtasks, today }: { task: Task; subtasks: Task[]; today: string }) {
  const r = useReplica();
  const [adding, setAdding] = useState('');
  const [drafts, setDrafts] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const nonce = useUI((s) => s.breakdownNonce);
  const started = useRef(nonce);

  const runBreakdown = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError(null);
    setDrafts([]);
    try {
      for await (const item of breakdownTask(
        r,
        { title: task.title, notes: task.notes, existing: subtasks.map((s) => s.title) },
        ctl.signal,
      )) {
        setDrafts((d) => [...(d ?? []), item.title]);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError(e instanceof AiError ? e.message : String(e));
        setDrafts(null);
      }
    } finally {
      setBusy(false);
    }
  };

  // Opened via "Break into subtasks" from a menu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per request
  useEffect(() => {
    if (nonce && nonce !== started.current) {
      started.current = nonce;
      void runBreakdown();
    }
  }, [nonce]);

  const accept = () => {
    if (!drafts?.length) return;
    run(createTasks(drafts.map((title) => ({ title, parentId: task.id }))), 'ai');
    setDrafts(null);
  };

  useEffect(() => {
    if (!drafts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && drafts.length && !busy) {
        e.preventDefault();
        accept();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        abort.current?.abort();
        setDrafts(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const done = subtasks.filter((s) => s.completedAt).length;
  return (
    <div className="mt-5 border-t border-line pt-3">
      <div className="flex h-8 items-center gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink-2">{t('task.subtasks')}</h3>
        {subtasks.length > 0 && (
          <span className="text-[12px] tabular-nums text-ink-3">
            {t('subtasks.progress', { done, total: subtasks.length })}
          </span>
        )}
        <button
          type="button"
          onClick={() => void runBreakdown()}
          disabled={busy}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[12.5px] text-jade hover:bg-jade-soft disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {busy ? t('ai.breakdown.working') : t('ai.breakdown')}
        </button>
      </div>
      <div className="flex flex-col">
        {subtasks.map((s) => (
          <SubtaskRow key={s.id} task={s} today={today} />
        ))}
        {drafts && (
          <div className="draft mt-1 rounded-[9px] p-1">
            {drafts.map((d, i) => (
              <div
                key={i}
                className="group flex h-8 items-center gap-2.5 px-1.5 text-[13.5px] animate-[fade-in_160ms_ease-out]"
              >
                <span className="check opacity-60" data-priority="0" />
                <span className="flex-1 truncate">{d}</span>
                <button
                  type="button"
                  aria-label={t('delete')}
                  onClick={() => setDrafts((xs) => xs?.filter((_, j) => j !== i) ?? null)}
                  className="grid size-5 place-items-center rounded text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {busy && !drafts.length && (
              <div className="flex h-8 items-center px-2 text-[12.5px] text-ink-3">
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                {t('ai.breakdown.working')}
              </div>
            )}
            {!busy && (
              <div className="flex items-center gap-1.5 px-1 pb-0.5 pt-1.5">
                <Button size="sm" variant="primary" onClick={accept} disabled={!drafts.length}>
                  {t('ai.breakdown.accept')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDrafts(null)}>
                  {t('ai.breakdown.discard')}
                </Button>
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="px-1 py-1.5 text-[12.5px] text-p1">{t('ai.unavailable', { message: error })}</p>
        )}
        <div className="flex h-9 items-center gap-2.5 pl-[2px]">
          <Plus className="size-4 text-ink-3" />
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && adding.trim()) {
                run(createTask({ title: adding, parentId: task.id }));
                setAdding('');
              }
            }}
            placeholder={t('task.addSubtask')}
            className="h-8 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-3"
          />
        </div>
      </div>
    </div>
  );
}

function SubtaskRow({ task, today }: { task: Task; today: string }) {
  const [value, setValue] = useState(task.title);
  useEffect(() => setValue(task.title), [task.title]);
  return (
    <div className="group flex min-h-8 items-center gap-2.5 rounded-[7px] pl-[1px] pr-1 hover:bg-hover">
      <Checkbox priority={task.priority} done={!!task.completedAt} onToggle={() => toggleComplete(task.id)} />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() && value !== task.title && editTask(task.id, { title: value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
        }}
        className={cx(
          'h-8 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none',
          task.completedAt && 'text-ink-3 line-through',
        )}
      />
      {task.scheduled && (
        <span className="text-[12px] text-ink-3">{formatScheduled(task.scheduled, today)}</span>
      )}
      <button
        type="button"
        aria-label={t('task.openDetail')}
        onClick={() => useUI.getState().openDetail(task.id)}
        className="grid size-6 place-items-center rounded-[6px] text-ink-3 opacity-0 hover:bg-active hover:text-ink group-hover:opacity-100"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
    </div>
  );
}

const REMINDER_OPTIONS = [0, 5, 15, 30, 60, 1440];

function ReminderField({ task }: { task: Task }) {
  const rel = task.reminders.find((x): x is Extract<Reminder, { kind: 'relative' }> => x.kind === 'relative');
  const label = (m: number) =>
    m === 0
      ? getLocale() === 'zh'
        ? '准时'
        : 'At time of task'
      : m >= 1440
        ? getLocale() === 'zh'
          ? `提前 ${m / 1440} 天`
          : `${m / 1440} day before`
        : getLocale() === 'zh'
          ? `提前 ${m} 分钟`
          : `${m} min before`;
  if (!task.scheduled?.time) {
    return (
      <Field icon={<Bell className="size-4" />} label={t('task.reminder')}>
        <span className="flex h-8 items-center px-2 text-[12.5px] text-ink-3">
          {getLocale() === 'zh' ? '设置时间后可添加提醒' : 'Add a time to set a reminder'}
        </span>
      </Field>
    );
  }
  return (
    <Field icon={<Bell className={cx('size-4', rel && 'text-jade')} />} label={t('task.reminder')}>
      <Menu>
        <MenuTrigger asChild>
          <FieldButton empty={!rel}>
            {rel ? label(rel.minutesBefore) : getLocale() === 'zh' ? '不提醒' : 'None'}
          </FieldButton>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem onSelect={() => editTask(task.id, { reminders: [] })}>
            {getLocale() === 'zh' ? '不提醒' : 'None'}
          </MenuItem>
          {REMINDER_OPTIONS.map((m) => (
            <MenuItem
              key={m}
              onSelect={() =>
                editTask(task.id, { reminders: [{ id: `r${m}`, kind: 'relative', minutesBefore: m }] })
              }
            >
              {label(m)}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </Field>
  );
}

function AiActivity() {
  const r = useReplica();
  const items = useQuery(() =>
    r
      .recent(30)
      .filter((h) => h.actor === 'ai')
      .slice(0, 5),
  );
  if (!items.length) return null;
  return (
    <div className="mt-4 rounded-[9px] border border-dashed border-jade-line p-2.5">
      <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-jade">
        <Sparkles className="size-3.5" />
        {t('ai.activity')}
      </p>
      {items.map((h) => (
        <div key={h.tx} className="flex h-7 items-center gap-2 text-[12.5px]">
          <span className="flex-1 truncate text-ink-2">{h.label}</span>
          <button
            type="button"
            onClick={() => r.revert(h.tx)}
            className="rounded-[5px] px-1.5 text-ink-3 hover:bg-hover hover:text-ink"
          >
            {t('ai.revert')}
          </button>
        </div>
      ))}
    </div>
  );
}
