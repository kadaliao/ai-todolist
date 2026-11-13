import {
  addDays,
  isoWeekday,
  type LocalDate,
  parseQuickAdd,
  type RepeatFrom,
  type Scheduled,
} from '@ai-todo/core';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Repeat,
  Sofa,
  Sun,
  SunMedium,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { describeRecurrence, formatScheduled, monthGrid, monthTitle, weekdayName } from '../lib/dates';
import { getLocale, t } from '../lib/i18n';
import { timeZone } from '../state/replica';
import { cx } from './ui';

export interface RecurrenceValue {
  rule: string;
  from: RepeatFrom;
}

export interface DatePickerProps {
  today: LocalDate;
  value: Scheduled | null;
  recurrence: RecurrenceValue | null;
  onDate: (date: LocalDate | null) => void;
  onTime: (time: string | null) => void;
  onRecurrence?: (rec: RecurrenceValue | null) => void;
  /** Applied together, from the natural-language box. */
  onParsed?: (scheduled: Scheduled, recurrence: RecurrenceValue | null) => void;
  onClose?: () => void;
}

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export function DatePicker({
  today,
  value,
  recurrence,
  onDate,
  onTime,
  onRecurrence,
  onParsed,
  onClose,
}: DatePickerProps) {
  const selected = value?.date ?? null;
  const [cursor, setCursor] = useState(() => {
    const base = selected ?? today;
    const [y, m] = base.split('-').map(Number) as [number, number];
    return { y, m };
  });
  const [text, setText] = useState('');
  const [showTime, setShowTime] = useState(!!value?.time);
  const [customRepeat, setCustomRepeat] = useState('');

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    const r = parseQuickAdd(text, { now: new Date(), timeZone: timeZone() });
    return r.scheduled ? r : null;
  }, [text]);

  const weekend = addDays(today, Math.max(0, 6 - isoWeekday(today)));
  const nextWeek = addDays(today, 8 - isoWeekday(today));
  const quick: { label: string; date: LocalDate | null; icon: typeof Sun; hint: string; tone: string }[] = [
    { label: t('date.today'), date: today, icon: Sun, hint: weekdayName(today), tone: 'text-jade' },
    {
      label: t('date.tomorrow'),
      date: addDays(today, 1),
      icon: SunMedium,
      hint: weekdayName(addDays(today, 1)),
      tone: 'text-p2',
    },
    { label: t('date.thisWeekend'), date: weekend, icon: Sofa, hint: weekdayName(weekend), tone: 'text-p3' },
    {
      label: t('date.nextWeek'),
      date: nextWeek,
      icon: CalendarDays,
      hint: formatShort(nextWeek),
      tone: 'text-[#8a5cd6]',
    },
  ];

  const days = monthGrid(cursor.y, cursor.m);
  const shiftMonth = (k: number) => {
    const idx = cursor.y * 12 + cursor.m - 1 + k;
    setCursor({ y: Math.floor(idx / 12), m: (idx % 12) + 1 });
  };

  const base = selected ?? today;
  const [, bm, bd] = base.split('-').map(Number) as [number, number, number];
  const wd = WEEKDAY_CODES[isoWeekday(base) - 1];
  const presets: RecurrenceValue[] = [
    { rule: 'FREQ=DAILY', from: 'scheduled' },
    { rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', from: 'scheduled' },
    { rule: `FREQ=WEEKLY;BYDAY=${wd}`, from: 'scheduled' },
    { rule: `FREQ=MONTHLY;BYMONTHDAY=${bd}`, from: 'scheduled' },
    { rule: `FREQ=YEARLY;BYMONTH=${bm};BYMONTHDAY=${bd}`, from: 'scheduled' },
  ];

  const customParsed = useMemo(() => {
    if (!customRepeat.trim()) return null;
    const r = parseQuickAdd(customRepeat, { now: new Date(), timeZone: timeZone() });
    return r.recurrence ?? null;
  }, [customRepeat]);

  return (
    <div className="w-[284px] select-none p-2 text-[13px]">
      <div className="relative">
        <input
          // biome-ignore lint/a11y/noAutofocus: the picker exists to type into
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && parsed?.scheduled) {
              e.preventDefault();
              if (onParsed) onParsed(parsed.scheduled, parsed.recurrence ?? null);
              else {
                onDate(parsed.scheduled.date);
                if (parsed.scheduled.time) onTime(parsed.scheduled.time);
              }
              onClose?.();
            }
          }}
          placeholder={t('date.inputPlaceholder')}
          className="h-8 w-full rounded-[7px] border border-line bg-bg px-2.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-jade-line"
        />
        {text && (
          <div className="mt-1.5 flex items-center gap-1.5 px-1 text-[12px]">
            {parsed?.scheduled ? (
              <span className="text-jade">
                {formatScheduled(parsed.scheduled, today)}
                {parsed.recurrence ? ` · ${describeRecurrence(parsed.recurrence)}` : ''}
              </span>
            ) : (
              <span className="text-ink-3">{t('date.invalid')}</span>
            )}
          </div>
        )}
      </div>

      <div className="mt-1.5 flex flex-col">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => {
              onDate(q.date);
              onClose?.();
            }}
            className={cx(
              'flex h-8 items-center gap-2.5 rounded-[6px] px-2 text-left hover:bg-hover',
              q.date === selected && 'bg-hover',
            )}
          >
            <q.icon className={cx('size-[15px]', q.tone)} />
            <span className="flex-1">{q.label}</span>
            <span className="text-[12px] text-ink-3">{q.hint}</span>
          </button>
        ))}
        {selected && (
          <button
            type="button"
            onClick={() => {
              onDate(null);
              onClose?.();
            }}
            className="flex h-8 items-center gap-2.5 rounded-[6px] px-2 text-left hover:bg-hover"
          >
            <X className="size-[15px] text-ink-3" />
            <span className="flex-1">{t('date.none')}</span>
          </button>
        )}
      </div>

      <div className="mt-1.5 border-t border-line pt-2">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[12.5px] font-semibold">{monthTitle(cursor.y, cursor.m)}</span>
          <div className="flex">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
              className="grid size-6 place-items-center rounded-[5px] text-ink-2 hover:bg-hover"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Today"
              onClick={() => {
                const [y, m] = today.split('-').map(Number) as [number, number];
                setCursor({ y, m });
              }}
              className="grid size-6 place-items-center rounded-[5px] text-ink-2 hover:bg-hover"
            >
              <span className="size-1.5 rounded-full bg-current" />
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
              className="grid size-6 place-items-center rounded-[5px] text-ink-2 hover:bg-hover"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-ink-3">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <div key={d} className="py-1">
              {weekdayShort(d)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5 text-center">
          {days.map((d) => {
            const [, m, day] = d.split('-').map(Number) as [number, number, number];
            const inMonth = m === cursor.m;
            const isSel = d === selected;
            const isToday = d === today;
            const past = d < today;
            return (
              <button
                key={d}
                type="button"
                onClick={() => {
                  onDate(d);
                  onClose?.();
                }}
                className={cx(
                  'mx-auto grid size-[30px] place-items-center rounded-full text-[12.5px] tabular-nums transition-colors',
                  isSel ? 'bg-jade font-semibold text-jade-ink' : 'hover:bg-hover',
                  !isSel && isToday && 'font-semibold text-jade',
                  !isSel && !inMonth && 'text-ink-3',
                  !isSel && past && inMonth && 'text-ink-3',
                )}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
        {showTime || value?.time ? (
          <div className="flex h-8 items-center gap-2.5 px-2">
            <Clock className="size-[15px] text-ink-2" />
            <input
              type="time"
              value={value?.time ?? ''}
              onChange={(e) => onTime(e.target.value || null)}
              className="h-7 flex-1 rounded-[6px] border border-line bg-bg px-2 text-[13px] tabular-nums outline-none focus:border-jade-line"
            />
            {value?.time && (
              <button
                type="button"
                aria-label={t('date.clearTime')}
                onClick={() => {
                  onTime(null);
                  setShowTime(false);
                }}
                className="grid size-6 place-items-center rounded-[5px] text-ink-3 hover:bg-hover"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled={!selected}
            onClick={() => setShowTime(true)}
            className="flex h-8 items-center gap-2.5 rounded-[6px] px-2 text-left text-ink-2 hover:bg-hover disabled:opacity-40"
          >
            <Clock className="size-[15px]" />
            {t('date.addTime')}
          </button>
        )}

        {onRecurrence && (
          <RepeatRow
            recurrence={recurrence}
            presets={presets}
            custom={customRepeat}
            setCustom={setCustomRepeat}
            customParsed={customParsed}
            onRecurrence={onRecurrence}
          />
        )}
      </div>
    </div>
  );
}

function RepeatRow({
  recurrence,
  presets,
  custom,
  setCustom,
  customParsed,
  onRecurrence,
}: {
  recurrence: RecurrenceValue | null;
  presets: RecurrenceValue[];
  custom: string;
  setCustom: (s: string) => void;
  customParsed: RecurrenceValue | null;
  onRecurrence: (rec: RecurrenceValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-left hover:bg-hover"
      >
        <Repeat className={cx('size-[15px]', recurrence ? 'text-jade' : 'text-ink-2')} />
        <span className={cx('flex-1 truncate', !recurrence && 'text-ink-2')}>
          {recurrence ? describeRecurrence(recurrence) : t('date.noRepeat')}
        </span>
        <ChevronRight className={cx('size-3.5 text-ink-3 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="ml-[26px] flex flex-col pb-1">
          {recurrence && (
            <button
              type="button"
              onClick={() => onRecurrence(null)}
              className="h-7 rounded-[5px] px-2 text-left text-ink-2 hover:bg-hover"
            >
              {t('date.noRepeat')}
            </button>
          )}
          {presets.map((p) => (
            <button
              key={p.rule}
              type="button"
              onClick={() => onRecurrence({ rule: p.rule, from: recurrence?.from ?? 'scheduled' })}
              className={cx(
                'h-7 rounded-[5px] px-2 text-left hover:bg-hover',
                recurrence?.rule === p.rule && 'font-medium text-jade',
              )}
            >
              {describeRecurrence(p)}
            </button>
          ))}
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customParsed) {
                e.preventDefault();
                onRecurrence(customParsed);
                setCustom('');
              }
            }}
            placeholder={t('date.repeatCustom')}
            className="mt-1 h-7 rounded-[6px] border border-line bg-bg px-2 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-jade-line"
          />
          {custom && (
            <span className={cx('px-2 pt-1 text-[12px]', customParsed ? 'text-jade' : 'text-ink-3')}>
              {customParsed ? describeRecurrence(customParsed) : t('date.invalid')}
            </span>
          )}
          {recurrence && (
            <label className="mt-1.5 flex items-center gap-2 px-2 text-[12.5px] text-ink-2">
              <input
                type="checkbox"
                checked={recurrence.from === 'completion'}
                onChange={(e) =>
                  onRecurrence({ ...recurrence, from: e.target.checked ? 'completion' : 'scheduled' })
                }
                className="accent-[var(--jade)]"
              />
              {t('date.repeatFromCompletion')}
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function weekdayShort(d: number): string {
  return t('weekday.short').split(',')[d] ?? '';
}

function formatShort(d: LocalDate): string {
  const [, m, day] = d.split('-').map(Number) as [number, number, number];
  return `${weekdayName(d, getLocale() !== 'zh')} ${m}/${day}`;
}
