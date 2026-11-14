import type { AssistantTurn } from '@ai-todo/core';
import { type ChangeLine, describeChanges, getLocale, type MessageKey, t } from '@ai-todo/shared';
import { ArrowUp, Loader2, Mic, RotateCcw, Square, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { getReplica } from '../state/actions';
import { getAssistant, useAssistant, vocabulary } from '../state/assistant';
import { useToday } from '../state/replica';
import { useSyncStore } from '../state/sync';
import { useUI } from '../state/ui';
import { type Listening, listen, VoiceError } from '../state/voice';
import { cx, Tooltip } from './ui';

/**
 * Voice-first assistant. Hold the mic (or Space) and talk; release to send. A quick tap
 * listens hands-free and sends after a pause. ⌘J opens the panel for typing.
 */

// --- voice controller (shared by the floating button, the panel and the Space key) -----------

interface VoiceState {
  phase: 'idle' | 'listening' | 'transcribing';
  handsFree: boolean;
  /** Pointer slid up far enough that releasing cancels. */
  cancelArmed: boolean;
  partial: string;
  level: number;
  error: string | null;
}

const useVoice = create<VoiceState>(() => ({
  phase: 'idle',
  handsFree: false,
  cancelArmed: false,
  partial: '',
  level: 0,
  error: null,
}));

let session: Listening | null = null;
let starting = false;
/** Stop/cancel asked for while the microphone was still starting. */
let early: 'stop' | 'cancel' | null = null;
let userCancelled = false;

async function startVoice(handsFree: boolean): Promise<void> {
  if (session || starting) return;
  starting = true;
  early = null;
  userCancelled = false;
  useUI.getState().set({ assistantOpen: true });
  getAssistant().abort();
  useVoice.setState({
    phase: 'listening',
    handsFree,
    cancelArmed: false,
    partial: '',
    level: 0,
    error: null,
  });
  try {
    session = await listen({
      handsFree: () => useVoice.getState().handsFree,
      hints: vocabulary(),
      onPartial: (partial) => useVoice.setState({ partial }),
      onLevel: (level) => useVoice.setState({ level }),
      onTranscribing: () => useVoice.setState({ phase: 'transcribing', level: 0 }),
      onEnd: (r) => {
        session = null;
        useVoice.setState({ phase: 'idle', level: 0, partial: '', cancelArmed: false });
        if ('error' in r) useVoice.setState({ error: r.error });
        else if (r.text.trim()) void getAssistant().say(r.text);
        else if (!userCancelled) useVoice.setState({ error: t('agent.noSpeech') });
      },
    });
    // Released before the microphone was ready.
    if (early === 'cancel') session.cancel();
    else if (early === 'stop') session.stop();
  } catch (e) {
    session = null;
    useVoice.setState({
      phase: 'idle',
      error: e instanceof VoiceError ? e.message : (e as Error).message,
    });
  } finally {
    starting = false;
  }
}

/** Open the panel and listen until a pause (menu-bar item, deep links). */
export function listenHandsFree(): void {
  void startVoice(true);
}

const stopVoice = () => {
  if (session) session.stop();
  else if (starting) early = 'stop';
};
const cancelVoice = () => {
  userCancelled = true;
  if (session) session.cancel();
  else if (starting) early = 'cancel';
  else useVoice.setState({ phase: 'idle', partial: '', level: 0 });
};

/** Under this, a press counts as a tap: keep listening hands-free instead of stopping. */
const TAP_MS = 350;
const CANCEL_DY = 70;

/**
 * Pointer handlers for a mic button. The release is tracked on `window`: pressing the floating
 * button opens the panel and unmounts the button, so its own pointerup would never arrive.
 */
function usePressToTalk() {
  return {
    onPointerDown(e: React.PointerEvent) {
      if (e.button !== 0) return;
      const v = useVoice.getState();
      if (v.phase === 'listening') {
        // Tapping the mic while listening hands-free means "done".
        if (v.handsFree) stopVoice();
        return;
      }
      if (v.phase === 'transcribing') return;
      e.preventDefault();
      const at = Date.now();
      const y0 = e.clientY;
      const id = e.pointerId;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        const armed = y0 - ev.clientY > CANCEL_DY;
        if (armed !== useVoice.getState().cancelArmed) useVoice.setState({ cancelArmed: armed });
      };
      const done = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', done);
        window.removeEventListener('pointercancel', done);
        if (ev.type === 'pointercancel' || useVoice.getState().cancelArmed) return cancelVoice();
        if (Date.now() - at < TAP_MS) useVoice.setState({ handsFree: true });
        else stopVoice();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', done);
      window.addEventListener('pointercancel', done);
      void startVoice(false);
    },
  };
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** Hold Space to talk (tap for hands-free), ⌘J toggles the panel, Esc stops or closes. */
function useAssistantKeys() {
  useEffect(() => {
    let spaceAt = 0;
    const blocked = () => {
      const ui = useUI.getState();
      return (
        ui.paletteOpen ||
        ui.settingsOpen ||
        ui.shortcutsOpen ||
        ui.brainDumpOpen ||
        ui.scheduleOpen ||
        !!ui.reschedulePrompt ||
        !!document.querySelector('[role="dialog"]:not([data-assistant]),[role="menu"]')
      );
    };
    const onDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        const ui = useUI.getState();
        ui.set({ assistantOpen: !ui.assistantOpen });
        return;
      }
      if (e.key === 'Escape' && useVoice.getState().phase !== 'idle') {
        e.preventDefault();
        cancelVoice();
        return;
      }
      if (e.key === 'Escape' && useUI.getState().assistantOpen && !isTyping(e) && !blocked()) {
        useUI.getState().set({ assistantOpen: false });
        return;
      }
      if (e.code !== 'Space' || mod || e.altKey || isTyping(e) || blocked()) return;
      e.preventDefault();
      if (e.repeat) return;
      const v = useVoice.getState();
      if (v.phase === 'listening' && v.handsFree) return stopVoice();
      if (v.phase !== 'idle') return;
      spaceAt = Date.now();
      void startVoice(false);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceAt) return;
      e.preventDefault();
      const quick = Date.now() - spaceAt < TAP_MS;
      spaceAt = 0;
      if (quick) useVoice.setState({ handsFree: true });
      else stopVoice();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);
}

