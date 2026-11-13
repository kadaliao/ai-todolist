import {
  type LocalDate,
  type NewTask,
  type Priority,
  parseQuickAdd,
  type QuickAddResult,
  type Scheduled,
  sortByOrder,
} from '@ai-todo/core';
import { Calendar, Flag, Hash, Inbox, Plus, Repeat, Sparkles, Tag, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { formatScheduled } from '../lib/dates';
import { t } from '../lib/i18n';
import { addLabel, addProject, addTasks, getReplica } from '../state/actions';
import { timeZone, useQuery, useToday } from '../state/replica';
import { useUI } from '../state/ui';
import { DatePicker, type RecurrenceValue } from './DatePicker';
import { LabelList, PRIORITY_COLOR, PriorityList, ProjectList } from './Pickers';
import { Button, cx, Kbd, Popover, PopoverContent, PopoverTrigger } from './ui';

let pointerIsDown = false;
window.addEventListener('pointerdown', () => (pointerIsDown = true), true);
window.addEventListener('pointerup', () => (pointerIsDown = false), true);

export interface QuickAddDefaults {
  projectId?: string | null;
  sectionId?: string | null;
  date?: LocalDate | null;
  labels?: string[];
}

interface Overrides {
  scheduled?: Scheduled | null;
  recurrence?: RecurrenceValue | null;
  priority?: Priority;
  project?: { projectId: string | null; sectionId: string | null };
  labels?: string[];
}

export function QuickAdd({
  defaults = {},
  autoFocus,
  compact,
  onDone,
}: {
  defaults?: QuickAddDefaults;
  autoFocus?: boolean;
  compact?: boolean;
  onDone?: () => void;
}) {
  const today = useToday();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<string[]>([]);
  const [over, setOver] = useState<Overrides>({});
  const [focused, setFocused] = useState(!!autoFocus);
  const [lines, setLines] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const nonce = useUI((s) => s.quickAddNonce);
  const route = useUI((s) => s.route);

  // `q` / `n` anywhere focuses the quick add of the current view.
  useEffect(() => {
    if (nonce && !compact) inputRef.current?.focus();
  }, [nonce, compact]);

  const names = useQuery((s) => ({
    projects: s
      .all('project')
      .filter((p) => !p.deletedAt && !p.archivedAt)
      .map((p) => ({ id: p.id, name: p.name, color: p.color })),
    sections: s
      .all('section')
      .filter((x) => !x.deletedAt)
      .map((x) => ({ id: x.id, name: x.name, projectId: x.projectId })),
    labels: sortByOrder(s.all('label').filter((l) => !l.deletedAt)).map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
    })),
  }));

  const parsed: QuickAddResult = useMemo(
    () =>
      parseQuickAdd(text, {
        now: new Date(),
        timeZone: timeZone(),
        projects: names.projects,
        sections: names.sections,
        labels: names.labels,
        ignore,
      }),
    [text, names, ignore],
  );

  const effective = resolve(parsed, over, defaults);

  const submit = () => {
    if (lines) {
      const inputs = lines.map((line) => toInput(resolve(parseLine(line, names), {}, defaults)));
      addTasks(inputs.filter((i) => i.title));
      setLines(null);
      onDone?.();
      return;
    }
    if (!effective.title) return;
    const input = toInput(effective);
    const ids = addTasks([input]);
    if (ids?.[0] && !visibleIn(route, input, today)) {
      const name = input.projectId
        ? (names.projects.find((p) => p.id === input.projectId)?.name ?? '')
        : t('nav.inbox');
      const when = input.scheduled ? ` · ${formatScheduled(input.scheduled, today)}` : '';
      const id = ids[0];
      useUI.getState().toast({
        message: t('toast.created', { name: name + when }),
        action: {
          label: t('qa.show'),
          run: () => {
            useUI
              .getState()
              .navigate(input.projectId ? { kind: 'project', id: input.projectId } : { kind: 'inbox' });
            useUI.getState().openDetail(id);
          },
        },
      });
    }
    setText('');
    setIgnore([]);
    setOver({});
    onDone?.();
  };

  const syncScroll = () => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
  };

  const showTools = focused || !!text || !!lines;

  return (
    <div
      className={cx(
        'rounded-[11px] border bg-surface transition-[border-color,box-shadow] duration-150',
        showTools
          ? 'border-line-strong shadow-[0_1px_2px_rgba(20,24,36,0.05),0_4px_16px_rgba(20,24,36,0.06)]'
          : 'border-line',
      )}
    >
      <div className="flex items-center gap-2.5 px-3">
        <Plus
          className={cx('size-[17px] shrink-0 transition-colors', showTools ? 'text-jade' : 'text-ink-3')}
        />
        <div className="relative h-10 flex-1 overflow-hidden">
          <div
            ref={mirrorRef}
            aria-hidden
            className="qa-mirror pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-[14px] leading-10 text-transparent"
          >
            {renderMarks(text, parsed)}
          </div>
          <input
            ref={inputRef}
            // biome-ignore lint/a11y/noAutofocus: opened explicitly by the user
            autoFocus={autoFocus}
            value={text}
            aria-label={t('qa.placeholderShort')}
            placeholder={lines ? '' : compact ? t('qa.placeholderShort') : t('qa.placeholder')}
            onChange={(e) => {
              setText(e.target.value);
              requestAnimationFrame(syncScroll);
            }}
            onScroll={syncScroll}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              // Collapsing the toolbar shifts the list below; if the blur came from a click
              // elsewhere, wait until that click lands so it hits what the user aimed at.
              if (pointerIsDown)
                window.addEventListener('pointerup', () => setTimeout(() => setFocused(false), 80), {
                  once: true,
                });
              else setFocused(false);
            }}
            onPaste={(e) => {
              const data = e.clipboardData.getData('text');
              const ls = data
                .split(/\r?\n/)
                .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)、]|\[[ xX]\])\s*/, '').trim())
                .filter(Boolean);
              if (ls.length > 1) {
                e.preventDefault();
                setLines(ls);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                if (text || lines) {
                  setText('');
                  setLines(null);
                  setIgnore([]);
                  setOver({});
                } else {
                  inputRef.current?.blur();
                  onDone?.();
                }
              }
            }}
            className="relative h-10 w-full bg-transparent text-[14px] leading-10 text-ink caret-jade outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
        </div>
      </div>

      {lines && (
        <div className="border-t border-line px-3 py-2">
          <p className="pb-1.5 text-[12px] text-ink-2">{t('qa.multiline', { n: lines.length })}</p>
          <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {lines.map((l, i) => (
              <li key={i} className="flex items-center gap-2 text-[13px]">
                <span className="check" data-priority="0" />
                <span className="truncate">{l}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showTools && (
        <div
          className="flex flex-wrap items-center gap-1.5 border-t border-line px-2 py-1.5"
          // Keep focus in the input while using the toolbar.
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
          }}
        >
          <Popover>
            <PopoverTrigger asChild>
              <Chip icon={<Calendar className="size-3.5" />} active={!!effective.scheduled} tone="jade">
                {effective.scheduled ? formatScheduled(effective.scheduled, today) : t('task.date')}
                {effective.recurrence && <Repeat className="size-3" />}
              </Chip>
            </PopoverTrigger>
            <PopoverContent align="start">
              <DatePicker
                today={today}
                value={effective.scheduled}
                recurrence={effective.recurrence}
                onDate={(date) =>
                  setOver((o) => ({
                    ...o,
                    scheduled: date ? { ...(effective.scheduled ?? {}), date } : null,
                    ...(date ? {} : { recurrence: null }),
                  }))
                }
                onTime={(time) =>
                  setOver((o) => {
                    const base = effective.scheduled ?? { date: today };
                    const { time: _old, ...rest } = base;
                    return { ...o, scheduled: time ? { ...rest, time } : rest };
                  })
                }
                onRecurrence={(rec) => setOver((o) => ({ ...o, recurrence: rec }))}
                onParsed={(scheduled, rec) =>
                  setOver((o) => ({ ...o, scheduled, ...(rec ? { recurrence: rec } : {}) }))
                }
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Chip
                icon={
                  effective.project.projectId ? <Hash className="size-3.5" /> : <Inbox className="size-3.5" />
                }
                active={effective.project.projectId !== null || !!effective.project.newName}
                tone="p3"
              >
                {effective.project.newName
                  ? t('qa.newProject', { name: effective.project.newName })
                  : effective.project.projectId
                    ? projectLabel(names, effective.project.projectId, effective.project.sectionId)
                    : t('nav.inbox')}
              </Chip>
            </PopoverTrigger>
            <PopoverContent align="start">
              <ProjectList
                value={effective.project.projectId}
                sectionId={effective.project.sectionId}
                onPick={(projectId, sectionId) =>
                  setOver((o) => ({ ...o, project: { projectId, sectionId } }))
                }
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Chip
                icon={
                  <Flag
                    className="size-3.5"
                    style={{ color: effective.priority ? PRIORITY_COLOR[effective.priority] : undefined }}
                  />
                }
                active={effective.priority > 0}
                tone="p1"
              >
                {effective.priority ? `P${4 - effective.priority}` : t('task.priority')}
              </Chip>
            </PopoverTrigger>
            <PopoverContent align="start">
              <PriorityList
                value={effective.priority}
                onPick={(priority) => setOver((o) => ({ ...o, priority }))}
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Chip
                icon={<Tag className="size-3.5" />}
                active={effective.labels.length + effective.newLabels.length > 0}
                tone="p2"
              >
                {effective.labels.length + effective.newLabels.length
                  ? [
                      ...effective.labels.map((id) => names.labels.find((l) => l.id === id)?.name ?? ''),
                      ...effective.newLabels,
                    ].join(', ')
                  : t('task.labels')}
              </Chip>
            </PopoverTrigger>
            <PopoverContent align="start">
              <LabelList value={effective.labels} onChange={(labels) => setOver((o) => ({ ...o, labels }))} />
            </PopoverContent>
          </Popover>

          {parsed.tokens.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pl-1">
              {parsed.tokens.map((tok) => (
                <button
                  key={`${tok.kind}:${tok.start}`}
                  type="button"
                  title={t('qa.unrecognize')}
                  onClick={() => setIgnore((xs) => [...xs, tok.text])}
                  className="group inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[12px] text-ink-3 hover:bg-hover hover:text-ink-2"
                >
                  <span className="max-w-[140px] truncate">{tok.text}</span>
                  <X className="size-3 opacity-60 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2 pl-2">
            {text.length > 40 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  useUI.getState().set({ brainDumpOpen: true });
                  sessionStorage.setItem('docket.dump', text);
                }}
              >
                <Sparkles className="size-3.5 text-jade" />
                AI
              </Button>
            )}
            {!compact && (
              <span className="hidden items-center gap-1 text-[11.5px] text-ink-3 md:flex">
                <Kbd>↵</Kbd>
              </span>
            )}
            <Button variant="primary" size="sm" disabled={!lines && !effective.title} onClick={submit}>
              {lines ? t('qa.addN', { n: lines.length }) : t('qa.add')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Add a task from raw quick-add text (desktop quick-entry window, share targets). Parses against
 * the current project/label names, creates unknown ones, and says where the task went.
 */
export function addFromText(text: string, ignore: string[] = []): void {
  const r = getReplica();
  const s = r.store;
  const names: Names = {
    projects: s
      .all('project')
      .filter((p) => !p.deletedAt && !p.archivedAt)
      .map((p) => ({ id: p.id, name: p.name, color: p.color })),
    sections: s
      .all('section')
      .filter((x) => !x.deletedAt)
      .map((x) => ({ id: x.id, name: x.name, projectId: x.projectId })),
    labels: s
      .all('label')
      .filter((l) => !l.deletedAt)
      .map((l) => ({ id: l.id, name: l.name, color: l.color })),
  };
  const parsed = parseQuickAdd(text, { now: new Date(), timeZone: timeZone(), ...names, ignore });
  const input = toInput(resolve(parsed, {}, {}));
  if (!input.title) return;
  const ids = addTasks([input]);
  if (!ids?.[0]) return;
  const today = r.context().today;
  const name = input.projectId ? (s.get('project', input.projectId)?.name ?? '') : t('nav.inbox');
  const when = input.scheduled ? ` · ${formatScheduled(input.scheduled, today)}` : '';
  useUI.getState().toast({ message: t('toast.created', { name: name + when }) });
}

/** Will a task created here show up in the current view? If not, the toast says where it went. */
function visibleIn(
  route: ReturnType<typeof useUI.getState>['route'],
  input: NewTask,
  today: string,
): boolean {
  switch (route.kind) {
    case 'today':
      return !!input.scheduled && input.scheduled.date <= today;
    case 'upcoming':
      return !!input.scheduled && input.scheduled.date >= today;
    case 'inbox':
      return !input.projectId;
    case 'project':
      return input.projectId === route.id;
    case 'label':
      return !!input.labels?.includes(route.id);
    default:
      return false;
  }
}

const Chip = ({
  icon,
  children,
  active,
  tone,
  ...props
}: {
  icon: ReactNode;
  children: ReactNode;
  active?: boolean;
  tone: 'jade' | 'p1' | 'p2' | 'p3';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...props}
    className={cx(
      'inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-[6px] border px-2 text-[12.5px] transition-colors data-[state=open]:bg-hover',
      active
        ? tone === 'jade'
          ? 'border-jade-line bg-jade-soft text-jade'
          : 'border-line-strong text-ink'
        : 'border-line text-ink-2 hover:bg-hover hover:text-ink',
    )}
  >
    {icon}
    <span className="truncate">{children}</span>
  </button>
);

function renderMarks(text: string, parsed: QuickAddResult) {
  const out: ReactNode[] = [];
  let pos = 0;
  for (const tok of parsed.tokens) {
    if (tok.start > pos) out.push(text.slice(pos, tok.start));
    out.push(
      <mark key={tok.start} data-kind={tok.kind}>
        {text.slice(tok.start, tok.end)}
      </mark>,
    );
    pos = tok.end;
  }
  out.push(text.slice(pos));
  return out;
}

type Names = {
  projects: { id: string; name: string; color: string | null }[];
  sections: { id: string; name: string; projectId: string }[];
  labels: { id: string; name: string; color: string | null }[];
};

function projectLabel(names: Names, projectId: string, sectionId: string | null): string {
  const p = names.projects.find((x) => x.id === projectId)?.name ?? '';
  const s = sectionId ? names.sections.find((x) => x.id === sectionId)?.name : null;
  return s ? `${p} / ${s}` : p;
}

function parseLine(line: string, names: Names): QuickAddResult {
  return parseQuickAdd(line, { now: new Date(), timeZone: timeZone(), ...names });
}

interface Effective {
  title: string;
  scheduled: Scheduled | null;
  recurrence: RecurrenceValue | null;
  priority: Priority;
  project: { projectId: string | null; sectionId: string | null; newName?: string };
  labels: string[];
  newLabels: string[];
}

/** Defaults from the view < what the text says < what the user picked in the toolbar. */
function resolve(parsed: QuickAddResult, over: Overrides, defaults: QuickAddDefaults): Effective {
  const scheduled =
    over.scheduled !== undefined
      ? over.scheduled
      : (parsed.scheduled ?? (defaults.date ? { date: defaults.date } : null));
  const recurrence = over.recurrence !== undefined ? over.recurrence : (parsed.recurrence ?? null);
  let project: Effective['project'] = {
    projectId: defaults.projectId ?? null,
    sectionId: defaults.sectionId ?? null,
  };
  if (parsed.project) {
    project = parsed.project.id
      ? { projectId: parsed.project.id, sectionId: parsed.section?.id ?? null }
      : { projectId: null, sectionId: null, newName: parsed.project.name };
  } else if (parsed.section?.id) {
    project = { ...project, sectionId: parsed.section.id };
  }
  if (over.project) project = { ...over.project };
  const parsedLabels = parsed.labels.flatMap((l) => (l.id ? [l.id] : []));
  const labels = over.labels ?? [...new Set([...(defaults.labels ?? []), ...parsedLabels])];
  const newLabels = over.labels ? [] : parsed.labels.filter((l) => !l.id).map((l) => l.name);
  return {
    title: parsed.title,
    scheduled,
    recurrence: scheduled ? recurrence : null,
    priority: over.priority ?? parsed.priority ?? 0,
    project,
    labels,
    newLabels,
  };
}

function toInput(e: Effective): NewTask {
  let projectId = e.project.projectId;
  if (e.project.newName) projectId = addProject(e.project.newName) ?? null;
  const labels = [...e.labels, ...e.newLabels.map((n) => addLabel(n)).filter((x): x is string => !!x)];
  return {
    title: e.title,
    projectId,
    sectionId: e.project.newName ? null : e.project.sectionId,
    priority: e.priority,
    ...(labels.length ? { labels } : {}),
    ...(e.scheduled ? { scheduled: e.scheduled } : {}),
    ...(e.recurrence ? { recurrence: e.recurrence } : {}),
  };
}
