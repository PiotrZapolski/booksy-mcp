import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { join } from 'node:path';
import type { Bridge, BridgeStatus } from './bridge/server.js';
import type { Config } from './config.js';
import { SnapshotStore } from './domain/feed.js';
import { BooksyError } from './errors.js';
import { saveFile } from './exports/files.js';
import { Gateway } from './gateway/gateway.js';
import type { ToolContext, ToolDef } from './tools/define.js';
import { selectTools } from './tools/index.js';
import { Confirmations } from './writes/confirmations.js';

export const SERVER_VERSION = '0.1.0';

const INSTRUCTIONS =
  'Reads a Booksy Biz panel through the user\'s own logged-in browser tab. Start with ' +
  'session_status. Requests are slow on purpose: they run one at a time with a gap. Prefer one ' +
  'precise call over several broad ones. Client data is personal data: use only what the task ' +
  'needs. Write tools need a dry run and then a confirmation from the user. Never call mode=confirm ' +
  'without showing the dry run to the user first.';

export function toToolResult(value: unknown, config: Config, now: Date): CallToolResult {
  const text = JSON.stringify(value, null, 2) ?? 'null';
  if (text.length <= config.maxResultChars) {
    return { content: [{ type: 'text', text }] };
  }
  const path = saveFile(
    config.exportDir,
    {
      base: 'large-result',
      extension: '.json',
      bytes: new TextEncoder().encode(text),
    },
    now,
  );
  const note = {
    truncated: true,
    full_result_file: path,
    characters: text.length,
    preview: text.slice(0, 4000),
    next: 'The full result is in the file. Narrow the request to get a smaller answer.',
  };
  return { content: [{ type: 'text', text: JSON.stringify(note, null, 2) }] };
}

export function toErrorResult(error: unknown): CallToolResult {
  const body =
    error instanceof BooksyError
      ? { error: error.code, message: error.message, details: error.details }
      : { error: 'internal_error', message: (error as Error).message };
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], isError: true };
}

export function createServer(
  bridge: Bridge & { status(): BridgeStatus },
  config: Config,
): { server: McpServer; gateway: Gateway; tools: ToolDef[] } {
  const gateway = new Gateway(bridge, {
    minIntervalMs: config.minIntervalMs,
    maxRequestsPerHour: config.maxRequestsPerHour,
    maskContacts: config.maskContacts,
  });
  const confirmations = new Confirmations();
  const snapshots = new SnapshotStore(join(config.stateDir));
  const server = new McpServer(
    { name: 'booksy-mcp', version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  const askUser = async (message: string): Promise<boolean | undefined> => {
    if (!server.server.getClientCapabilities()?.elicitation) return undefined;
    const answer = await server.server.elicitInput({
      mode: 'form',
      message: `Send this change to Booksy?\n\n${message}`,
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean', title: 'Yes, send it' } },
        required: ['confirm'],
      },
    });
    return answer.action === 'accept' && answer.content?.confirm === true;
  };

  const context: ToolContext = {
    gateway,
    config,
    confirmations,
    snapshots,
    bridgeStatus: () => bridge.status(),
    askUser,
    now: () => new Date(),
  };

  const tools = selectTools(config);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: !tool.write,
          destructiveHint: tool.write,
          idempotentHint: !tool.write,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          return toToolResult(await tool.handler(args, context), config, context.now());
        } catch (error) {
          return toErrorResult(error);
        }
      },
    );
  }
  return { server, gateway, tools };
}
