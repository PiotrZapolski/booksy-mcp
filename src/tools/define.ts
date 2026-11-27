import { z, type ZodRawShape } from 'zod';
import type { BridgeStatus } from '../bridge/server.js';
import type { Config } from '../config.js';
import type { SnapshotStore } from '../domain/feed.js';
import { BooksyError } from '../errors.js';
import type { Gateway, RequestOptions } from '../gateway/gateway.js';
import { getRule } from '../shared/allowlist.js';
import type { ChatAction } from '../shared/protocol.js';
import type { Confirmations } from '../writes/confirmations.js';

export interface ToolContext {
  gateway: Gateway;
  config: Config;
  confirmations: Confirmations;
  snapshots: SnapshotStore;
  bridgeStatus(): BridgeStatus;
  /** Asks the user directly when the client supports it. Undefined means it cannot ask. */
  askUser?(message: string): Promise<boolean | undefined>;
  now(): Date;
}

export type Args = Record<string, unknown>;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: ZodRawShape;
  write: boolean;
  /** Reaches clients directly. Never enabled by "all". */
  outreach?: boolean;
  handler(args: Args, context: ToolContext): Promise<unknown>;
}

const id = (what: string): z.ZodString =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .describe(what);

export const schema = {
  id,
  date: (what: string) =>
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe(`${what} (YYYY-MM-DD, for example 2026-03-15)`),
  dateTime: (what: string) =>
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .describe(`${what} (YYYY-MM-DDTHH:mm in salon local time, for example 2026-03-15T14:30)`),
  page: z.number().int().min(1).default(1).describe('Page number, starting at 1. Default 1'),
  perPage: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Items per page, from 1 to 100. Default 20'),
  fresh: z
    .boolean()
    .default(false)
    .describe(
      'true asks Booksy again instead of using the local cache (answers are kept 1 to 10 minutes, ' +
        'five times longer in safe mode). In safe mode an answer younger than 60 seconds is still ' +
        'reused. Default false',
    ),
};

/** Closing sentence of every tool built with readTool, so all of them say the same about the answer. */
export const READ_ONLY_NOTE =
  "Read-only. Returns Booksy's JSON plus business_id and from_cache (true when the answer came " +
  'from the local cache).';

function pick(args: Args, names: string[]): RequestOptions['params'] {
  const params: NonNullable<RequestOptions['params']> = {};
  for (const name of names) {
    const value = args[name];
    if (value !== undefined) params[name] = value as string | number | boolean;
  }
  return params;
}

export interface SimpleRead {
  name: string;
  title: string;
  description: string;
  rule: string;
  input?: ZodRawShape;
  /** Inputs that go straight into the query string under the same name. */
  query?: string[];
  /** Inputs that fill path parameters of the rule, under the same name. */
  path?: string[];
  /** Fixed query values. */
  fixed?: Record<string, string | number | boolean>;
  map?(args: Args): Record<string, string | number | boolean | undefined>;
  /** Runs first and throws to refuse the call before anything is sent. */
  check?(args: Args, context: ToolContext): void;
}

/** A read tool that maps onto exactly one allowed endpoint. */
export function readTool(definition: SimpleRead): ToolDef {
  if (!getRule(definition.rule)) throw new Error(`Unknown rule ${definition.rule}`);
  return {
    name: definition.name,
    title: definition.title,
    description: `${definition.description} ${READ_ONLY_NOTE}`,
    input: { ...definition.input, fresh: schema.fresh },
    write: false,
    async handler(args, context) {
      definition.check?.(args, context);
      const urlParams: Record<string, string> = {};
      for (const name of definition.path ?? []) urlParams[name] = String(args[name]);
      const options: RequestOptions = {
        params: {
          ...definition.fixed,
          ...pick(args, definition.query ?? []),
          ...definition.map?.(args),
        },
        fresh: args.fresh === true,
      };
      if (Object.keys(urlParams).length > 0) options.urlParams = urlParams;
      const response = await context.gateway.request(definition.rule, options);
      return { business_id: response.businessId, from_cache: response.fromCache, ...wrap(response.data) };
    },
  };
}

function wrap(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { data };
}

export interface WritePlan {
  summary: string;
  ruleId?: string;
  urlParams?: Record<string, string>;
  params?: RequestOptions['params'];
  data?: unknown;
  chat?: ChatAction;
}

export interface WriteDefinition {
  name: string;
  title: string;
  description: string;
  outreach?: boolean;
  input: ZodRawShape;
  plan(args: Args, context: ToolContext): Promise<WritePlan> | WritePlan;
  preview?(plan: WritePlan, args: Args, context: ToolContext): Promise<unknown>;
}

/** What the confirmation binds to: the request, without the human-readable summary. */
function bindingOf(plan: WritePlan): Omit<WritePlan, 'summary'> {
  const request: Partial<WritePlan> = { ...plan };
  delete request.summary;
  return request;
}

/** Wraps a write in the dry-run and confirm flow. There is no path around it. */
export function writeTool(definition: WriteDefinition): ToolDef {
  const tool: ToolDef = {
    name: definition.name,
    title: definition.title,
    description:
      `${definition.description} Write tool, off by default: enable it ` +
      (definition.outreach
        ? 'by name in BOOKSY_MCP_WRITE_TOOLS (not covered by "all", because it reaches clients)'
        : 'by name or with "all" in BOOKSY_MCP_WRITE_TOOLS') +
      ' and turn on "Allow writes" in the extension. Call with mode=dry_run (default) to see the ' +
      'exact request and get a confirm_token without changing anything, show it to the user, then ' +
      'repeat the call with mode=confirm and that token (valid once, for 5 minutes).',
    input: {
      ...definition.input,
      mode: z
        .enum(['dry_run', 'confirm'])
        .default('dry_run')
        .describe(
          'dry_run (default) shows the exact request and sends no change. confirm sends it and ' +
            'needs confirm_token',
        ),
      confirm_token: z
        .string()
        .optional()
        .describe(
          'Token returned by the dry run with the same arguments. Required with mode=confirm, ' +
            'works once and expires after 5 minutes',
        ),
    },
    write: true,
    async handler(args, context) {
      const plan = await definition.plan(args, context);
      const binding = bindingOf(plan);

      if (args.mode !== 'confirm') {
        const preview = await definition.preview?.(plan, args, context);
        return {
          mode: 'dry_run',
          sent: false,
          summary: plan.summary,
          request: binding,
          preview: preview ?? null,
          confirm_token: context.confirmations.issue(definition.name, binding),
          next: 'Show this to the user. If they agree, repeat the call with mode=confirm.',
        };
      }

      if (typeof args.confirm_token !== 'string') {
        throw new BooksyError('invalid_confirmation', 'mode=confirm needs the confirm_token.');
      }
      context.confirmations.redeem(definition.name, binding, args.confirm_token);

      const answer = await context.askUser?.(plan.summary);
      if (answer === false) {
        throw new BooksyError('declined_by_user', 'The user declined. Nothing was sent.');
      }

      if (plan.chat) {
        const data = await context.gateway.chat(plan.chat);
        return { mode: 'confirm', sent: true, summary: plan.summary, result: data };
      }
      const options: RequestOptions = {};
      if (plan.urlParams) options.urlParams = plan.urlParams;
      if (plan.params) options.params = plan.params;
      if (plan.data !== undefined) options.data = plan.data;
      const response = await context.gateway.request(plan.ruleId as string, options);
      return { mode: 'confirm', sent: true, summary: plan.summary, result: response.data };
    },
  };
  if (definition.outreach) tool.outreach = true;
  return tool;
}
