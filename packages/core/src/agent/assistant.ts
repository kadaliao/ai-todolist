import { sortByOrder } from '../order';
import type { ReadStore } from '../overlay';
import type { Replica } from '../replica';
import { addDays, isoWeekday, wallClock } from '../time';
import { inbox as inboxView, subtasks, today as todayView, upcoming } from '../views';
import { AgentSession, type Change } from './session';
import { AGENT_TOOLS, briefTask, executeTool, type TaskBrief, type ToolEnv } from './tools';

/**
 * The in-app assistant: you say something, it operates the list.
 *
 * The model runs on the server (keys stay there); tools run here, on the device's own replica,
 * so the agent sees exactly what you see, offline edits included. A turn's edits are staged and
 * then either applied as one undoable transaction or, for big changes (deleting, completing or
 * editing many tasks), held until you say yes.
 */

// --- wire protocol (shared with apps/server) -------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  name: string;
  output: unknown;
  error?: true;
}

export type AgentMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls?: ToolCall[] }
  | { role: 'tool'; results: ToolResult[] };

export type ModelEvent =
  | { type: 'text'; text: string }
  | { type: 'call'; call: ToolCall }
  | { type: 'error'; error: string };

export interface AgentContext {
  today: string;
  weekday: number;
  now: string;
  timeZone: string;
  locale: string;
  projects: { name: string; group?: string; sections?: string[] }[];
  labels: string[];
  overdue: TaskBrief[];
  todayTasks: TaskBrief[];
  upcoming: TaskBrief[];
  inbox: TaskBrief[];
  /** The task on screen, so "this" / "这个" resolves. */
  focus?: TaskBrief & { subtasks?: TaskBrief[] };
  /** What list is on screen, e.g. "project 工作". */
  view?: string;
}

export interface AgentRequest {
  messages: AgentMessage[];
  context: AgentContext;
  tools: string[];
}

/** One model step: stream text and tool calls for the given conversation. */
export type AgentTransport = (req: AgentRequest, signal: AbortSignal) => AsyncIterable<ModelEvent>;

// --- short task handles ----------------------------------------------------------------------

/** UUIDs are long and easy for a model to garble; it sees `t1`, `t2`, … instead. */
export class TaskRefs {
  private toRef = new Map<string, string>();
  private toId = new Map<string, string>();

  ref(id: string): string {
    let r = this.toRef.get(id);
    if (!r) {
      r = `t${this.toRef.size + 1}`;
      this.toRef.set(id, r);
      this.toId.set(r, id);
    }
    return r;
  }

  resolve(ref: string, store: ReadStore): string | undefined {
    const key = ref.trim();
    const id = this.toId.get(key.toLowerCase());
    if (id) return id;
    return store.get('task', key) ? key : undefined;
  }

  clear(): void {
    this.toRef.clear();
    this.toId.clear();
  }
}

// --- context ---------------------------------------------------------------------------------

export function agentContext(
  store: ReadStore,
  opts: {
    now: Date;
    today: string;
    timeZone: string;
    locale: string;
    refs: TaskRefs;
    focusTaskId?: string | null;
    view?: string;
  },
): AgentContext {
  const b = (t: Parameters<typeof briefTask>[1]) => briefTask(store, t, (id) => opts.refs.ref(id));
  const td = todayView(store, opts.today);
  const soon = upcoming(store, addDays(opts.today, 1), 7).flatMap((d) => d.tasks);
  const projects = store.all('project').filter((p) => !p.deletedAt && !p.archivedAt);
  const sections = store.all('section').filter((s) => !s.deletedAt);
  const focus = opts.focusTaskId ? store.get('task', opts.focusTaskId) : undefined;
  return {
    today: opts.today,
    weekday: isoWeekday(opts.today),
    now: wallClock(opts.now, opts.timeZone).time,
    timeZone: opts.timeZone,
    locale: opts.locale,
    projects: sortByOrder(projects).map((p) => {
      const secs = sortByOrder(sections.filter((s) => s.projectId === p.id)).map((s) => s.name);
      const group = p.parentId ? projects.find((x) => x.id === p.parentId)?.name : undefined;
      return { name: p.name, ...(group ? { group } : {}), ...(secs.length ? { sections: secs } : {}) };
    }),
    labels: sortByOrder(store.all('label').filter((l) => !l.deletedAt)).map((l) => l.name),
    overdue: td.overdue.slice(0, 40).map(b),
    todayTasks: td.today.slice(0, 60).map(b),
    upcoming: soon.slice(0, 40).map(b),
    inbox: inboxView(store)
      .filter((t) => !t.scheduled)
      .slice(0, 30)
      .map(b),
    ...(focus && !focus.deletedAt
      ? { focus: { ...b(focus), subtasks: subtasks(store, focus.id, false).slice(0, 30).map(b) } }
      : {}),
    ...(opts.view ? { view: opts.view } : {}),
  };
}

