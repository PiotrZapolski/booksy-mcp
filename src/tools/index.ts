import type { Config } from '../config.js';
import { COMPOSITE_TOOLS } from './composite-tools.js';
import type { ToolDef } from './define.js';
import { READ_TOOLS } from './read-tools.js';
import { REPORT_TOOLS } from './report-tools.js';
import { WRITE_TOOLS } from './write-tools.js';

export const ALL_TOOLS: ToolDef[] = [
  ...COMPOSITE_TOOLS,
  ...READ_TOOLS,
  ...REPORT_TOOLS,
  ...WRITE_TOOLS,
];

/**
 * Decides which tools exist for this run. A disabled write is not registered at all, so a client
 * cannot call it or even see it. "all" covers writes that stay inside the panel. Tools that reach
 * clients have to be named one by one.
 */
export function selectTools(config: Pick<Config, 'writeTools' | 'disabledTools'>): ToolDef[] {
  const named = new Set(config.writeTools);
  const everything = named.has('all');
  const disabled = new Set(config.disabledTools);
  return ALL_TOOLS.filter((tool) => {
    if (disabled.has(tool.name)) return false;
    if (!tool.write) return true;
    if (named.has(tool.name)) return true;
    return everything && !tool.outreach;
  });
}
