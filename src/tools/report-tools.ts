import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { BooksyError } from '../errors.js';
import { extensionFor, saveFile } from '../exports/files.js';
import { readWorkbook, type Sheet, toCsv, toTable } from '../exports/sheet.js';
import { sanitize } from '../gateway/sanitize.js';
import { readTool, schema, type Args, type ToolContext, type ToolDef } from './define.js';

/** Period values the panel's report screens send. */
const TIME_SPANS = [
  'day',
  'week',
  'month',
  'year',
  'between',
  'last_7_days',
  'last_14_days',
  'last_30_days',
  'last_3_months',
  'last_6_months',
] as const;

/** Sections of the panel's report screen. Report keys inside them come from the panel at run time. */
export const DASHBOARDS = [
  'appointments',
  'clients',
  'revenue',
  'cash_flow',
  'inventory',
  'staff',
  'promotion',
  'tips',
] as const;

const period = {
  date_from: schema.date('First day of the period'),
  date_till: schema.date('Last day of the period'),
  time_span: z.enum(TIME_SPANS).default('month').describe('Period type'),
};
const periodQuery = ['date_from', 'date_till', 'time_span'];

const filters = z
  .record(z.string(), z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]))
  .optional()
  .describe('Extra report filters from stats_report_metadata, such as staffer_id');

function assertReportPeriod(args: Args, context: ToolContext): void {
  const { gateway } = context;
  gateway.assertRange(args.date_from as string, args.date_till as string, gateway.traffic.maxReportDays);
}

const statsOverview = readTool({
  name: 'stats_overview',
  title: 'Statistics overview',
  description: 'The main statistics dashboard for a period. The first read can take a minute.',
  rule: 'stats.main',
  input: period,
  query: periodQuery,
  check: assertReportPeriod,
});

const statsDashboard = readTool({
  name: 'stats_dashboard',
  title: 'Statistics dashboard',
  description: 'One statistics section with its figures and the list of reports inside it.',
  rule: 'stats.dashboard',
  input: { ...period, dashboard: z.enum(DASHBOARDS).describe('Section') },
  query: [...periodQuery, 'dashboard'],
  check: assertReportPeriod,
});

const reportMetadata = readTool({
  name: 'stats_report_metadata',
  title: 'Report filters',
  description: 'What a report needs: its period limits and available filters.',
  rule: 'stats.metadata',
  input: { report: schema.id('Report key') },
  query: ['report'],
});

const billingCycles = readTool({
  name: 'stats_billing_cycles',
  title: 'Billing cycles',
  description: 'Billing cycles usable as report periods.',
  rule: 'stats.billing_cycles',
});

const report: ToolDef = {
  name: 'stats_report',
  title: 'Report as data',
  description:
    'One report as JSON, as the panel shows it. Long reports are paged: use page, or report_export ' +
    'for the whole report as a file.',
  input: {
    report_key: schema.id('Report key from stats_report_catalog'),
    ...period,
    page: z.number().int().min(1).optional().describe('Page of the report'),
    filters,
    fresh: schema.fresh,
  },
  write: false,
  async handler(args, context) {
    assertReportPeriod(args, context);
    const response = await context.gateway.request('stats.report', {
      params: {
        report_key: args.report_key as string,
        date_from: args.date_from as string,
        date_till: args.date_till as string,
        time_span: args.time_span as string,
        ...(args.page ? { page: args.page as number } : {}),
        ...(args.filters as Record<string, string | number | Array<string | number>> | undefined),
      },
      fresh: args.fresh === true,
    });
    return response.data;
  },
};

const section: ToolDef = {
  name: 'stats_report_section',
  title: 'Report section',
  description: 'One section of a report, for example one staff member or a later page of a table.',
  input: {
    ...period,
    filters: filters.describe('Section parameters as the report returned them'),
    fresh: schema.fresh,
  },
  write: false,
  async handler(args, context) {
    assertReportPeriod(args, context);
    const response = await context.gateway.request('stats.section', {
      params: {
        date_from: args.date_from as string,
        date_till: args.date_till as string,
        time_span: args.time_span as string,
        ...(args.filters as Record<string, string | number | Array<string | number>> | undefined),
      },
      fresh: args.fresh === true,
    });
    return response.data;
  },
};

