import { parseQuickAdd } from '@ai-todo/core';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { describeRecurrence, formatScheduled } from '../lib/dates';
import { t } from '../lib/i18n';
import { Logo } from './Sidebar';

/**
 * Desktop quick-entry window (global shortcut). It owns no data: the text goes to the main window,
 * which parses it against real project/label names and adds the task.
 */
export function QuickEntry() {
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  const parsed = useMemo(
    () => parseQuickAdd(text, { now: new Date(), timeZone: tz, ignore }),
    [text, ignore, tz],
  );

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const focus = () => {
      setSent(false);
      ref.current?.focus();
      ref.current?.select();
    };
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);

  const hide = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  };

  const submit = async () => {
    if (!parsed.title) return;
    const { emit } = await import('@tauri-apps/api/event');
    await emit('quick-add', { text, ignore });
    setSent(true);
    setText('');
    setIgnore([]);
    setTimeout(() => void hide(), 380);
  };

  const marks: ReactNode[] = [];
  let pos = 0;
  for (const tok of parsed.tokens) {
    if (tok.start > pos) marks.push(text.slice(pos, tok.start));
    marks.push(
      <mark key={tok.start} data-kind={tok.kind}>
        {text.slice(tok.start, tok.end)}
      </mark>,
    );
    pos = tok.end;
  }
  marks.push(text.slice(pos));

  return (
    <div className="flex h-screen items-start p-3" data-tauri-drag-region>
      <div className="w-full overflow-hidden rounded-[14px] border border-line-strong bg-surface shadow-float">
        <div className="flex items-center gap-3 px-4">
          <Logo size={22} />
          <div className="relative h-14 flex-1">
            <div
              aria-hidden
              className="qa-mirror pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-[17px] leading-[56px] text-transparent"
            >
              {marks}
            </div>
            <input
              ref={ref}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
                if (e.key === 'Escape') void hide();
              }}
              placeholder={t('qa.placeholder')}
              className="relative h-14 w-full bg-transparent text-[17px] leading-[56px] text-ink caret-jade outline-none placeholder:text-ink-3"
            />
          </div>
          {sent && <span className="text-[13px] font-medium text-jade">✓</span>}
        </div>
        {(parsed.scheduled || parsed.project || parsed.labels.length > 0 || parsed.priority) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 text-[12.5px]">
            {parsed.scheduled && (
              <Chip
                onClear={() =>
                  setIgnore((x) => [
                    ...x,
                    ...parsed.tokens
                      .filter((k) => k.kind === 'date' || k.kind === 'recurrence')
                      .map((k) => k.text),
                  ])
                }
              >
                <span className="text-jade">
                  {formatScheduled(parsed.scheduled, today)}
                  {parsed.recurrence ? ` · ${describeRecurrence(parsed.recurrence)}` : ''}
                </span>
              </Chip>
            )}
            {parsed.project && <Chip>#{parsed.project.name}</Chip>}
            {parsed.labels.map((l) => (
              <Chip key={l.name}>@{l.name}</Chip>
            ))}
            {parsed.priority ? <Chip>P{4 - parsed.priority}</Chip> : null}
            <span className="ml-auto text-ink-3">{t('qa.hint')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ children, onClear }: { children: ReactNode; onClear?: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-hover px-2 text-ink-2">
      {children}
      {onClear && (
        <button
          type="button"
          aria-label={t('qa.unrecognize')}
          onClick={onClear}
          className="text-ink-3 hover:text-ink"
        >
          ×
        </button>
      )}
    </span>
  );
}
