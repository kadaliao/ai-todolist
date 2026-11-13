import type { Replica } from '@ai-todo/core';
import { parseQuickAdd } from '@ai-todo/core';
import { Download, Loader2, Mic, Sparkles, Upload, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { describeRecurrence, formatScheduled } from '../lib/dates';
import { getLocale, type Locale, t } from '../lib/i18n';
import { addTasks } from '../state/actions';
import { AiError, draftToTask, type ExtractedTask, extractTasks, transcribe } from '../state/ai';
import { requestNotificationPermission, setReminderSettings, useReminderSettings } from '../state/reminders';
import { timeZone, useReplica, useToday } from '../state/replica';
import { connectSync, disconnectSync, useSyncStatus, useSyncStore } from '../state/sync';
import { useUI } from '../state/ui';
import { setTheme } from './theme';
import { Button, cx, Dialog, Kbd, MOD } from './ui';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex flex-col items-center gap-2 px-4 pb-[env(safe-area-inset-bottom)]"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.14 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            className={cx(
              'pointer-events-auto flex min-h-10 max-w-[min(520px,100%)] items-center gap-3 rounded-[11px] py-1.5 pl-4 pr-1.5 text-[13px] shadow-float',
              toast.tone === 'error' ? 'bg-p1 text-white' : 'bg-ink text-bg',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  useUI.getState().dismissToast(toast.id);
                }}
                className="rounded-[7px] px-2.5 py-1 font-semibold text-[color-mix(in_srgb,var(--jade)_60%,var(--bg))] hover:bg-white/10"
              >
                {toast.action.label}
                <span className="ml-1.5 hidden font-normal opacity-60 sm:inline">{MOD}Z</span>
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => useUI.getState().dismissToast(toast.id)}
              className="grid size-7 place-items-center rounded-[7px] opacity-60 hover:bg-white/10 hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function RescheduleDialog() {
  const prompt = useUI((s) => s.reschedulePrompt);
  return (
    <Dialog
      open={!!prompt}
      onOpenChange={(o) => !o && prompt?.resolve(null)}
      title={t('reschedule.title')}
      description={t('reschedule.body')}
      className="w-[min(420px,calc(100vw-32px))]"
    >
      <div className="flex justify-end gap-2 px-5 pb-4 pt-5">
        <Button variant="ghost" onClick={() => prompt?.resolve(null)}>
          {t('cancel')}
        </Button>
        <Button onClick={() => prompt?.resolve('series')}>{t('reschedule.series')}</Button>
        <Button variant="primary" autoFocus onClick={() => prompt?.resolve('occurrence')}>
          {t('reschedule.occurrence')}
        </Button>
      </div>
    </Dialog>
  );
}

