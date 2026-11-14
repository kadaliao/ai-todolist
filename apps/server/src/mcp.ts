import { AGENT_TOOLS, AgentSession, executeTool, type ToolEnv } from '@ai-todo/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Hub } from './hub';

/**
 * MCP server exposing the task list to external agents (Claude Code, Claude Desktop, …).
 *
 * The tools are the same ones the in-app assistant uses (`core/src/agent/tools.ts`). Here each
 * call applies right away as one transaction tagged `mcp`, syncs to all devices, and can be
 * undone (`undo-last-change`). Unknown projects and labels are created; agents can only trash
 * tasks that an agent created, and there is no hard delete.
 */

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

const DESCRIPTIONS: Record<string, string> = {
  'undo-last-change':
    'Revert the most recent change made through this MCP server (keeps later edits made in the apps).',
  'delete-tasks':
    'Move tasks to the trash. Only tasks created by an agent (MCP or AI) can be deleted this way.',
};

export function createMcpServer(hub: Hub): McpServer {
  const server = new McpServer({ name: 'docket', version: '1.1.0' }, { capabilities: { tools: {} } });

  for (const tool of AGENT_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: DESCRIPTIONS[tool.name] ?? tool.description,
        inputSchema: tool.shape,
        annotations: {
          ...(tool.readOnly ? { readOnlyHint: true } : {}),
          ...(tool.destructive ? { destructiveHint: true } : {}),
        },
      },
      async (input: unknown) => {
        const session = new AgentSession(hub.replica, 'mcp');
        const ctx = session.context();
        const env: ToolEnv = {
          store: session.store,
          now: ctx.now,
          today: ctx.today,
          timeZone: ctx.timeZone,
          policy: { createMissing: true, deleteOnlyAgentMade: true },
          run: (cmd) => session.run(cmd),
          newId: ctx.newId,
          ref: (id) => id,
          resolve: (id) => (session.store.get('task', id) ? id : undefined),
          undoLast: () => hub.revert(),
        };
        const r = executeTool(env, tool.name, input, [tool]);
        if (r.error) return fail(String(r.output));
        session.commit(`mcp: ${tool.name}`, (cmd) => hub.dispatch(cmd, 'mcp'));
        const out = r.output as Record<string, unknown>;
        return ok(
          tool.name === 'add-tasks' ? { ...out, undo: 'Call undo-last-change to revert this.' } : out,
        );
      },
    );
  }

  return server;
}