const catalog: ToolDef = {
  name: 'stats_report_catalog',
  title: 'Report catalogue',
  description:
    'Every report key this salon can open, per statistics section. Booksy decides the keys by plan ' +
    'and country, so they are read from the panel. Reads one section after another, so it is slow ' +
    'the first time. Pass dashboard for just one section. A stop ends the reading, and the keys ' +
    'found until then are returned.',
  input: {
    ...period,
    dashboard: z.enum(DASHBOARDS).optional().describe('Only this section'),
  },
  write: false,
  async handler(args, context) {
    assertReportPeriod(args, context);
    const sections = args.dashboard ? [args.dashboard as string] : [...DASHBOARDS];
    const reports: Array<{ dashboard: string; key: unknown; title: unknown }> = [];
    const unavailable: Array<{ dashboard: string; reason: string }> = [];
    for (const dashboard of sections) {
      try {
        const response = await context.gateway.request('stats.dashboard', {
          params: {
            date_from: args.date_from as string,
            date_till: args.date_till as string,
            time_span: args.time_span as string,
            dashboard,
          },
        });
        const list = (response.data as { reports?: Array<{ key?: unknown; title?: unknown }> })
          .reports;
        for (const entry of list ?? []) {
          reports.push({ dashboard, key: entry.key, title: entry.title });
        }
      } catch (error) {
        const message = (error as Error).message;
        if ((error as { code?: string }).code === 'booksy_error') {
          unavailable.push({ dashboard, reason: message });
          continue;
        }
        if (reports.length === 0) throw error;
        return { count: reports.length, reports, unavailable, stopped_early: message };
      }
    }
    return { count: reports.length, reports, unavailable };
  },
};

interface ExportOptions {
  reportKey: string;
  args: Args;
  output: 'file' | 'csv' | 'json';
  maxRows: number;
}

async function exportOne(context: ToolContext, options: ExportOptions): Promise<object> {
  const { args, reportKey } = options;
  assertReportPeriod(args, context);
  const file = await context.gateway.download('stats.download', {
    params: {
      date_from: args.date_from as string,
      date_till: args.date_till as string,
      time_span: args.time_span as string,
      report_key: reportKey,
      ...(args.filters as Record<string, string | number | Array<string | number>> | undefined),
    },
  });
  const path = saveFile(
    context.config.exportDir,
    {
      base: `${reportKey}_${args.date_from}_${args.date_till}`,
      filename: file.filename,
      extension: extensionFor(file.contentType, '.xlsx'),
      bytes: file.bytes,
    },
    context.now(),
  );
  const result: Record<string, unknown> = {
    report_key: reportKey,
    file: path,
    bytes: file.bytes.length,
    content_type: file.contentType,
  };
  if (options.output === 'file') return result;

  let sheets: Sheet[];
  try {
    sheets = readWorkbook(file.bytes);
  } catch {
    return { ...result, parse_error: 'The file is not an xlsx workbook. It was saved as it came.' };
  }

  if (options.output === 'csv') {
    result.csv_files = sheets.map((sheet, index) => {
      const csvPath = `${path.replace(/\.[^.]+$/, '')}${sheets.length > 1 ? `-${index + 1}` : ''}.csv`;
      writeFileSync(csvPath, `﻿${toCsv(sheet.rows)}`, { mode: 0o600 });
      return csvPath;
    });
    return result;
  }

  // Downloads skip the gateway's JSON sanitizer, so rows are masked here.
  result.sheets = sanitize(
    sheets.map((sheet) => {
      const table = toTable(sheet.rows);
      return {
        name: sheet.name,
        total_rows: table.records.length,
        rows: table.records.slice(0, options.maxRows),
        totals: table.totals,
        ...(table.extraRows.length > 0 ? { rows_below_totals: table.extraRows } : {}),
      };
    }),
    { redactPii: context.config.redactPii },
  );
  return result;
}

const output = z
  .enum(['file', 'csv', 'json'])
  .default('file')
  .describe('file saves the panel file, csv also converts it, json also returns the rows');

const exportReport: ToolDef = {
  name: 'report_export',
  title: 'Export a report',
  description:
    'Downloads any report the panel offers as a file and saves it on this computer. Can also ' +
    'convert it to CSV or return the rows as JSON. Report keys come from stats_report_catalog. ' +
    'Booksy can take over a minute to build a report.',
  input: {
    report_key: schema.id('Report key from stats_report_catalog'),
    ...period,
    filters,
    output,
    max_rows: z.number().int().min(1).max(5000).default(500).describe('JSON rows per sheet'),
  },
  write: false,
  handler: (args, context) =>
    exportOne(context, {
      reportKey: args.report_key as string,
      args,
      output: args.output as ExportOptions['output'],
      maxRows: args.max_rows as number,
    }),
};

