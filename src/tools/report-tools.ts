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
  date_till: schema.date('Last day of the period, inclusive. Safe mode allows at most 366 days'),
  time_span: z
    .enum(TIME_SPANS)
    .default('month')
    .describe(
      'Period type the panel sends next to the two dates. Use between for a custom range. Default month',
    ),
};
const periodQuery = ['date_from', 'date_till', 'time_span'];

const filters = z
  .record(z.string(), z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]))
  .optional()
  .describe(
    'Extra report filters as an object of name and value, for example {"staffer_id": 12345}. The ' +
      'names a report accepts come from stats_report_metadata. No filters when left out',
  );

function assertReportPeriod(args: Args, context: ToolContext): void {
  const { gateway } = context;
  gateway.assertRange(args.date_from as string, args.date_till as string, gateway.traffic.maxReportDays);
}

const statsOverview = readTool({
  name: 'stats_overview',
  title: 'Statistics overview',
  description:
    'Returns the main statistics dashboard of the panel for a period: the headline figures ' +
    'Booksy shows on the first statistics screen. Use it for a quick overview. One section in ' +
    'depth is in stats_dashboard, and a single report in stats_report. The first read can take ' +
    'over a minute, then the answer is cached for 10 minutes (50 in safe mode).',
  rule: 'stats.main',
  input: period,
  query: periodQuery,
  check: assertReportPeriod,
});

const statsDashboard = readTool({
  name: 'stats_dashboard',
  title: 'Statistics dashboard',
  description:
    'Returns one section of the statistics screen for a period, with its figures and the list ' +
    'of reports inside it. Use it for one topic such as revenue or ' +
    'staff. stats_overview is the summary of all sections, and stats_report opens one of the ' +
    'listed reports by key. Slow on the first read, then cached.',
  rule: 'stats.dashboard',
  input: {
    ...period,
    dashboard: z
      .enum(DASHBOARDS)
      .describe('Section of the statistics screen to read, for example revenue'),
  },
  query: [...periodQuery, 'dashboard'],
  check: assertReportPeriod,
});

const reportMetadata = readTool({
  name: 'stats_report_metadata',
  title: 'Report filters',
  description:
    'Returns what one report accepts: its period limits and the filters it offers. Call it ' +
    'before stats_report or report_export when you want to filter, to get valid names for the ' +
    'filters argument. Report keys come from stats_report_catalog.',
  rule: 'stats.metadata',
  input: { report: schema.id('Report key from stats_report_catalog') },
  query: ['report'],
});

const billingCycles = readTool({
  name: 'stats_billing_cycles',
  title: 'Billing cycles',
  description:
    'Lists the billing cycles of the business that the panel offers as report periods. Use it ' +
    'when the user asks for figures per billing cycle: take the dates of a cycle as date_from ' +
    'and date_till of stats_report or report_export.',
  rule: 'stats.billing_cycles',
});