const SHORTCUTS: [string, string[]][] = [
  ['shortcuts.add', ['Q']],
  ['shortcuts.palette', [MOD, 'K']],
  ['shortcuts.search', ['/']],
  ['shortcuts.navigate', ['↑', '↓']],
  ['shortcuts.open', ['↵']],
  ['shortcuts.complete', ['E']],
  ['shortcuts.date', ['D']],
  ['shortcuts.today', ['T']],
  ['shortcuts.tomorrow', ['M']],
  ['shortcuts.priority', ['1', '2', '3', '4']],
  ['shortcuts.indent', ['Tab', '⇧Tab']],
  ['shortcuts.select', ['⇧↑↓', `${MOD}Click`]],
  ['shortcuts.delete', [MOD, '⌫']],
  ['shortcuts.undo', [`${MOD}Z`, `⇧${MOD}Z`]],
  ['shortcuts.goto', ['G', '…']],
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => useUI.getState().set({ shortcutsOpen: o })}
      title={t('shortcuts.title')}
    >
      <div className="grid grid-cols-1 gap-x-8 px-5 pb-5 pt-3 sm:grid-cols-2">
        {SHORTCUTS.map(([key, keys]) => (
          <div
            key={key}
            className="flex h-9 items-center justify-between gap-3 border-b border-line text-[13px]"
          >
            <span className="text-ink-2">{t(key as 'shortcuts.add')}</span>
            <span className="flex gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function SettingsDialog({ onLocale }: { onLocale: (l: Locale) => void }) {
  const open = useUI((s) => s.settingsOpen);
  const theme = useUI((s) => s.theme);
  const r = useReplica();
  const sync = useSyncStatus();
  const { config, ai } = useSyncStore();
  const [url, setUrl] = useState(config?.url ?? '');
  const [token, setToken] = useState(config?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setUrl(config?.url ?? '');
    setToken(config?.token ?? '');
    setError(null);
    // Served by docket-server itself? Then that's the sync server — prefill its address.
    if (!config && location.protocol.startsWith('http')) {
      fetch('/api/ping')
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { name?: string } | null) => {
          if (b?.name === 'docket-server') setUrl((u) => u || location.origin);
        })
        .catch(() => {});
    }
  }, [open, config]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => useUI.getState().set({ settingsOpen: o })}
      title={t('settings.title')}
      className="w-[min(600px,calc(100vw-32px))]"
    >
      <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto px-5 pb-5 pt-4">
        <Section title={t('settings.general')}>
          <Row label={t('settings.language')}>
            <Segmented
              value={getLocale()}
              options={[
                ['zh', '中文'],
                ['en', 'English'],
              ]}
              onChange={(v) => onLocale(v as Locale)}
            />
          </Row>
          <Row label={t('settings.theme')}>
            <Segmented
              value={theme}
              options={[
                ['system', t('settings.theme.system')],
                ['light', t('settings.theme.light')],
                ['dark', t('settings.theme.dark')],
              ]}
              onChange={(v) => setTheme(v as 'system')}
            />
          </Row>
        </Section>

        <Section title={t('settings.sync')}>
          <p className="text-[12.5px] leading-relaxed text-ink-3">{t('settings.sync.help')}</p>
          <div className="flex flex-col gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docket.example.com"
              aria-label={t('settings.sync.server')}
              disabled={!!config}
              className={inputClass}
            />
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('settings.sync.token')}
              aria-label={t('settings.sync.token')}
              type="password"
              disabled={!!config}
              className={inputClass}
            />
          </div>
          <div className="flex items-center gap-3">
            {config ? (
              <Button
                onClick={async () => {
                  await disconnectSync();
                }}
              >
                {t('settings.sync.disconnect')}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!url.trim() || !token.trim() || busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await connectSync(r, { url, token });
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {t('settings.sync.connect')}
              </Button>
            )}
            <span
              className={cx(
                'text-[12.5px]',
                error || sync.state === 'error'
                  ? 'text-p1'
                  : sync.state === 'synced'
                    ? 'text-jade'
                    : 'text-ink-3',
              )}
            >
              {error ?? sync.label}
            </span>
          </div>
        </Section>

        <RemindersSection />

        <Section title={t('settings.ai')}>
          <p className="text-[12.5px] leading-relaxed text-ink-3">{t('settings.ai.help')}</p>
          <p className={cx('text-[13px]', ai?.available ? 'text-jade' : 'text-ink-2')}>
            {ai?.available
              ? t('settings.ai.status.ok', { model: ai.model ?? '' })
              : t('settings.ai.status.off')}
          </p>
        </Section>

        <Section title={t('settings.data')}>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                const blob = new Blob([JSON.stringify(exportData(r), null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `docket-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              <Download className="size-3.5" />
              {t('settings.export')}
            </Button>
            <Button onClick={() => useUI.getState().set({ settingsOpen: false, shortcutsOpen: true })}>
              {t('palette.shortcuts')}
            </Button>
          </div>
        </Section>
      </div>
    </Dialog>
  );
}

function RemindersSection() {
  const { enabled, atTimeByDefault, permission } = useReminderSettings();
  const zh = getLocale() === 'zh';
  return (
    <Section title={zh ? '提醒' : 'Reminders'}>
      <Row label={zh ? '提醒通知' : 'Reminder notifications'}>
        {permission === 'granted' ? (
          <Toggle checked={enabled} onChange={(v) => setReminderSettings({ enabled: v })} />
        ) : (
          <Button
            size="sm"
            onClick={() => void requestNotificationPermission()}
            disabled={permission === 'denied'}
          >
            {permission === 'denied'
              ? zh
                ? '已被系统拒绝'
                : 'Blocked by system'
              : zh
                ? '允许通知'
                : 'Allow notifications'}
          </Button>
        )}
      </Row>
      <Row label={zh ? '有时间的任务默认准时提醒' : 'Remind at the task’s time by default'}>
        <Toggle checked={atTimeByDefault} onChange={(v) => setReminderSettings({ atTimeByDefault: v })} />
      </Row>
      {permission === 'denied' && (
        <p className="text-[12.5px] text-ink-3">
          {zh
            ? '请在浏览器或系统设置里允许 Docket 发送通知。'
            : 'Allow notifications for Docket in your browser or system settings.'}
        </p>
      )}
    </Section>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-[22px] w-[38px] rounded-full transition-colors',
        checked ? 'bg-jade' : 'bg-line-strong',
      )}
    >
      <span
        className={cx(
          'absolute top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

const inputClass =
  'h-9 w-full rounded-[8px] border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-ink-3 focus:border-jade-line disabled:opacity-60';

function exportData(r: Replica) {
  const s = r.store;
  return {
    exportedAt: new Date().toISOString(),
    projects: s.all('project'),
    sections: s.all('section'),
    labels: s.all('label'),
    tasks: s.all('task'),
    completions: s.all('completion'),
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] text-ink-2">{label}</span>
      {children}
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div role="radiogroup" className="flex rounded-[8px] bg-hover p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cx(
            'h-7 rounded-[6px] px-3 text-[12.5px] transition-colors',
            value === v
              ? 'bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
              : 'text-ink-2 hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// AI brain dump

interface Draft {
  key: number;
  include: boolean;
  data: ExtractedTask;
}

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: {
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
    resultIndex: number;
  }) => void;
  onend: () => void;
  onerror: () => void;
  start(): void;
  stop(): void;
};

export function BrainDump() {
  const open = useUI((s) => s.brainDumpOpen);
  const r = useReplica();
  const today = useToday();
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const rec = useRef<SpeechRec | MediaRecorder | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (open) {
      const pre = sessionStorage.getItem('docket.dump');
      if (pre) {
        setText(pre);
        sessionStorage.removeItem('docket.dump');
      }
    } else {
      abort.current?.abort();
      setDrafts(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const close = () => useUI.getState().set({ brainDumpOpen: false });

  const extract = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError(null);
    setDrafts([]);
    try {
      for await (const item of extractTasks(r, text, ctl.signal)) {
        setDrafts((d) => [...(d ?? []), { key: ++seq.current, include: true, data: item }]);
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

  /** Without AI: one task per sentence/line, dates read by the local parser. */
  const splitLocally = () => {
    const parts = text
      .split(/[\n。；;！!？?]+|，(?=\s*(?:还有|然后|另外|再|并且))/)
      .map((s) => s.replace(/^\s*(?:还有|然后|另外|再|并且|and|also)\s*/i, '').trim())
      .filter((s) => s.length > 1);
    setDrafts(
      parts.map((p) => {
        const parsed = parseQuickAdd(p, { now: new Date(), timeZone: timeZone() });
        return {
          key: ++seq.current,
          include: true,
          data: {
            title: parsed.title || p,
            when:
              parsed.tokens
                .filter((x) => x.kind === 'date' || x.kind === 'recurrence')
                .map((x) => x.text)
                .join(' ') || undefined,
          },
        };
      }),
    );
    setError(null);
  };

  const addAll = () => {
    const chosen = (drafts ?? []).filter((d) => d.include && d.data.title.trim());
    if (!chosen.length) return;
    const ids = addTasks(
      chosen.map((d) => draftToTask(r, d.data)),
      'ai',
    );
    if (ids) {
      const tx = r.recent(1)[0]?.tx;
      useUI.getState().toast({
        message: t('toast.addedN', { n: chosen.length }),
        action: tx ? { label: t('undo'), run: () => r.revert(tx) } : undefined,
      });
    }
    setText('');
    close();
  };

  const startVoice = async () => {
    const W = window as unknown as {
      SpeechRecognition?: new () => SpeechRec;
      webkitSpeechRecognition?: new () => SpeechRec;
    };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (Ctor) {
      const sr = new Ctor();
      sr.lang = getLocale() === 'zh' ? 'zh-CN' : 'en-US';
      sr.continuous = true;
      sr.interimResults = false;
      const base = text;
      let acc = '';
      sr.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res?.isFinal) acc += res[0]?.transcript ?? '';
        }
        setText(base ? `${base} ${acc}` : acc);
      };
      sr.onend = () => setListening(false);
      sr.onerror = () => setListening(false);
      sr.start();
      rec.current = sr;
      setListening(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        for (const tr of stream.getTracks()) tr.stop();
        setListening(false);
        try {
          const said = await transcribe(new Blob(chunks, { type: mr.mimeType }));
          setText((x) => (x ? `${x} ${said}` : said));
        } catch (e) {
          setError((e as Error).message);
        }
      };
      mr.start();
      rec.current = mr;
      setListening(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const stopVoice = () => rec.current?.stop();

  const included = drafts?.filter((d) => d.include).length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => useUI.getState().set({ brainDumpOpen: o })}
      title={t('ai.dump.title')}
      className="top-[9vh] w-[min(640px,calc(100vw-24px))]"
    >
      <div className="flex flex-col gap-3 px-5 pb-5 pt-3">
        {drafts === null ? (
          <>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) {
                  e.preventDefault();
                  void extract();
                }
              }}
              placeholder={t('ai.dump.placeholder')}
              className="min-h-[160px] w-full resize-none rounded-[10px] border border-line bg-bg p-3 text-[14px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-jade-line"
            />
            {error && <p className="text-[12.5px] text-p1">{t('ai.unavailable', { message: error })}</p>}
            <div className="flex items-center gap-2">
              <Button
                variant={listening ? 'danger' : 'subtle'}
                onPointerDown={() => void startVoice()}
                onPointerUp={stopVoice}
                onPointerLeave={() => listening && stopVoice()}
              >
                <Mic className={cx('size-3.5', listening && 'animate-pulse')} />
                {listening ? t('ai.dump.listening') : t('ai.dump.voice')}
              </Button>
              <Button variant="ghost" disabled={!text.trim()} onClick={splitLocally}>
                {getLocale() === 'zh' ? '不用 AI，按句拆分' : 'Split by sentence (no AI)'}
              </Button>
              <Button
                variant="primary"
                className="ml-auto"
                disabled={!text.trim() || busy}
                onClick={() => void extract()}
              >
                <Sparkles className="size-3.5" />
                {t('ai.dump.extract')}
                <span className="opacity-70">{MOD}↵</span>
              </Button>
            </div>
          </>
        ) : (
          <>
            <details className="text-[12.5px] text-ink-3">
              <summary className="cursor-default select-none">{t('ai.dump.original')}</summary>
              <p className="mt-1 whitespace-pre-wrap rounded-[8px] bg-hover p-2.5 text-ink-2">{text}</p>
            </details>
            <div className="flex max-h-[52vh] flex-col gap-1.5 overflow-y-auto">
              <AnimatePresence initial={false}>
                {drafts.map((d) => (
                  <motion.div
                    key={d.key}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <DraftCard
                      draft={d}
                      today={today}
                      onChange={(data) =>
                        setDrafts((xs) => xs?.map((x) => (x.key === d.key ? { ...x, data } : x)) ?? null)
                      }
                      onToggle={() =>
                        setDrafts(
                          (xs) =>
                            xs?.map((x) => (x.key === d.key ? { ...x, include: !x.include } : x)) ?? null,
                        )
                      }
                      onRemove={() => setDrafts((xs) => xs?.filter((x) => x.key !== d.key) ?? null)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              {busy && (
                <div className="draft flex h-12 items-center gap-2 rounded-[10px] px-3 text-[13px] text-ink-3">
                  <Loader2 className="size-4 animate-spin text-jade" />
                  {t('ai.dump.extracting')}
                </div>
              )}
              {!busy && !drafts.length && (
                <p className="py-6 text-center text-[13px] text-ink-3">{t('ai.dump.empty')}</p>
              )}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button variant="ghost" onClick={() => setDrafts(null)}>
                {t('ai.dump.again')}
              </Button>
              <Button variant="primary" className="ml-auto" disabled={busy || !included} onClick={addAll}>
                {included === drafts.length
                  ? t('ai.dump.addAll', { n: included })
                  : t('ai.dump.addSelected', { n: included })}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function DraftCard({
  draft,
  today,
  onChange,
  onToggle,
  onRemove,
}: {
  draft: Draft;
  today: string;
  onChange: (d: ExtractedTask) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const r = useReplica();
  const input = draftToTask(r, draft.data);
  const project = input.projectId ? r.store.get('project', input.projectId) : null;
  return (
    <div
      className={cx(
        'group flex items-start gap-3 rounded-[10px] px-3 py-2.5 transition-opacity',
        draft.include ? 'draft' : 'border border-dashed border-line opacity-55',
      )}
    >
      <input
        type="checkbox"
        checked={draft.include}
        onChange={onToggle}
        aria-label={draft.data.title}
        className="mt-[3px] size-4 accent-[var(--jade)]"
      />
      <div className="min-w-0 flex-1">
        <input
          value={draft.data.title}
          onChange={(e) => onChange({ ...draft.data, title: e.target.value })}
          className="w-full bg-transparent text-[14px] font-medium outline-none"
        />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
          {input.scheduled ? (
            <span className="font-medium text-jade">
              {formatScheduled(input.scheduled, today)}
              {input.recurrence ? ` · ${describeRecurrence(input.recurrence as never)}` : ''}
            </span>
          ) : draft.data.when ? (
            <span title={draft.data.when}>“{draft.data.when}”</span>
          ) : null}
          {project && <span>#{project.name}</span>}
          {!project && draft.data.project && <span>#{draft.data.project}?</span>}
          {draft.data.priority && draft.data.priority < 4 && (
            <span className="text-p1">P{draft.data.priority}</span>
          )}
          {draft.data.labels?.map((l) => (
            <span key={l} className="text-p2">
              @{l}
            </span>
          ))}
          {draft.data.notes && <span className="truncate">{draft.data.notes}</span>}
        </div>
      </div>
      <button
        type="button"
        aria-label={t('delete')}
        onClick={onRemove}
        className="grid size-6 place-items-center rounded-[6px] text-ink-3 opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function InstanceBlocked({ onTakeOver }: { onTakeOver: () => void }) {
  return (
    <div className="grid h-full place-items-center bg-bg p-6">
      <div className="max-w-[360px] text-center">
        <p className="text-[15px] font-semibold">{t('instance.title')}</p>
        <p className="mt-2 text-[13px] text-ink-2">{t('instance.body')}</p>
        <Button variant="primary" className="mt-5" onClick={onTakeOver}>
          {t('instance.takeOver')}
        </Button>
      </div>
    </div>
  );
}

export { Upload };
