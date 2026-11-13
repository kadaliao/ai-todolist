import { inbox, sidebar, today as todayView } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { useDroppable } from '@dnd-kit/react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Hash,
  Inbox,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Tag,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { addLabel, addProject } from '../state/actions';
import { useQuery, useToday } from '../state/replica';
import { useSyncStatus } from '../state/sync';
import { type Route, useUI } from '../state/ui';
import { cx, Kbd, MOD, Tooltip } from './ui';
import { NameInput, PROJECT_COLORS } from './Views';

function same(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false;
  if ((a.kind === 'project' || a.kind === 'label') && (b.kind === 'project' || b.kind === 'label'))
    return a.id === b.id;
  return true;
}

function NavItem({
  route,
  icon,
  label,
  count,
  countTone,
  dropId,
  depth = 0,
  trailing,
}: {
  route: Route;
  icon: ReactNode;
  label: string;
  count?: number;
  countTone?: 'overdue';
  dropId?: string;
  depth?: number;
  trailing?: ReactNode;
}) {
  const current = useUI((s) => s.route);
  const active = same(current, route);
  const { ref, isDropTarget } = useDroppable({
    id: dropId ?? `nav:${JSON.stringify(route)}`,
    accept: 'task',
    disabled: !dropId,
    data: { kind: 'nav', route },
  });
  return (
    <div ref={ref} className="group relative">
      <button
        type="button"
        onClick={() => useUI.getState().navigate(route)}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'flex h-[30px] w-full items-center gap-2.5 rounded-[7px] pr-2 text-left text-[13.5px] transition-colors duration-75',
          active ? 'bg-active font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
          isDropTarget && 'bg-jade-soft text-jade ring-1 ring-jade-line',
        )}
        style={{ paddingLeft: 10 + depth * 16 }}
      >
        <span className="grid size-[18px] shrink-0 place-items-center [&>svg]:size-[17px]">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        {count ? (
          <span
            className={cx(
              'text-[12px] tabular-nums',
              countTone === 'overdue' ? 'font-medium text-p1' : 'text-ink-3',
            )}
          >
            {count}
          </span>
        ) : null}
      </button>
      {trailing}
    </div>
  );
}

