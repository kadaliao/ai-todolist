import { addDays, type Replica, siblingsOf, sortByOrder } from '@ai-todo/core';
import { type Locale, t } from '@ai-todo/shared';
import { PointerActivationConstraints } from '@dnd-kit/dom';
import { isSortable } from '@dnd-kit/dom/sortable';
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react';
import { Menu as MenuIcon, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { AssistantDock } from './components/Assistant';
import { CommandPalette } from './components/CommandPalette';
import { DatePicker } from './components/DatePicker';
import { BrainDump, RescheduleDialog, SettingsDialog, ShortcutsDialog, Toasts } from './components/Overlays';
import { Sidebar } from './components/Sidebar';
import { TaskDetail } from './components/TaskDetail';
import { groupOrder, parseGroup } from './components/TaskList';
import type { DragItem } from './components/TaskRow';
import { Dialog, TooltipProvider } from './components/ui';
import {
  InboxView,
  LabelPage,
  LogbookView,
  ProjectPage,
  SearchView,
  TodayView,
  TrashView,
  UpcomingView,
} from './components/Views';
import { completeMany, move, redo, removeTasks, schedule, setPriority, undo } from './state/actions';
import { useReplica, useToday } from './state/replica';
import { useUI } from './state/ui';

export function App({ onLocale }: { onLocale: (l: Locale) => void }) {
  const r = useReplica();
  const _route = useUI((s) => s.route);
  const detailId = useUI((s) => s.detailId);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const today = useToday();
  const wide = useMedia('(min-width: 1100px)');
  const narrow = !useMedia('(min-width: 768px)');
  useShortcuts(r);

  return (
    <TooltipProvider>
      <DragDropProvider sensors={SENSORS} onDragEnd={(event) => onDragEnd(r, event, today)}>
        <div className="flex h-full overflow-hidden">
          {narrow ? (
            <AnimatePresence>
              {sidebarOpen && (
                <>
                  <motion.div
                    key="scrim"
                    className="fixed inset-0 z-30 bg-[rgba(16,19,26,0.3)]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => useUI.getState().set({ sidebarOpen: false })}
                  />
                  <motion.div
                    key="drawer"
                    className="fixed inset-y-0 left-0 z-40 w-[280px] shadow-float"
                    initial={{ x: -290 }}
                    animate={{ x: 0 }}
                    exit={{ x: -290 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                  >
                    <Sidebar />
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          ) : (
            <div className="w-[252px] shrink-0 border-r border-line">
              <Sidebar />
            </div>
          )}

          <main
            className="relative min-w-0 flex-1 overflow-y-auto bg-bg"
            onClick={(e) => {
              if (e.target === e.currentTarget) useUI.getState().select([]);
            }}
            onKeyDown={() => {}}
          >
            <div
              data-tauri-drag-region
              className="sticky top-0 z-10 h-3 bg-gradient-to-b from-[var(--bg)] to-transparent md:h-4"
            />
            {narrow && (
              <div className="sticky top-0 z-20 flex h-12 items-center gap-1 bg-bg/90 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-md">
                <button
                  type="button"
                  aria-label="Menu"
                  onClick={() => useUI.getState().set({ sidebarOpen: true })}
                  className="grid size-10 place-items-center rounded-[8px] text-ink-2 hover:bg-hover"
                >
                  <MenuIcon className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label={t('nav.search')}
                  onClick={() => useUI.getState().set({ paletteOpen: true })}
                  className="ml-auto grid size-10 place-items-center rounded-[8px] text-ink-2 hover:bg-hover"
                >
                  <Search className="size-5" />
                </button>
              </div>
            )}
            <RouteView />
          </main>

          <AnimatePresence initial={false}>
            {detailId &&
              (wide ? (
                <motion.div
                  key="detail"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 400, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                  className="shrink-0 overflow-hidden border-l border-line"
                >
                  <div className="h-full w-[400px]">
                    <TaskDetail id={detailId} />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="detail-sheet"
                  className="fixed inset-0 z-30 flex justify-end"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <button
                    type="button"
                    aria-label={t('task.close')}
                    className="absolute inset-0 bg-[rgba(16,19,26,0.28)]"
                    onClick={() => useUI.getState().openDetail(null)}
                  />
                  <motion.div
                    className="relative h-full w-[min(440px,100%)] shadow-float"
                    initial={{ x: 60 }}
                    animate={{ x: 0 }}
                    exit={{ x: 60 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                  >
                    <TaskDetail id={detailId} />
                  </motion.div>
                </motion.div>
              ))}
          </AnimatePresence>
        </div>

        <CommandPalette />
        <SettingsDialog onLocale={onLocale} />
        <ShortcutsDialog />
        <RescheduleDialog />
        <BrainDump />
        <AssistantDock offsetRight={wide && detailId ? 400 : 0} />
        <QuickSchedule />
        <Toasts />
      </DragDropProvider>
    </TooltipProvider>
  );
}

/** Mouse: drag after 6px. Touch: long-press, so scrolling a list never starts a drag. */
const SENSORS = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === 'touch'
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: { x: 6, y: 6 } })]
        : [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
  KeyboardSensor,
];

function RouteView() {
  const route = useUI((s) => s.route);
  switch (route.kind) {
    case 'today':
      return <TodayView />;
    case 'inbox':
      return <InboxView />;
    case 'upcoming':
      return <UpcomingView />;
    case 'project':
      return <ProjectPage key={route.id} id={route.id} />;
    case 'label':
      return <LabelPage key={route.id} id={route.id} />;
    case 'logbook':
      return <LogbookView />;
    case 'trash':
      return <TrashView />;
    case 'search':
      return <SearchView q={route.q} />;
  }
}

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** `d` opens a date picker for the selection without leaving the keyboard. */
function QuickSchedule() {
  const open = useUI((s) => s.scheduleOpen);
  const r = useReplica();
  const today = useToday();
  const selection = useUI((s) => s.selection);
  const focusId = useUI((s) => s.focusId);
  const ids = selection.length ? selection : focusId ? [focusId] : [];
  const first = ids[0] ? r.store.get('task', ids[0]) : undefined;
  const close = () => useUI.setState({ scheduleOpen: false });
  return (
    <Dialog
      open={open && !!first}
      onOpenChange={(o) => !o && close()}
      title={t('task.schedule')}
      hideTitle
      className="w-auto"
    >
      {first && (
        <DatePicker
          today={today}
          value={first.scheduled}
          recurrence={first.recurrence}
          onDate={(date) => {
            close();
            void schedule(ids, date);
          }}
          onTime={() => {}}
          onClose={close}
        />
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Drag and drop

function onDragEnd(
  r: Replica,
  event: Parameters<NonNullable<React.ComponentProps<typeof DragDropProvider>['onDragEnd']>>[0],
  today: string,
) {
  if (event.canceled) return;
  const { source, target } = event.operation;
  if (!source) return;
  const data = source.data as DragItem | undefined;
  if (data?.kind !== 'task') return;
  const sel = useUI.getState().selection;
  const ids = sel.includes(data.taskId) ? sel : [data.taskId];
  const tdata = target?.data as
    | { kind?: string; route?: { kind: string; id?: string }; date?: string; group?: string }
    | undefined;

  if (tdata?.kind === 'nav' && target) {
    const id = String(target.id);
    if (id === 'drop:inbox') move(ids, { projectId: null, parentId: null });
    else if (id === 'drop:today') void schedule(ids, today);
    else if (id === 'drop:tomorrow') void schedule(ids, addDays(today, 1));
    else if (id.startsWith('drop:project:'))
      move(ids, { projectId: id.slice('drop:project:'.length), parentId: null });
    return;
  }
  if (tdata?.kind === 'day' && tdata.date) {
    void schedule(ids, tdata.date);
    return;
  }

  if (!isSortable(source)) return;
  const group = String(source.group ?? '');
  const initialGroup = String(source.initialGroup ?? '');
  const g = parseGroup(group);
  if (g.kind === 'day') {
    // Dropped on a task in another day's list → reschedule to that day.
    const targetGroup = tdata?.group ? parseGroup(tdata.group) : g;
    if (
      targetGroup.kind === 'day' &&
      targetGroup.date !== 'overdue' &&
      targetGroup.date !== initialGroup.slice(4)
    ) {
      void schedule(ids, targetGroup.date);
    }
    return;
  }
  if (g.kind !== 'scope') return;
  if (group === initialGroup && source.index === source.initialIndex) return;
  // Translate the visible position into a position among all siblings (incl. hidden/completed).
  const visible = (groupOrder.get(group) ?? []).filter((x) => x !== data.taskId);
  const prev = visible[source.index - 1];
  const next = visible[source.index];
  const full = sortByOrder(siblingsOf(r.store, g))
    .map((x) => x.id)
    .filter((x) => x !== data.taskId);
  const index = prev ? full.indexOf(prev) + 1 : next ? full.indexOf(next) : full.length;
  move(
    [data.taskId],
    { projectId: g.projectId, sectionId: g.sectionId, parentId: g.parentId, index },
    { quiet: group === initialGroup },
  );
}

// ---------------------------------------------------------------------------------------------
// Keyboard

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
  );
}

function useShortcuts(r: Replica) {
  const today = useToday();
  useEffect(() => {
    let gPending = 0;
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      const mod = e.metaKey || e.ctrlKey;
      const anyDialog =
        ui.paletteOpen ||
        ui.settingsOpen ||
        ui.shortcutsOpen ||
        ui.brainDumpOpen ||
        ui.scheduleOpen ||
        !!ui.reschedulePrompt ||
        !!document.querySelector('[role="dialog"],[role="menu"]');

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.set({ paletteOpen: !ui.paletteOpen });
        return;
      }
      if (isTyping(e) || anyDialog) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      const targets = ui.selection.length ? ui.selection : ui.focusId ? [ui.focusId] : [];
      const ids = ui.visibleIds;
      const key = e.key;

      if (gPending && Date.now() - gPending < 1200) {
        gPending = 0;
        const map: Record<string, () => void> = {
          i: () => ui.navigate({ kind: 'inbox' }),
          t: () => ui.navigate({ kind: 'today' }),
          u: () => ui.navigate({ kind: 'upcoming' }),
          l: () => ui.navigate({ kind: 'logbook' }),
        };
        map[key.toLowerCase()]?.();
        return;
      }
      if (mod) {
        if (key === 'Backspace' || key === 'Delete') {
          e.preventDefault();
          removeTasks(targets);
        }
        if ((key === 'ArrowUp' || key === 'ArrowDown') && e.shiftKey && targets.length === 1) {
          e.preventDefault();
          nudge(r, targets[0] as string, key === 'ArrowUp' ? -1 : 1);
        }
        return;
      }

      switch (key) {
        case 'q':
        case 'n':
          e.preventDefault();
          ui.focusQuickAdd();
          break;
        case '/':
          e.preventDefault();
          ui.set({ paletteOpen: true });
          break;
        case '?':
          ui.set({ shortcutsOpen: true });
          break;
        case 'g':
          gPending = Date.now();
          break;
        case 'ArrowDown':
        case 'j':
        case 'ArrowUp':
        case 'k': {
          e.preventDefault();
          if (!ids.length) return;
          const down = key === 'ArrowDown' || key === 'j';
          const at = ui.focusId ? ids.indexOf(ui.focusId) : -1;
          const nextIdx =
            at < 0
              ? down
                ? 0
                : ids.length - 1
              : Math.max(0, Math.min(ids.length - 1, at + (down ? 1 : -1)));
          const nextId = ids[nextIdx] as string;
          if (e.shiftKey) {
            const anchor = ui.selection[0] ?? ui.focusId ?? nextId;
            const a = ids.indexOf(anchor);
            ui.select(ids.slice(Math.min(a, nextIdx), Math.max(a, nextIdx) + 1), nextId);
            if (ui.selection[0] !== anchor)
              useUI.setState({
                selection: [
                  anchor,
                  ...ids.slice(Math.min(a, nextIdx), Math.max(a, nextIdx) + 1).filter((x) => x !== anchor),
                ],
              });
          } else {
            ui.select([nextId], nextId);
            if (ui.detailId) ui.openDetail(nextId);
          }
          break;
        }
        case 'Enter':
          if (ui.focusId) {
            e.preventDefault();
            ui.openDetail(ui.focusId);
          }
          break;
        case 'Escape':
          if (ui.detailId) ui.openDetail(null);
          else ui.select([]);
          break;
        case 'e':
        case 'x':
          if (targets.length) {
            e.preventDefault();
            completeMany(targets);
          }
          break;
        case 't':
          if (targets.length) void schedule(targets, today);
          break;
        case 'm':
          if (targets.length) void schedule(targets, addDays(today, 1));
          break;
        case 'd':
          if (targets.length) {
            e.preventDefault();
            useUI.setState({ scheduleOpen: true });
          }
          break;
        case '1':
        case '2':
        case '3':
        case '4':
          if (targets.length) setPriority(targets, (4 - Number(key)) as 0 | 1 | 2 | 3);
          break;
        case 'Backspace':
        case 'Delete':
          if (targets.length) {
            e.preventDefault();
            removeTasks(targets);
          }
          break;
        case 'Tab':
          if (targets.length === 1) {
            e.preventDefault();
            indent(r, targets[0] as string, e.shiftKey ? -1 : 1);
          }
          break;
        case 'F2':
          if (ui.focusId) ui.setEditing(ui.focusId);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [r, today]);
}

/** Tab makes a task a subtask of the one above it; Shift+Tab moves it back out. */
function indent(r: Replica, id: string, dir: 1 | -1) {
  const task = r.store.get('task', id);
  if (!task) return;
  if (dir === -1) {
    if (!task.parentId) return;
    const parent = r.store.get('task', task.parentId);
    if (!parent) return;
    const sibs = sortByOrder(siblingsOf(r.store, parent)).map((x) => x.id);
    move(
      [id],
      {
        projectId: parent.projectId,
        sectionId: parent.sectionId,
        parentId: parent.parentId,
        index: sibs.indexOf(parent.id) + 1,
      },
      { quiet: true },
    );
    return;
  }
  const sibs = sortByOrder(siblingsOf(r.store, task)).filter((x) => !x.completedAt);
  const at = sibs.findIndex((x) => x.id === id);
  const above = sibs[at - 1];
  if (!above) return;
  move([id], { parentId: above.id }, { quiet: true });
}

/** ⌘⇧↑/↓ moves a task up or down among its siblings. */
function nudge(r: Replica, id: string, dir: 1 | -1) {
  const task = r.store.get('task', id);
  if (!task) return;
  const sibs = sortByOrder(siblingsOf(r.store, task)).filter((x) => !x.completedAt || x.id === id);
  const at = sibs.findIndex((x) => x.id === id);
  const to = at + dir;
  if (to < 0 || to >= sibs.length) return;
  const others = sortByOrder(siblingsOf(r.store, task))
    .map((x) => x.id)
    .filter((x) => x !== id);
  const neighbor = sibs[to]?.id as string;
  const nIdx = others.indexOf(neighbor);
  move([id], { index: dir === 1 ? nIdx + 1 : nIdx }, { quiet: true });
}
