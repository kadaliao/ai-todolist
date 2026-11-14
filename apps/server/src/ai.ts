import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { AGENT_TOOLS, type AgentContext, type AgentMessage, type ModelEvent } from '@ai-todo/core';
import { type LanguageModel, type ModelMessage, Output, streamText, type ToolSet, tool } from 'ai';
import { z } from 'zod';

/**
 * AI features behind the server (keys never reach devices). Any OpenAI-compatible endpoint works:
 * aihubmix, OpenRouter, DeepSeek, a local Ollama, …
 *
 * The model is told never to compute dates. It returns the time *phrase* it found, and the app's
 * deterministic quick-add parser turns that into a date, so a model can't hallucinate one.
 */

export interface AiConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  structuredOutputs: boolean;
}

export interface SttConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface AiContext {
  today: string;
  timeZone: string;
  locale?: string;
  projects: string[];
  labels: string[];
}

const extractedTask = z.object({
  title: z
    .string()
    .describe('Short imperative task title, same language as the input, without date/time words'),
  when: z
    .string()
    .nullable()
    .describe(
      'Date/time/recurrence wording copied from the input (e.g. "明天下午3点", "每周一", "next fri"), or null',
    ),
  project: z.string().nullable().describe('Exact name of an existing project, or null'),
  labels: z.array(z.string()).describe('Names of existing labels; empty if none apply'),
  priority: z.number().int().min(1).max(4).nullable().describe('1 urgent … 3 minor; null if not indicated'),
  notes: z.string().nullable().describe('Extra details worth keeping, or null'),
});

export type ExtractedTask = {
  title: string;
  when?: string;
  project?: string;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
  notes?: string;
};

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekday(date: string): { zh: string; en: string } {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { zh: `周${WEEKDAYS_ZH[d]}`, en: WEEKDAYS_EN[d] ?? '' };
}

export function extractPrompt(ctx: AiContext): string {
  const wd = weekday(ctx.today);
  return [
    'You turn a person’s free-form note (typed or dictated, often Chinese) into to-do tasks for their task manager.',
    '',
    'Rules:',
    '- One task per distinct action, in the order mentioned. Skip feelings, chit-chat and background that is not an action. Never invent tasks.',
    '- title: a short imperative phrase in the same language as the note, without the date/time words. Keep names, numbers and objects (“给张三发合同”, “Pay rent”).',
    '- when: copy the date/time/recurrence wording for that task from the note, minimally normalized so a parser can read it: “明天下午三点”, “下周五” (for “下周五之前/前”), “每周一”, “每天早上8点”, “tomorrow 3pm”, “every Monday”. Never convert to calendar dates yourself. null if no time is mentioned for that task.',
    `- project: only if the note clearly refers to one of these existing projects: ${ctx.projects.length ? ctx.projects.map((p) => `“${p}”`).join(', ') : '(none)'}. Use the exact name; otherwise null.`,
    `- labels: only from these existing labels: ${ctx.labels.length ? ctx.labels.map((l) => `“${l}”`).join(', ') : '(none)'}; otherwise [].`,
    '- priority: 1 if explicitly urgent/most important, 2 if important, 3 if minor; null when not indicated.',
    '- notes: details worth keeping that don’t fit in the title (phone numbers, links, amounts); otherwise null.',
    '',
    `Context: today is ${ctx.today} (${wd.en}, ${wd.zh}), time zone ${ctx.timeZone}.`,
    '',
    'Reply with JSON only: {"elements": [{"title": string, "when": string|null, "project": string|null, "labels": string[], "priority": 1|2|3|4|null, "notes": string|null}]}. Use {"elements": []} when there is nothing to do.',
  ].join('\n');
}