export function Sidebar() {
  const today = useToday();
  const counts = useQuery(
    (s) => {
      const td = todayView(s, today);
      return {
        inbox: inbox(s).length,
        today: td.today.length + td.overdue.length,
        overdue: td.overdue.length,
      };
    },
    [today],
  );
  const tree = useQuery((s) => {
    const sb = sidebar(s);
    const open = new Map<string, number>();
    for (const t of s.all('task')) {
      if (t.projectId && !t.completedAt && !t.deletedAt && !t.parentId)
        open.set(t.projectId, (open.get(t.projectId) ?? 0) + 1);
    }
    return { ...sb, open };
  });
  const [addingProject, setAddingProject] = useState(false);
  const [addingLabel, setAddingLabel] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [labelsOpen, setLabelsOpen] = useState(true);
  const sync = useSyncStatus();

  return (
    <nav aria-label="Sidebar" className="flex h-full flex-col bg-sidebar">
      <div
        data-tauri-drag-region
        className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-2 pt-[env(safe-area-inset-top)]"
      >
        <Logo />
        <span className="font-display text-[15px] font-[680] tracking-[-0.01em]">Docket</span>
        <div className="ml-auto flex items-center">
          <Tooltip
            label={
              <>
                {t('nav.search')} <Kbd>{MOD}K</Kbd>
              </>
            }
          >
            <button
              type="button"
              aria-label={t('nav.search')}
              onClick={() => useUI.getState().set({ paletteOpen: true })}
              className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink"
            >
              <Search className="size-4" />
            </button>
          </Tooltip>
          <Tooltip label={t('palette.brainDump')}>
            <button
              type="button"
              aria-label={t('palette.brainDump')}
              onClick={() => useUI.getState().set({ brainDumpOpen: true })}
              className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-jade"
            >
              <Sparkles className="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        <NavItem
          route={{ kind: 'inbox' }}
          dropId="drop:inbox"
          icon={<Inbox className="text-p3" />}
          label={t('nav.inbox')}
          count={counts.inbox}
        />
        <NavItem
          route={{ kind: 'today' }}
          dropId="drop:today"
          icon={<Sun className="text-jade" />}
          label={t('nav.today')}
          count={counts.today}
          countTone={counts.overdue ? 'overdue' : undefined}
        />
        <NavItem
          route={{ kind: 'upcoming' }}
          dropId="drop:tomorrow"
          icon={<CalendarDays className="text-[#8a5cd6]" />}
          label={t('nav.upcoming')}
        />
        <NavItem
          route={{ kind: 'logbook' }}
          icon={<CheckCircle2 className="text-ink-3" />}
          label={t('nav.logbook')}
        />

        <SectionTitle
          open={projectsOpen}
          onToggle={() => setProjectsOpen((o) => !o)}
          onAdd={() => setAddingProject(true)}
          addLabel={t('nav.newProject')}
        >
          {t('nav.projects')}
        </SectionTitle>
        {projectsOpen && (
          <>
            {tree.projects.map(({ project, children }) => (
              <div key={project.id}>
                <NavItem
                  route={{ kind: 'project', id: project.id }}
                  dropId={`drop:project:${project.id}`}
                  icon={<Hash style={{ color: project.color ?? 'var(--ink-3)' }} />}
                  label={project.name}
                  count={tree.open.get(project.id)}
                />
                {children.map((c) => (
                  <NavItem
                    key={c.id}
                    depth={1}
                    route={{ kind: 'project', id: c.id }}
                    dropId={`drop:project:${c.id}`}
                    icon={<Hash style={{ color: c.color ?? 'var(--ink-3)' }} />}
                    label={c.name}
                    count={tree.open.get(c.id)}
                  />
                ))}
              </div>
            ))}
            {addingProject && (
              <div className="px-1 py-1">
                <NameInput
                  placeholder={t('project.namePlaceholder')}
                  onSubmit={(name) => {
                    const id = addProject(
                      name,
                      null,
                      PROJECT_COLORS[tree.projects.length % PROJECT_COLORS.length] ?? null,
                    );
                    setAddingProject(false);
                    if (id) useUI.getState().navigate({ kind: 'project', id });
                  }}
                  onCancel={() => setAddingProject(false)}
                />
              </div>
            )}
            {!tree.projects.length && !addingProject && (
              <button
                type="button"
                onClick={() => setAddingProject(true)}
                className="flex h-[30px] items-center gap-2.5 rounded-[7px] pl-[10px] text-[13px] text-ink-3 hover:bg-hover hover:text-ink-2"
              >
                <Plus className="size-4" />
                {t('nav.newProject')}
              </button>
            )}
          </>
        )}

        {(tree.labels.length > 0 || addingLabel) && (
          <>
            <SectionTitle
              open={labelsOpen}
              onToggle={() => setLabelsOpen((o) => !o)}
              onAdd={() => setAddingLabel(true)}
              addLabel={t('nav.newLabel')}
            >
              {t('nav.labels')}
            </SectionTitle>
            {labelsOpen &&
              tree.labels.map((l) => (
                <NavItem
                  key={l.id}
                  route={{ kind: 'label', id: l.id }}
                  icon={<Tag style={{ color: l.color ?? 'var(--p2)' }} />}
                  label={l.name}
                />
              ))}
            {addingLabel && (
              <div className="px-1 py-1">
                <NameInput
                  placeholder={t('label.namePlaceholder')}
                  onSubmit={(name) => {
                    addLabel(name);
                    setAddingLabel(false);
                  }}
                  onCancel={() => setAddingLabel(false)}
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-line px-2 py-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        <NavItem route={{ kind: 'trash' }} icon={<Trash2 className="text-ink-3" />} label={t('nav.trash')} />
        <Tooltip label={sync.label} side="top">
          <button
            type="button"
            aria-label={t('nav.settings')}
            onClick={() => useUI.getState().set({ settingsOpen: true })}
            className="relative grid size-[30px] shrink-0 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <Settings className="size-[17px]" />
            <span
              className={cx(
                'absolute right-[5px] top-[5px] size-[7px] rounded-full ring-2 ring-[var(--sidebar)]',
                sync.state === 'synced' && 'bg-jade',
                sync.state === 'connecting' && 'bg-p2',
                (sync.state === 'offline' || sync.state === 'error') && 'bg-p1',
                sync.state === 'off' && 'hidden',
              )}
            />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}

function SectionTitle({
  children,
  open,
  onToggle,
  onAdd,
  addLabel,
}: {
  children: ReactNode;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="group mt-4 flex h-7 items-center pl-2.5 pr-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-1 items-center gap-1 text-left text-[12px] font-semibold text-ink-3 hover:text-ink-2"
      >
        {children}
        <ChevronRight
          className={cx('size-3 opacity-0 transition group-hover:opacity-100', open && 'rotate-90')}
        />
      </button>
      <button
        type="button"
        aria-label={addLabel}
        title={addLabel}
        onClick={onAdd}
        className="grid size-6 place-items-center rounded-[6px] text-ink-3 opacity-0 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--jade)" />
      <path
        d="M9.5 16.5 14 21l8.5-9.5"
        fill="none"
        stroke="var(--jade-ink)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