// --- UI ---------------------------------------------------------------------------------------

export function AssistantDock({ offsetRight = 0 }: { offsetRight?: number }) {
  const open = useUI((s) => s.assistantOpen);
  useAssistantKeys();
  return (
    <>
      <AnimatePresence>{open ? <Panel key="panel" offsetRight={offsetRight} /> : null}</AnimatePresence>
      {!open && <MicFab offsetRight={offsetRight} />}
    </>
  );
}

function MicFab({ offsetRight }: { offsetRight: number }) {
  const press = usePressToTalk();
  const phase = useVoice((s) => s.phase);
  return (
    <Tooltip label={`${t('agent.hold')} · Space`} side="left">
      <motion.button
        type="button"
        aria-label={t('agent.hold')}
        data-testid="assistant-mic"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileTap={{ scale: 0.94 }}
        style={{ right: 20 + offsetRight }}
        className={cx(
          'fixed bottom-[calc(20px+env(safe-area-inset-bottom))] z-[25] grid size-14 touch-none select-none place-items-center rounded-full bg-jade text-jade-ink shadow-float',
          phase !== 'idle' && 'ring-4 ring-jade/30',
        )}
        {...press}
      >
        <Mic className="size-6" strokeWidth={2.2} />
      </motion.button>
    </Tooltip>
  );
}

function Panel({ offsetRight }: { offsetRight: number }) {
  const state = useAssistant();
  const ai = useSyncStore((s) => s.ai);
  const config = useSyncStore((s) => s.config);
  const voice = useVoice();
  const scroller = useRef<HTMLDivElement>(null);
  const available = !!config && ai?.available !== false;

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new content
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state, voice.partial]);

  return (
    <motion.section
      role="dialog"
      data-assistant
      aria-label={t('agent.title')}
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 460, damping: 36 }}
      style={{ right: 16 + offsetRight }}
      className="fixed bottom-[calc(16px+env(safe-area-inset-bottom))] z-[60] flex max-h-[min(640px,calc(100dvh-32px))] w-[min(420px,calc(100vw-16px))] max-sm:!right-2 flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-float"
    >
      <header className="flex items-center gap-1 border-b border-line py-2 pl-4 pr-2">
        <h2 className="font-display text-[15px] font-semibold">{t('agent.title')}</h2>
        <div className="ml-auto flex items-center">
          {state.turns.length > 0 && (
            <button
              type="button"
              aria-label={t('agent.new')}
              title={t('agent.new')}
              onClick={() => getAssistant().forget()}
              className="grid size-8 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink"
            >
              <RotateCcw className="size-4" />
            </button>
          )}
          <button
            type="button"
            aria-label={t('task.close')}
            onClick={() => {
              cancelVoice();
              useUI.getState().set({ assistantOpen: false });
            }}
            className="grid size-8 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      <div ref={scroller} className="min-h-[120px] flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {!available ? (
          <p className="py-6 text-center text-[13px] text-ink-3">{t('agent.unavailable')}</p>
        ) : state.turns.length === 0 && voice.phase === 'idle' ? (
          <p className="py-4 text-[13px] leading-relaxed text-ink-3">{t('agent.examples')}</p>
        ) : null}
        <div className="flex flex-col gap-4">
          {state.turns.map((turn, i) => (
            <Turn key={turn.id} turn={turn} last={i === state.turns.length - 1} />
          ))}
          {voice.phase === 'listening' && !voice.partial && <Halo level={voice.level} />}
          {voice.phase !== 'idle' && voice.partial && (
            <p className="ml-auto max-w-[85%] rounded-[12px] rounded-br-[4px] bg-hover px-3 py-2 text-[14px] text-ink-2">
              {voice.partial}
            </p>
          )}
        </div>
        {voice.error && <p className="mt-3 text-[12.5px] text-p1">{voice.error}</p>}
      </div>

      <Composer disabled={!available} />
    </motion.section>
  );
}

