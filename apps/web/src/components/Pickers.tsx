import { type Priority, sidebar, sortByOrder } from '@ai-todo/core';
import { Check, Flag, Hash, Inbox, Plus, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { t } from '../lib/i18n';
import { addLabel, addProject } from '../state/actions';
import { useQuery } from '../state/replica';
import { cx } from './ui';

export const PRIORITY_COLOR: Record<Priority, string> = {
  3: 'var(--p1)',
  2: 'var(--p2)',
  1: 'var(--p3)',
  0: 'var(--ink-3)',
};

export function PriorityList({ value, onPick }: { value: Priority; onPick: (p: Priority) => void }) {
  return (
    <div className="flex flex-col p-1" role="listbox">
      {([3, 2, 1, 0] as Priority[]).map((p) => (
        <button
          key={p}
          type="button"
          role="option"
          aria-selected={value === p}
          onClick={() => onPick(p)}
          className="flex h-8 items-center gap-2.5 rounded-[6px] px-2 text-left text-[13px] hover:bg-hover"
        >
          <Flag
            className="size-[15px]"
            style={{ color: PRIORITY_COLOR[p] }}
            fill={p ? PRIORITY_COLOR[p] : 'none'}
          />
          <span className="flex-1">{t(`priority.${p}`)}</span>
          <span className="text-[11.5px] text-ink-3">{p ? `p${4 - p}` : 'p4'}</span>
          {value === p && <Check className="size-3.5 text-jade" />}
        </button>
      ))}
    </div>
  );
}

/** Search-as-you-type project list, including Inbox and sections. Creates on Enter if new. */
export function ProjectList({
  value,
  sectionId,
  onPick,
}: {
  value: string | null;
  sectionId?: string | null;
  onPick: (projectId: string | null, sectionId: string | null) => void;
}) {
  const [q, setQ] = useState('');
  const data = useQuery((s) => {
    const sb = sidebar(s);
    const sections = s.all('section').filter((x) => !x.deletedAt);
    return { sb, sections };
  });
  const items = useMemo(() => {
    const out: {
      key: string;
      projectId: string | null;
      sectionId: string | null;
      name: string;
      color: string | null;
      depth: number;
    }[] = [{ key: 'inbox', projectId: null, sectionId: null, name: t('nav.inbox'), color: null, depth: 0 }];
    const add = (p: { id: string; name: string; color: string | null }, depth: number) => {
      out.push({ key: p.id, projectId: p.id, sectionId: null, name: p.name, color: p.color, depth });
      for (const s of sortByOrder(data.sections.filter((x) => x.projectId === p.id))) {
        out.push({
          key: s.id,
          projectId: p.id,
          sectionId: s.id,
          name: s.name,
          color: p.color,
          depth: depth + 1,
        });
      }
    };
    for (const { project, children } of data.sb.projects) {
      add(project, 0);
      for (const c of children) add(c, 1);
    }
    const needle = q.trim().toLowerCase();
    return needle ? out.filter((i) => i.name.toLowerCase().includes(needle)) : out;
  }, [data, q]);
  const [active, setActive] = useState(0);
  const exact = items.some((i) => i.name.toLowerCase() === q.trim().toLowerCase());

  const choose = (i: number) => {
    const item = items[i];
    if (item) onPick(item.projectId, item.sectionId);
    else if (q.trim()) {
      const id = addProject(q.trim());
      if (id) onPick(id, null);
    }
  };

  return (
    <div className="w-[260px] p-1.5">
      <input
        // biome-ignore lint/a11y/noAutofocus: picker search
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - (exact || !q.trim() ? 1 : 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(active);
          }
        }}
        placeholder={t('project.namePlaceholder')}
        className="mb-1 h-8 w-full rounded-[7px] border border-line bg-bg px-2.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-jade-line"
      />
      <div className="max-h-[300px] overflow-y-auto">
        {items.map((i, idx) => {
          const selected = i.projectId === value && (i.sectionId ?? null) === (sectionId ?? null);
          return (
            <button
              key={i.key}
              type="button"
              onMouseEnter={() => setActive(idx)}
              onClick={() => choose(idx)}
              className={cx(
                'flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px]',
                idx === active && 'bg-hover',
              )}
              style={{ paddingLeft: 8 + i.depth * 16 }}
            >
              {i.projectId === null ? (
                <Inbox className="size-[15px] text-p3" />
              ) : i.sectionId ? (
                <span className="w-[15px] text-center text-ink-3">/</span>
              ) : (
                <Hash className="size-[15px]" style={{ color: i.color ?? 'var(--ink-3)' }} />
              )}
              <span className="flex-1 truncate">{i.name}</span>
              {selected && <Check className="size-3.5 text-jade" />}
            </button>
          );
        })}
        {q.trim() && !exact && (
          <button
            type="button"
            onMouseEnter={() => setActive(items.length)}
            onClick={() => choose(items.length)}
            className={cx(
              'flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] text-jade',
              active === items.length && 'bg-hover',
            )}
          >
            <Plus className="size-[15px]" />
            {t('qa.newProject', { name: q.trim() })}
          </button>
        )}
      </div>
    </div>
  );
}

export function LabelList({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const labels = useQuery((s) => sortByOrder(s.all('label').filter((l) => !l.deletedAt)));
  const needle = q.trim().toLowerCase();
  const shown = needle ? labels.filter((l) => l.name.toLowerCase().includes(needle)) : labels;
  const exact = labels.some((l) => l.name.toLowerCase() === needle);
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const create = () => {
    const id = addLabel(q.trim());
    if (id) onChange([...value, id]);
    setQ('');
  };
  return (
    <div className="w-[240px] p-1.5">
      <input
        // biome-ignore lint/a11y/noAutofocus: picker search
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = shown[0];
            if (needle && !exact) create();
            else if (first) toggle(first.id);
          }
        }}
        placeholder={t('label.namePlaceholder')}
        className="mb-1 h-8 w-full rounded-[7px] border border-line bg-bg px-2.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-jade-line"
      />
      <div className="max-h-[260px] overflow-y-auto">
        {shown.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => toggle(l.id)}
            className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] hover:bg-hover"
          >
            <Tag className="size-[15px]" style={{ color: l.color ?? 'var(--p2)' }} />
            <span className="flex-1 truncate">{l.name}</span>
            {value.includes(l.id) && <Check className="size-3.5 text-jade" />}
          </button>
        ))}
        {needle && !exact && (
          <button
            type="button"
            onClick={create}
            className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] text-jade hover:bg-hover"
          >
            <Plus className="size-[15px]" />
            {t('qa.newLabel', { name: q.trim() })}
          </button>
        )}
      </div>
    </div>
  );
}