// --- the assistant ---------------------------------------------------------------------------

export type TurnStatus = 'thinking' | 'answered' | 'applied' | 'pending' | 'cancelled' | 'undone' | 'error';

export interface AssistantTurn {
  id: number;
  heard: string;
  reply: string;
  /** Tools called so far, in order. */
  tools: string[];
  changes: Change[];
  status: TurnStatus;
  tx: string | null;
  error?: string;
  /** What the user said to confirm or cancel this turn's proposal (“好”, “算了”). */
  answer?: string;
}

export interface AssistantState {
  turns: AssistantTurn[];
  busy: boolean;
}

export interface AssistantOptions {
  replica: Replica;
  transport: AgentTransport;
  locale: () => string;
  /** What is on screen. */
  focus?: () => { taskId?: string | null; view?: string };
  maxSteps?: number;
  /** The conversation is forgotten after this much quiet (default 10 minutes). */
  idleMs?: number;
  now?: () => number;
}

const AFFIRM =
  /^(?:好|好的|好啊|好吧|好滴|行|行吧|可以|确认|确定|没问题|对|对的|是|是的|嗯|嗯嗯|执行|就这样|改吧|删吧|ok|okay|yes|yep|yeah|sure|confirm|do it|go ahead)[了吧啦呀啊哦\s。.!！,，~～]*$/i;
const DENY =
  /^(?:不|不要|不用|不行|别|别了|取消|算了|不对|错了|no|nope|cancel|stop|never ?mind)[了吧啦呀啊哦\s。.!！,，~～]*$/i;

export const isAffirmative = (text: string) => AFFIRM.test(text.trim());
export const isNegative = (text: string) => DENY.test(text.trim());

const MAX_TURNS_SHOWN = 20;
/** Conversation turns kept for the model (older ones are dropped). */
const MAX_TURNS_SENT = 6;

export class AssistantError extends Error {}

export class Assistant {
  private turns: AssistantTurn[] = [];
  private transcript: AgentMessage[] = [];
  private readonly refs = new TaskRefs();
  private session: AgentSession;
  private ctl: AbortController | null = null;
  private listeners = new Set<(s: AssistantState) => void>();
  private state: AssistantState = { turns: [], busy: false };
  private seq = 0;
  private lastActive = 0;
  /** Said to the model with the next message (e.g. "the user cancelled your proposal"). */
  private notes: string[] = [];
  private readonly now: () => number;

  constructor(private readonly opts: AssistantOptions) {
    this.session = new AgentSession(opts.replica, 'ai');
    this.now = opts.now ?? Date.now;
  }

  getState(): AssistantState {
    return this.state;
  }

