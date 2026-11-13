import { addDays, isoWeekday, type Priority } from '@ai-todo/core';
import {
  ArrowRightLeft,
  CalendarDays,
  CalendarX,
  Check,
  Copy,
  Flag,
  PanelRightOpen,
  RotateCcw,
  Sofa,
  Sparkles,
  Sun,
  SunMedium,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../lib/i18n';
import { completeMany, duplicate, move, removeTasks, restore, schedule, setPriority } from '../state/actions';
import { useReplica } from '../state/replica';
import { useUI } from '../state/ui';
import { PRIORITY_COLOR, ProjectList } from './Pickers';
import {
  ContextContent,
  ContextItem,
  ContextSeparator,
  ContextSub,
  ContextSubContent,
  ContextSubTrigger,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MOD,
} from './ui';

type Kit = {
  Content: typeof MenuContent;
  Item: typeof MenuItem;
  Separator: typeof MenuSeparator;
  Sub: typeof MenuSub;
  SubTrigger: typeof MenuSubTrigger;
  SubContent: typeof MenuSubContent;
};

const dropdownKit: Kit = {
  Content: MenuContent,
  Item: MenuItem,
  Separator: MenuSeparator,
  Sub: MenuSub,
  SubTrigger: MenuSubTrigger,
  SubContent: MenuSubContent,
};

const contextKit = {
  Content: ContextContent,
  Item: ContextItem,
  Separator: ContextSeparator,
  Sub: ContextSub,
  SubTrigger: ContextSubTrigger,
  SubContent: ContextSubContent,
} as unknown as Kit;

/** Actions for the selection (or the one task right-clicked if it isn't selected). */
function MenuBody({ ids, kit }: { ids: string[]; kit: Kit }) {
  const r = useReplica();
  const today = r.context().today;
  const tasks = ids.map((id) => r.store.get('task', id)).filter((x) => !!x);
  const first = tasks[0];
  if (!first) return null;
  const deleted = tasks.every((x) => x.deletedAt);
  const allDone = tasks.every((x) => x.completedAt);
  const K = kit;
  const weekend = addDays(today, Math.max(0, 6 - isoWeekday(today)));
  const nextWeek = addDays(today, 8 - isoWeekday(today));

  if (deleted) {
    return (
      <K.Item onSelect={() => ids.forEach(restore)}>
        <RotateCcw />
        {t('task.restore')}
      </K.Item>
    );
  }

  const dateItem = (icon: ReactNode, label: string, date: string | null, shortcut?: string) => (
    <K.Item onSelect={() => void schedule(ids, date)} shortcut={shortcut}>
      {icon}
      {label}
    </K.Item>
  );

  return (
    <>
      {ids.length === 1 && (
        <K.Item onSelect={() => useUI.getState().openDetail(first.id)} shortcut="↵">
          <PanelRightOpen />
          {t('task.openDetail')}
        </K.Item>
      )}
      <K.Item onSelect={() => completeMany(ids)} shortcut="E">
        {allDone ? <RotateCcw /> : <Check />}
        {allDone ? t('task.reopen') : t('task.complete')}
      </K.Item>
      <K.Separator />
      {dateItem(<Sun className="!text-jade" />, t('date.today'), today, 'T')}
      {dateItem(<SunMedium className="!text-p2" />, t('date.tomorrow'), addDays(today, 1), 'M')}
      {dateItem(<Sofa className="!text-p3" />, t('date.thisWeekend'), weekend)}
      {dateItem(<CalendarDays className="!text-[#8a5cd6]" />, t('date.nextWeek'), nextWeek)}
      {tasks.some((x) => x.scheduled) && dateItem(<CalendarX />, t('date.none'), null)}
      <K.Separator />
      <K.Sub>
        <K.SubTrigger>
          <Flag />
          {t('task.priority')}
        </K.SubTrigger>
        <K.SubContent>
          {([3, 2, 1, 0] as Priority[]).map((p) => (
            <K.Item key={p} onSelect={() => setPriority(ids, p)} shortcut={String(4 - p)}>
              <Flag style={{ color: PRIORITY_COLOR[p] }} fill={p ? PRIORITY_COLOR[p] : 'none'} />
              {t(`priority.${p}`)}
              {ids.length === 1 && first.priority === p && <Check className="ml-auto !text-jade" />}
            </K.Item>
          ))}
        </K.SubContent>
      </K.Sub>
      <K.Sub>
        <K.SubTrigger>
          <ArrowRightLeft />
          {t('task.moveTo')}
        </K.SubTrigger>
        <K.SubContent className="p-0">
          <ProjectList
            value={first.projectId}
            sectionId={first.sectionId}
            onPick={(projectId, sectionId) => move(ids, sectionId ? { sectionId } : { projectId })}
          />
        </K.SubContent>
      </K.Sub>
      {ids.length === 1 && (
        <K.Item
          onSelect={() => {
            useUI.getState().openDetail(first.id);
            useUI.getState().set({ breakdownNonce: Date.now() });
          }}
        >
          <Sparkles className="!text-jade" />
          {t('ai.breakdown')}
        </K.Item>
      )}
      {ids.length === 1 && (
        <K.Item onSelect={() => duplicate(first.id)}>
          <Copy />
          {t('task.duplicate')}
        </K.Item>
      )}
      <K.Separator />
      <K.Item danger onSelect={() => removeTasks(ids)} shortcut={`${MOD}⌫`}>
        <Trash2 />
        {t('task.delete')}
      </K.Item>
    </>
  );
}

export function TaskContextMenu({ ids }: { ids: string[] }) {
  return (
    <contextKit.Content>
      <MenuBody ids={ids} kit={contextKit} />
    </contextKit.Content>
  );
}

export function TaskDropdownMenu({ ids }: { ids: string[] }) {
  return (
    <MenuContent align="end">
      <MenuBody ids={ids} kit={dropdownKit} />
    </MenuContent>
  );
}