function Composer({ disabled }: { disabled: boolean }) {
  const voice = useVoice();
  const busy = useAssistant().busy;
  const press = usePressToTalk();
  const [text, setText] = useState('');
  const send = () => {
    const s = text.trim();
    if (!s) return;
    setText('');
    void getAssistant().say(s);
  };

  if (voice.phase !== 'idle') {
    return (
      <footer className="flex items-center gap-3 border-t border-line px-4 py-3">
        <Bars level={voice.level} active={voice.phase === 'listening'} />
        <span className={cx('min-w-0 flex-1 text-[13px]', voice.cancelArmed ? 'text-p1' : 'text-ink-3')}>
          {voice.phase === 'transcribing'
            ? t('agent.transcribing')
            : voice.cancelArmed
              ? t('agent.releaseCancel')
              : voice.handsFree
                ? t('agent.listening')
                : t('agent.release')}
        </span>
        <button
          type="button"
          aria-label={t('agent.stop')}
          onClick={stopVoice}
          className="grid size-10 place-items-center rounded-full bg-jade text-jade-ink"
        >
          <Square className="size-4" fill="currentColor" />
        </button>
      </footer>
    );
  }

  return (
    <footer className="flex items-end gap-2 border-t border-line p-2.5">
      <textarea
        rows={1}
        value={text}
        disabled={disabled}
        placeholder={t('agent.placeholder')}
        aria-label={t('agent.placeholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            useUI.getState().set({ assistantOpen: false });
          }
        }}
        className="max-h-32 min-h-10 flex-1 resize-none rounded-[10px] bg-hover px-3 py-2.5 text-[14px] outline-none placeholder:text-ink-3 focus:bg-active"
      />
      {text.trim() ? (
        <button
          type="button"
          aria-label={t('agent.send')}
          onClick={send}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-jade text-jade-ink"
        >
          <ArrowUp className="size-5" />
        </button>
      ) : (
        <button
          type="button"
          aria-label={t('agent.hold')}
          title={`${t('agent.hold')} · Space`}
          disabled={disabled}
          className={cx(
            'grid size-10 shrink-0 touch-none select-none place-items-center rounded-full bg-jade text-jade-ink disabled:opacity-40',
            busy && 'opacity-80',
          )}
          {...press}
        >
          <Mic className="size-5" />
        </button>
      )}
    </footer>
  );
}

/** Big mic that breathes with the voice level while nothing has been recognized yet. */
function Halo({ level }: { level: number }) {
  return (
    <div className="flex flex-col items-center gap-3 py-5" aria-hidden>
      <div className="relative grid size-20 place-items-center">
        <motion.span
          className="absolute inset-0 rounded-full bg-jade/15"
          animate={{ scale: 1 + Math.min(level, 1) * 0.6 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        />
        <motion.span
          className="absolute inset-0 rounded-full border border-jade/30"
          animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
          transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: 'easeOut' }}
        />
        <span className="relative grid size-14 place-items-center rounded-full bg-jade text-jade-ink shadow-float">
          <Mic className="size-6" strokeWidth={2.2} />
        </span>
      </div>
      <span className="text-[13px] text-ink-3">{t('agent.listening')}</span>
    </div>
  );
}

function Bars({ level, active }: { level: number; active: boolean }) {
  const shape = [
    ['a', 0.5],
    ['b', 0.8],
    ['c', 1],
    ['d', 0.75],
    ['e', 0.45],
  ] as const;
  return (
    <span className="flex h-6 items-center gap-[3px]" aria-hidden>
      {shape.map(([key, k]) => (
        <motion.span
          key={key}
          className="w-[3px] rounded-full bg-jade"
          animate={{ height: active ? 4 + Math.max(0.15, level) * 20 * k : 4 }}
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
        />
      ))}
    </span>
  );
}