  subscribe(fn: (s: AssistantState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The turn waiting for a yes/no, if any. */
  pending(): AssistantTurn | undefined {
    const last = this.turns.at(-1);
    return last?.status === 'pending' ? last : undefined;
  }

  /** Handle one utterance (spoken or typed). Resolves when the turn is finished. */
  async say(input: string): Promise<void> {
    const text = input.trim();
    if (!text) return;
    this.abort();
    if (this.lastActive && this.now() - this.lastActive > (this.opts.idleMs ?? 10 * 60_000)) this.forget();
    this.lastActive = this.now();

    const pending = this.pending();
    if (pending) {
      if (isAffirmative(text)) {
        pending.answer = text;
        return void this.confirm();
      }
      if (isNegative(text)) {
        pending.answer = text;
        return void this.cancel();
      }
      // Anything else amends the proposal: drop it and let the model redo it with the correction.
      this.session.discard();
      pending.status = 'cancelled';
      pending.changes = [];
      this.notes.push('Your previous proposal was NOT applied; the user replied with a correction.');
    }

    const turn: AssistantTurn = {
      id: ++this.seq,
      heard: text,
      reply: '',
      tools: [],
      changes: [],
      status: 'thinking',
      tx: null,
    };
    this.turns.push(turn);
    if (this.turns.length > MAX_TURNS_SHOWN) this.turns.shift();
    const note = this.notes.length ? `[${this.notes.join(' ')}]\n` : '';
    this.notes = [];
    this.transcript.push({ role: 'user', text: note + text });
    this.trim();

    const ctl = new AbortController();
    this.ctl = ctl;
    this.emit(true);
    try {
      await this.runSteps(turn, ctl.signal);
      if (ctl.signal.aborted) return;
      turn.changes = this.session.changes();
      if (!turn.changes.length) {
        this.session.discard();
        turn.status = 'answered';
      } else if (this.session.needsConfirmation()) {
        turn.status = 'pending';
      } else {
        turn.tx = this.session.commit(`assistant: ${text.slice(0, 40)}`);
        turn.status = 'applied';
      }
    } catch (e) {
      if (ctl.signal.aborted) return;
      this.session.discard();
      turn.status = 'error';
      turn.changes = [];
      turn.error = e instanceof Error ? e.message : String(e);
      // Keep the transcript well-formed: the failed exchange is dropped.
      const at = lastUserIndex(this.transcript);
      if (at >= 0) this.transcript.splice(at);
    } finally {
      if (this.ctl === ctl) this.ctl = null;
      this.emit(false);
    }
  }

  private async runSteps(turn: AssistantTurn, signal: AbortSignal): Promise<void> {
    const steps = this.opts.maxSteps ?? 8;
    const allowed = AGENT_TOOLS;
    // The list as it was when the user spoke. Re-reading it after each step would show the
    // model its own staged edits as if they had always been there, which confuses it.
    const context = this.context();
    for (let step = 0; step < steps; step++) {
      const calls: ToolCall[] = [];
      let text = '';
      const before = turn.reply;
      const req: AgentRequest = {
        messages: this.transcript,
        context,
        tools: allowed.map((t) => t.name),
      };
      for await (const ev of this.opts.transport(req, signal)) {
        if (signal.aborted) return;
        if (ev.type === 'text') {
          text += ev.text;
          turn.reply = before ? `${before}\n${text}` : text;
          this.emit(true);
        } else if (ev.type === 'call') calls.push(ev.call);
        else throw new AssistantError(ev.error);
      }
      if (signal.aborted) return;
      this.transcript.push({ role: 'assistant', text, ...(calls.length ? { calls } : {}) });
      if (!calls.length) return;
      const results: ToolResult[] = calls.map((call) => {
        turn.tools.push(call.name);
        const point = this.session.checkpoint();
        const r = executeTool(this.env(), call.name, call.input, allowed);
        if (r.error) this.session.rollback(point);
        let output = r.output;
        const tool = allowed.find((t) => t.name === call.name);
        if (!r.error && tool && !tool.readOnly && this.session.needsConfirmation()) {
          output = {
            ...(output as object),
            confirmation:
              'Big change: NOTHING has been applied yet; it applies only after the user confirms. Phrase your reply as a question about what will change, e.g. “要删掉“买牛奶”吗？” or “要把这 5 件事挪到周四吗？”. Never say it is already done.',
          };
        }
        return { id: call.id, name: call.name, output, ...(r.error ? { error: true as const } : {}) };
      });
      this.transcript.push({ role: 'tool', results });
      turn.changes = this.session.changes();
      this.emit(true);
    }
  }

  private env(): ToolEnv {
    const { replica } = this.opts;
    const session = this.session;
    const ctx = session.context();
    return {
      store: session.store,
      now: ctx.now,
      today: ctx.today,
      timeZone: ctx.timeZone,
      policy: { createMissing: false, deleteOnlyAgentMade: false },
      run: (cmd) => session.run(cmd),
      newId: () => ctx.newId(),
      ref: (id) => this.refs.ref(id),
      resolve: (ref) => this.refs.resolve(ref, session.store),
      undoLast: () => {
        const last = [...this.turns].reverse().find((t) => t.status === 'applied' && t.tx);
        if (!last?.tx) return false;
        replica.revert(last.tx);
        last.status = 'undone';
        return true;
      },
    };
  }

  private context(): AgentContext {
    const { replica } = this.opts;
    const focus = this.opts.focus?.() ?? {};
    const ctx = this.session.context();
    return agentContext(this.session.store, {
      now: ctx.now,
      today: ctx.today,
      timeZone: replica.timeZone,
      locale: this.opts.locale(),
      refs: this.refs,
      focusTaskId: focus.taskId ?? null,
      ...(focus.view ? { view: focus.view } : {}),
    });
  }

  /** Apply the pending proposal. */
  confirm(): void {
    const turn = this.pending();
    if (!turn) return;
    turn.tx = this.session.commit(`assistant: ${turn.heard.slice(0, 40)}`);
    turn.status = 'applied';
    this.notes.push('The user confirmed; your proposed changes were applied.');
    this.emit(false);
  }

  /** Drop the pending proposal. */
  cancel(): void {
    const turn = this.pending();
    if (!turn) return;
    this.session.discard();
    turn.status = 'cancelled';
    this.notes.push('The user cancelled; your proposed changes were NOT applied.');
    this.emit(false);
  }

  /** Revert an applied turn (default: the latest one). */
  undo(turnId?: number): boolean {
    const turn =
      turnId !== undefined
        ? this.turns.find((t) => t.id === turnId)
        : [...this.turns].reverse().find((t) => t.status === 'applied');
    if (!turn?.tx || turn.status !== 'applied') return false;
    this.opts.replica.revert(turn.tx);
    turn.status = 'undone';
    this.notes.push('The user undid your last changes.');
    this.emit(false);
    return true;
  }

  /** Stop the running turn; its staged edits are dropped. */
  abort(): void {
    if (!this.ctl) return;
    this.ctl.abort();
    this.ctl = null;
    this.session.discard();
    const turn = this.turns.at(-1);
    if (turn?.status === 'thinking') {
      turn.status = 'cancelled';
      turn.changes = [];
    }
    const at = lastUserIndex(this.transcript);
    if (at >= 0) this.transcript.splice(at);
    this.emit(false);
  }

  /** Start a new conversation. */
  forget(): void {
    this.abort();
    if (this.pending()) this.cancel();
    this.transcript = [];
    this.notes = [];
    this.refs.clear();
    this.turns = [];
    this.emit(false);
  }

  /** Keep the last few user turns so requests stay small. */
  private trim(): void {
    let users = 0;
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      if (this.transcript[i]?.role === 'user' && ++users > MAX_TURNS_SENT) {
        this.transcript = this.transcript.slice(i + 1);
        return;
      }
    }
  }

  private emit(busy: boolean): void {
    this.state = { turns: this.turns.map((t) => ({ ...t })), busy };
    for (const l of this.listeners) l(this.state);
  }
}

function lastUserIndex(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'user') return i;
  return -1;
}
