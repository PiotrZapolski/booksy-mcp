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
      .describe(`${what} (YYYY-MM-DD)`),
  dateTime: (what: string) =>
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .describe(`${what} (YYYY-MM-DDTHH:mm, salon local time)`),
  page: z.number().int().min(1).default(1).describe('Page number, from 1'),
  perPage: z.number().int().min(1).max(100).default(20).describe('Items per page, at most 100'),
  fresh: z.boolean().default(false).describe('Skip the local cache'),
};

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
    description: definition.description,
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
      `${definition.description} Two steps: call with mode=dry_run (default) to see the exact ` +
      'request, then call again with the same arguments, mode=confirm and the confirm_token.',
    input: {
      ...definition.input,
      mode: z.enum(['dry_run', 'confirm']).default('dry_run').describe('dry_run shows, confirm sends'),
      confirm_token: z.string().optional().describe('Token from the dry run, needed with mode=confirm'),
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