const TOOL_LABEL: Record<string, [string, string]> = {
  'get-overview': ['看清单', 'reading the list'],
  'find-tasks': ['查找任务', 'looking up tasks'],
  'find-tasks-by-date': ['查日程', 'checking dates'],
  'add-tasks': ['添加', 'adding'],
  'update-tasks': ['修改', 'editing'],
  'complete-tasks': ['完成', 'completing'],
  'reschedule-tasks': ['改期', 'rescheduling'],
  'delete-tasks': ['删除', 'deleting'],
  'create-project': ['新建项目', 'creating a project'],
  'undo-last-change': ['撤销', 'undoing'],
};

function Turn({ turn, last }: { turn: AssistantTurn; last: boolean }) {
  const today = useToday();
  const zh = getLocale() === 'zh';
  const lines = describeChanges(turn.changes, getReplica().store, today);
  const tool = turn.tools.at(-1);
  return (
    <div className="flex flex-col gap-2">
      <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-[12px] rounded-br-[4px] bg-hover px-3 py-2 text-[14px]">
        {turn.heard}
      </p>
      {turn.status === 'thinking' && !turn.reply && (
        <p className="flex items-center gap-2 text-[13px] text-ink-3">
          <Loader2 className="size-3.5 animate-spin" />
          {tool ? (TOOL_LABEL[tool]?.[zh ? 0 : 1] ?? tool) : t('agent.thinking')}
        </p>
      )}
      {turn.reply && <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{turn.reply}</p>}
      {lines.length > 0 && <Changes turn={turn} lines={lines} last={last} />}
      {turn.answer && (
        <p className="ml-auto max-w-[85%] rounded-[12px] rounded-br-[4px] bg-hover px-3 py-2 text-[14px]">
          {turn.answer}
        </p>
      )}
      {turn.status === 'error' && (
        <p className="flex items-center gap-2 text-[13px] text-p1">
          <span className="min-w-0 flex-1">{t('ai.unavailable', { message: turn.error ?? '' })}</span>
          {last && (
            <button
              type="button"
              onClick={() => void getAssistant().say(turn.heard)}
              className="rounded-[6px] px-2 py-0.5 font-medium text-ink-2 hover:bg-hover"
            >
              {t('agent.retry')}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

const BADGE: Record<ChangeLine['kind'], string> = {
  added: 'text-jade',
  completed: 'text-jade',
  reopened: 'text-ink-2',
  restored: 'text-ink-2',
  updated: 'text-ink-2',
  deleted: 'text-p1',
};

function Changes({ turn, lines, last }: { turn: AssistantTurn; lines: ChangeLine[]; last: boolean }) {
  const pending = turn.status === 'pending';
  const gone = turn.status === 'undone' || turn.status === 'cancelled';
  return (
    <div
      data-testid="assistant-changes"
      className={cx(
        'rounded-[10px] border px-3 py-2',
        pending ? 'border-dashed border-jade-line bg-jade-soft/50' : 'border-line',
        gone && 'opacity-55',
      )}
    >
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l.key} className="flex min-w-0 items-baseline gap-2 text-[13px]">
            <span className={cx('shrink-0 text-[11.5px] font-semibold', BADGE[l.kind])}>
              {l.entity === 'task' ? t(`change.${l.kind}` as MessageKey) : '+'}
            </span>
            <button
              type="button"
              disabled={!l.taskId || l.kind === 'deleted' || gone}
              onClick={() => l.taskId && useUI.getState().openDetail(l.taskId)}
              className={cx(
                'min-w-0 text-left',
                gone && 'line-through',
                l.taskId && !gone && l.kind !== 'deleted' && 'hover:underline',
              )}
            >
              <span className="font-medium">{l.title}</span>
              {l.detail && <span className="ml-1.5 text-ink-3">{l.detail}</span>}
            </button>
          </li>
        ))}
      </ul>
      {(pending || (turn.status === 'applied' && last) || gone) && (
        <div className="mt-2 flex items-center gap-2 border-t border-line/70 pt-2 text-[12.5px]">
          {pending ? (
            <>
              <span className="min-w-0 flex-1 text-ink-3">{t('agent.pending')}</span>
              <button
                type="button"
                onClick={() => getAssistant().cancel()}
                className="h-7 rounded-[7px] px-2.5 font-medium text-ink-2 hover:bg-hover"
              >
                {t('agent.cancel')}
              </button>
              <button
                type="button"
                onClick={() => getAssistant().confirm()}
                className="h-7 rounded-[7px] bg-jade px-3 font-semibold text-jade-ink"
              >
                {t('agent.confirm')}
              </button>
            </>
          ) : gone ? (
            <span className="text-ink-3">
              {turn.status === 'undone' ? t('agent.undone') : t('agent.cancelled')}
            </span>
          ) : (
            <>
              <span className="min-w-0 flex-1" />
              <button
                type="button"
                onClick={() => getAssistant().undo(turn.id)}
                className="h-7 rounded-[7px] px-2.5 font-medium text-ink-2 hover:bg-hover"
              >
                {t('agent.undo')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