export function breakdownPrompt(ctx: AiContext, existing: string[]): string {
  return [
    'Break the user’s task into concrete next steps they can check off one by one.',
    '- 3 to 7 steps; for a small task, 2–3 at most. Never pad with generic steps like “review” or “finish”.',
    '- Same language as the task. Short imperative phrases. No numbering, no dates, no explanations.',
    existing.length
      ? `- These subtasks already exist; don’t repeat them: ${existing.map((e) => `“${e}”`).join(', ')}.`
      : '',
    `Context: today is ${ctx.today}.`,
    'Reply with JSON only: {"elements": [{"title": string}]}.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** streamText reports failures via onError and just ends the stream; surface them instead. */
async function* elements<T>(
  start: (onError: (e: { error: unknown }) => void) => { elementStream: AsyncIterable<unknown> },
): AsyncGenerator<T> {
  let failure: unknown = null;
  const result = start(({ error }) => {
    failure = error;
  });
  for await (const el of result.elementStream) yield el as T;
  if (failure) throw failure;
}

export class Ai {
  private readonly provider;

  /** `model` overrides the provider's (tests). */
  constructor(
    readonly config: AiConfig,
    private readonly override?: LanguageModel,
  ) {
    this.provider = createOpenAICompatible({
      name: 'docket',
      baseURL: config.baseURL.replace(/\/+$/, ''),
      apiKey: config.apiKey,
      supportsStructuredOutputs: config.structuredOutputs,
    });
  }

  get model(): string {
    return this.config.model;
  }

  private chat(): LanguageModel {
    return this.override ?? this.provider.chatModel(this.config.model);
  }

  async *extract(text: string, ctx: AiContext, signal?: AbortSignal): AsyncGenerator<ExtractedTask> {
    const stream = elements<z.infer<typeof extractedTask>>((onError) =>
      streamText({
        model: this.chat(),
        system: extractPrompt(ctx),
        prompt: text.slice(0, 20_000),
        output: Output.array({ element: extractedTask }),
        temperature: 0.1,
        maxRetries: 1,
        abortSignal: signal,
        onError,
      }),
    );
    for await (const t of stream) {
      if (!t.title?.trim()) continue;
      yield {
        title: t.title.trim(),
        ...(t.when ? { when: t.when } : {}),
        ...(t.project ? { project: t.project } : {}),
        ...(t.labels?.length ? { labels: t.labels } : {}),
        ...(t.priority ? { priority: t.priority as 1 | 2 | 3 | 4 } : {}),
        ...(t.notes ? { notes: t.notes } : {}),
      };
    }
  }

  async *breakdown(
    task: { title: string; notes: string; existing: string[] },
    ctx: AiContext,
    signal?: AbortSignal,
  ): AsyncGenerator<{ title: string }> {
    const stream = elements<{ title: string }>((onError) =>
      streamText({
        model: this.chat(),
        system: breakdownPrompt(ctx, task.existing),
        prompt: task.notes ? `${task.title}\n\n${task.notes.slice(0, 4000)}` : task.title,
        output: Output.array({ element: z.object({ title: z.string() }) }),
        temperature: 0.3,
        maxRetries: 1,
        abortSignal: signal,
        onError,
      }),
    );
    for await (const el of stream) {
      const title = el.title?.trim();
      if (title) yield { title };
    }
  }

  /**
   * One step of the in-app assistant: the model sees the conversation and the user's list, and
   * answers with text and/or tool calls. Tools have no `execute` here: the device runs them on
   * its own replica and sends the results back with the next request.
   */
  async *agentStep(
    messages: AgentMessage[],
    ctx: AgentContext,
    toolNames: string[],
    signal?: AbortSignal,
  ): AsyncGenerator<ModelEvent> {
    const tools: ToolSet = {};
    for (const t of AGENT_TOOLS) {
      if (toolNames.includes(t.name))
        tools[t.name] = tool({ description: t.description, inputSchema: t.schema });
    }
    let failure: unknown = null;
    const result = streamText({
      model: this.chat(),
      system: agentPrompt(ctx),
      messages: toModelMessages(messages),
      tools,
      temperature: 0.2,
      maxRetries: 1,
      abortSignal: signal,
      onError: ({ error }) => {
        failure = error;
      },
    });
    for await (const part of result.stream) {
      if (part.type === 'text-delta' && part.text) yield { type: 'text', text: part.text };
      else if (part.type === 'tool-call') {
        yield { type: 'call', call: { id: part.toolCallId, name: part.toolName, input: part.input } };
      }
    }
    if (failure) throw failure;
  }
}

function toModelMessages(messages: AgentMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: [
          ...(m.text ? [{ type: 'text' as const, text: m.text }] : []),
          ...(m.calls ?? []).map((c) => ({
            type: 'tool-call' as const,
            toolCallId: c.id,
            toolName: c.name,
            input: c.input,
          })),
        ],
      };
    }
    return {
      role: 'tool',
      content: m.results.map((r) => ({
        type: 'tool-result' as const,
        toolCallId: r.id,
        toolName: r.name,
        output: r.error
          ? { type: 'error-text' as const, value: String(r.output) }
          : { type: 'json' as const, value: (r.output ?? null) as never },
      })),
    };
  });
}

export function agentPrompt(ctx: AgentContext): string {
  const wd = weekday(ctx.today);
  const { today, weekday: _w, now, timeZone, locale, ...lists } = ctx;
  return [
    'You are the assistant inside Docket, a to-do app. The user talks to you, usually by voice and often in Chinese, and you operate their task list with the tools.',
    '',
    'How to work:',
    '- Do what was asked with the tools; don’t just describe it. A request may need several changes: make all the calls.',
    '- The input is a speech transcript and may contain recognition errors (homophones, wrong characters, no punctuation). Match tasks, projects and labels by meaning and sound (“粥报” → “周报”). If one task clearly matches, act on it; ask only when several plausibly match or none does.',
    '- The lists below show overdue, today’s, the next 7 days’ and undated Inbox tasks with their ids (t1, t2…). Use those ids. For anything else call find-tasks first, with a short keyword.',
    '- “这个 / this / it” means the focused task, when there is one.',
    '- New things to do → add-tasks, one call for all of them. Copy the date/time wording into `when` (“明天下午三点”, “下周五”, “每周一”); never compute dates yourself. Tasks with a time remind at that time automatically.',
    '- Finished → complete-tasks. Postpone or move to a day → reschedule-tasks. Other edits → update-tasks. Delete only when the user asks to delete or drop a task.',
    '- Breaking a task into steps → add-tasks with parentId. Undo requests (“撤销”, “刚才那个不对”) → undo-last-change.',
    '- Questions about the list (“今天还有什么”) → answer from the lists or read tools without changing anything.',
    '- The app holds big changes (deleting, completing or editing many tasks) for the user’s confirmation. When a tool result says so, say what will change and ask.',
    '- Never add tasks the user didn’t ask for. Don’t create projects or labels unless asked.',
    '- The app’s words: Inbox = 收件箱, trash = 回收站, project = 项目, label = 标签, subtask = 子任务.',
    '',
    'Reply after the tools in the user’s language, in one short spoken-style sentence: what you did, or the answer. It may be read aloud, so no markdown, lists, ids or dates in YYYY-MM-DD; the app shows the details. If you must ask, ask one short question.',
    '',
    `Now: ${today} (${wd.en}, ${wd.zh}) ${now}, time zone ${timeZone}, locale ${locale}.`,
    `The user’s list when they spoke (tool results show what changed since): ${JSON.stringify(lists)}`,
  ].join('\n');
}