const exportBatch: ToolDef = {
  name: 'report_export_batch',
  title: 'Export several reports',
  description:
    'Saves several reports for one period, strictly one after another, with a pause. A report that ' +
    'fails does not stop the others. A block by Booksy or a used-up budget ends the batch, and what ' +
    'was saved until then is listed. In safe mode a batch can have at most 5 reports.',
  input: {
    report_keys: z.array(schema.id('Report key')).min(1).max(30).describe('Report keys'),
    ...period,
    output: output,
  },
  write: false,
  async handler(args, context) {
    const keys = args.report_keys as string[];
    const allowed = context.gateway.traffic.maxExportsPerCall;
    if (keys.length > allowed) {
      throw new BooksyError(
        'safe_mode_limit',
        `Safe mode exports at most ${allowed} reports in one call. This call has ${keys.length}.`,
      );
    }
    const results: object[] = [];
    for (const reportKey of keys) {
      try {
        results.push(
          await exportOne(context, {
            reportKey,
            args,
            output: args.output as ExportOptions['output'],
            maxRows: 0,
          }),
        );
      } catch (error) {
        const message = (error as Error).message;
        if ((error as { code?: string }).code === 'booksy_error') {
          results.push({ report_key: reportKey, error: message });
          continue;
        }
        if (results.length === 0) throw error;
        return { results, stopped_early: message };
      }
    }
    return { results };
  },
};

const DOCUMENTS = {
  cash_register_report: { rule: 'registers.download', param: 'registerId', extension: '.xlsx' },
  cash_document: { rule: 'registers.cash_document', param: 'documentId', extension: '.pdf' },
  invoice_pdf: { rule: 'invoices.pdf', param: 'invoiceId', extension: '.pdf' },
  consent_pdf: { rule: 'consents.pdf', param: 'consentUuid', extension: '.pdf' },
} as const;

const documentDownload: ToolDef = {
  name: 'document_download',
  title: 'Download a document',
  description: 'Saves a cash register report, cash document, invoice or consent as a local file.',
  input: {
    kind: z.enum(['cash_register_report', 'cash_document', 'invoice_pdf', 'consent_pdf']),
    id: schema.id('Id of the document, register, invoice or consent'),
  },
  write: false,
  async handler(args, context) {
    const kind = DOCUMENTS[args.kind as keyof typeof DOCUMENTS];
    const file = await context.gateway.download(kind.rule, {
      urlParams: { [kind.param]: args.id as string },
    });
    const path = saveFile(
      context.config.exportDir,
      {
        base: `${args.kind as string}_${args.id as string}`,
        filename: file.filename,
        extension: extensionFor(file.contentType, kind.extension),
        bytes: file.bytes,
      },
      context.now(),
    );
    return { file: path, bytes: file.bytes.length, content_type: file.contentType };
  },
};

const clientFile: ToolDef = {
  name: 'customer_file_download',
  title: 'Download a client file',
  description: 'Saves a file attached to a client card as a local file.',
  input: {
    customerId: schema.id('Client id'),
    attachedFileId: schema.id('File id from the client card'),
  },
  write: false,
  async handler(args, context) {
    const file = await context.gateway.download('customers.file', {
      urlParams: {
        customerId: args.customerId as string,
        attachedFileId: args.attachedFileId as string,
      },
    });
    const path = saveFile(
      context.config.exportDir,
      {
        base: `client-file_${args.attachedFileId as string}`,
        filename: file.filename,
        extension: extensionFor(file.contentType, '.bin'),
        bytes: file.bytes,
      },
      context.now(),
    );
    return { file: path, bytes: file.bytes.length, content_type: file.contentType };
  },
};

const frameRequests: ToolDef = {
  name: 'stats_frame_requests',
  title: 'Requests of the report screen',
  description:
    'A check for live verification. Open the statistics screen in the panel first. Shows which ' +
    'addresses the report frame asked for by itself: address shapes and parameter names, without ' +
    'ids, values or headers. Sends nothing to Booksy.',
  input: {},
  write: false,
  async handler(_args, context) {
    const frames = await context.gateway.frameRequests();
    return {
      frames,
      next:
        frames.length > 0
          ? 'Compare these with the rules in docs/verification.md.'
          : 'No report frame is open. Open the statistics screen in the panel and try again.',
    };
  },
};

export const REPORT_TOOLS: ToolDef[] = [
  statsOverview,
  statsDashboard,
  catalog,
  reportMetadata,
  report,
  section,
  billingCycles,
  exportReport,
  exportBatch,
  documentDownload,
  clientFile,
  frameRequests,
];
