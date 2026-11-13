import { search, sidebar } from '@ai-todo/core';
import { formatScheduled, t } from '@ai-todo/shared';
import { Command } from 'cmdk';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Hash,
  Inbox,
  Keyboard,
  Moon,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Tag,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { rescheduleAllOverdue } from '../state/actions';
import { useQuery, useToday } from '../state/replica';
import { type Route, useUI } from '../state/ui';
import { Checkbox } from './Checkbox';
import { toggleTheme } from './theme';
import { Kbd } from './ui';

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const [q, setQ] = useState('');
  const close = () => {
    useUI.getState().set({ paletteOpen: false });
    setQ('');
  };
  const nav = (route: Route) => {
    useUI.getState().navigate(route);
    close();
  };
  const tree = useQuery((s) => sidebar(s));
  const today = useToday();
  const tasks = useQuery((s) => (q.trim() ? search(s, q, 12) : []), [q]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(o) => (o ? useUI.getState().set({ paletteOpen: true }) : close())}
      label={t('palette.placeholder')}
      overlayClassName="fixed inset-0 z-40 bg-[rgba(16,19,26,0.32)] backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(600px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[14px] border border-line bg-raised shadow-float outline-none data-[state=open]:animate-[dialog-in_160ms_cubic-bezier(.2,.9,.3,1.1)]"
      className="flex flex-col"
    >
      <Command.Input
        value={q}
        onValueChange={setQ}
        placeholder={t('palette.placeholder')}
        className="h-[52px] w-full border-b border-line bg-transparent px-4 text-[15px] outline-none placeholder:text-ink-3"
      />
      <Command.List className="max-h-[min(440px,60vh)] overflow-y-auto overscroll-contain p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
        <Command.Empty className="px-4 py-8 text-center text-[13px] text-ink-3">
          {t('palette.empty')}
        </Command.Empty>

        {tasks.length > 0 && (
          <Command.Group heading={t('palette.tasks')}>
            {tasks.map((task) => (
              <Item
                key={task.id}
                value={`task ${task.title} ${task.notes} ${task.id}`}
                icon={<Checkbox priority={task.priority} done={!!task.completedAt} onToggle={() => {}} />}
                onSelect={() => {
                  const route: Route = task.projectId
                    ? { kind: 'project', id: task.projectId }
                    : { kind: 'inbox' };
                  if (!task.completedAt) useUI.getState().navigate(route);
                  useUI.getState().openDetail(task.id);
                  close();
                }}
              >
                <span className={task.completedAt ? 'text-ink-3 line-through' : undefined}>{task.title}</span>
                {task.scheduled && (
                  <span className="ml-3 text-[12px] text-ink-3">
                    {formatScheduled(task.scheduled, today)}
                  </span>
                )}
              </Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading={t('palette.actions')}>
          <Item
            icon={<Plus />}
            shortcut="Q"
            onSelect={() => {
              close();
              setTimeout(() => useUI.getState().focusQuickAdd(), 50);
            }}
          >
            {t('palette.newTask')}
          </Item>
          <Item
            icon={<Sparkles className="text-jade" />}
            onSelect={() => {
              close();
              useUI.getState().set({ brainDumpOpen: true });
            }}
          >
            {t('palette.brainDump')}
          </Item>
          <Item
            icon={<CalendarClock />}
            onSelect={() => {
              rescheduleAllOverdue();
              close();
            }}
          >
            {t('today.rescheduleAll')}
          </Item>
          <Item
            icon={<Moon />}
            onSelect={() => {
              toggleTheme();
              close();
            }}
          >
            {t('palette.toggleTheme')}
          </Item>
          <Item
            icon={<Keyboard />}
            shortcut="?"
            onSelect={() => {
              close();
              useUI.getState().set({ shortcutsOpen: true });
            }}
          >
            {t('palette.shortcuts')}
          </Item>
          <Item
            icon={<Settings />}
            onSelect={() => {
              close();
              useUI.getState().set({ settingsOpen: true });
            }}
          >
            {t('nav.settings')}
          </Item>
        </Command.Group>

        <Command.Group heading={t('palette.navigate')}>
          <Item icon={<Inbox className="text-p3" />} shortcut="G I" onSelect={() => nav({ kind: 'inbox' })}>
            {t('nav.inbox')}
          </Item>
          <Item icon={<Sun className="text-jade" />} shortcut="G T" onSelect={() => nav({ kind: 'today' })}>
            {t('nav.today')}
          </Item>
          <Item
            icon={<CalendarDays className="text-[#8a5cd6]" />}
            shortcut="G U"
            onSelect={() => nav({ kind: 'upcoming' })}
          >
            {t('nav.upcoming')}
          </Item>
          <Item icon={<CheckCircle2 />} shortcut="G L" onSelect={() => nav({ kind: 'logbook' })}>
            {t('nav.logbook')}
          </Item>
          <Item icon={<Trash2 />} onSelect={() => nav({ kind: 'trash' })}>
            {t('nav.trash')}
          </Item>
          {tree.projects.flatMap(({ project, children }) =>
            [project, ...children].map((p) => (
              <Item
                key={p.id}
                value={`project ${p.name}`}
                icon={<Hash style={{ color: p.color ?? undefined }} />}
                onSelect={() => nav({ kind: 'project', id: p.id })}
              >
                {p.name}
              </Item>
            )),
          )}
          {tree.labels.map((l) => (
            <Item
              key={l.id}
              value={`label ${l.name}`}
              icon={<Tag style={{ color: l.color ?? 'var(--p2)' }} />}
              onSelect={() => nav({ kind: 'label', id: l.id })}
            >
              @{l.name}
            </Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function Item({
  children,
  icon,
  shortcut,
  onSelect,
  value,
}: {
  children: ReactNode;
  icon: ReactNode;
  shortcut?: string;
  onSelect: () => void;
  value?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-10 cursor-default select-none items-center gap-3 rounded-[8px] px-2.5 text-[13.5px] outline-none data-[selected=true]:bg-hover [&>span:first-child>svg]:size-4 [&>span:first-child>svg]:text-ink-2"
    >
      <span className="grid size-[18px] shrink-0 place-items-center">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {shortcut && (
        <span className="flex gap-1">
          {shortcut.split(' ').map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      )}
    </Command.Item>
  );
}