const report: ToolDef = {
  name: 'stats_report',
  title: 'Report as data',
  description:
    'Returns one statistics report as JSON for a period, as the panel shows it on screen. Use ' +
    'it to read and reason about figures directly. Long reports come one page at a time: use ' +
    'page, or report_export for the whole report as a file. Report keys come from ' +
    'stats_report_catalog and filter names from stats_report_metadata. Read-only. Booksy can ' +
    'take over a minute, then the answer is cached for 10 minutes (50 in safe mode).',
  input: {
    report_key: schema.id('Report key from stats_report_catalog'),
    ...period,
    page: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Page of a long report, starting at 1. The first page when left out'),
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
  description:
    'Returns one section of a statistics report as JSON, for example the part for one staff ' +
    'member or a later page of a table. Use it only to follow up on stats_report or ' +
    'stats_dashboard, with the section parameters their answer gave. For a whole report use ' +
    'stats_report. Read-only, and slow on the first read like the other statistics tools.',
  input: {
    ...period,
    filters: filters.describe(
      'Section parameters as an object of name and value, copied from the answer of ' +
        'stats_report or stats_dashboard that pointed to this section',
    ),
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
    'Lists every report this salon can open, as reports with dashboard, key and title, plus ' +
    'unavailable for sections the plan lacks. Call it first to get the report_key that ' +
    'stats_report, stats_report_metadata and report_export need: Booksy decides the keys by plan ' +
    'and country. Read-only. Without dashboard it reads all 8 sections one after another, which ' +
    'is slow the first time. A stop by Booksy ends the reading, and the keys found until then ' +
    'are returned with stopped_early.',
  input: {
    ...period,
    dashboard: z
      .enum(DASHBOARDS)
      .optional()
      .describe('Read only this section, for example staff. All 8 sections when left out'),
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
  .describe(
    'file saves the file as Booksy sends it. csv also writes a CSV next to it for each sheet. ' +
      'json also returns the rows in the answer. csv and json need an xlsx workbook: any other ' +
      'file is saved as it came, with parse_error. Default file',
  );

const exportReport: ToolDef = {
  name: 'report_export',
  title: 'Export a report',
  description:
    'Downloads one whole report for a period as the file the panel offers and ' +
    'saves it in the export folder on this computer, returning the file path, size and content ' +
    'type. It can also convert the file to CSV or return the rows as JSON. Use it when the full ' +
    'report or a file is needed. stats_report reads a report page by page without a file, and ' +
    'report_export_batch saves several reports. It changes nothing in Booksy but writes local ' +
    'files. Booksy can take over a minute, and safe mode allows 15 exports a day, one minute apart.',
  input: {
    report_key: schema.id('Report key from stats_report_catalog'),
    ...period,
    filters,
    output,
    max_rows: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(500)
      .describe(
        'With output=json, how many rows of each sheet to return, from 1 to 5000. Default 500. ' +
          'The saved file always holds all rows',
      ),
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
    'Saves several reports for the same period as files in the export folder, strictly one ' +
    'after another, and returns one result per report with its file path. Use it for a set of ' +
    'reports, and report_export for a single report, for filters or for rows as JSON. A report ' +
    'that fails does not stop the others, but a block by Booksy or a used-up budget ends the ' +
    'batch, and what was saved until then is listed. It changes nothing in Booksy but writes ' +
    'local files. Safe mode allows 5 reports per call and 15 exports a day, one minute apart.',
  input: {
    report_keys: z
      .array(schema.id('Report key from stats_report_catalog'))
      .min(1)
      .max(30)
      .describe('Report keys from stats_report_catalog, from 1 to 30 (at most 5 in safe mode)'),
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
  description:
    'Downloads one document from the panel and saves it in the export folder on this computer: ' +
    'a cash register report (xlsx), or a cash document, invoice or consent as PDF. ' +
    'Returns the file path, size and content type, not the content. Use it when the user needs ' +
    'the file itself. The same records as data are in cash_register, invoice and ' +
    'consents_signed, and statistics reports are saved with report_export. It changes nothing in ' +
    'Booksy but writes a local file.',
  input: {
    kind: z
      .enum(['cash_register_report', 'cash_document', 'invoice_pdf', 'consent_pdf'])
      .describe(
        'What to download: cash_register_report (xlsx report of one register), cash_document ' +
          '(PDF of one cash register document), invoice_pdf or consent_pdf',
      ),
    id: schema.id(
      'Id that matches kind: a register id from cash_registers, a cash document id, an invoice ' +
        'id from invoices, or a consent uuid from consents_signed',
    ),
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
  description:
    'Downloads one file attached to a client card and saves it in the export folder on this ' +
    'computer, returning the file path, size and content type, not the content. Use it only ' +
    'when the user asks for that attachment. The list of attached files and their ids is on ' +
    'customer_card. The file can hold personal data, and it is saved exactly as stored, without ' +
    'masking. It changes nothing in Booksy.',
  input: {
    customerId: schema.id('Client id from customer_cards, for example 12345'),
    attachedFileId: schema.id('Id of the attached file, from the client card returned by customer_card'),
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
    'A diagnostic for maintainers, not for salon questions. Shows which addresses the ' +
    'statistics frame of the panel asked for by itself: address shapes and parameter names, ' +
    'without ids, values or headers. Use it only to check this project against the live panel ' +
    '(docs/verification.md), after opening the statistics screen in the panel. Read-only, sends ' +
    'nothing to Booksy and uses no budget. For statistics themselves use stats_overview.',
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
