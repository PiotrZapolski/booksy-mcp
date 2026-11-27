import type { Config } from '../config.js';
import { COMPOSITE_TOOLS } from './composite-tools.js';
import type { ToolDef, ToolGroupStatus } from './define.js';
import {
  enableHint,
  GROUP_NAMES,
  GROUP_SUMMARY,
  groupOf,
  resolveGroups,
  type ToolGroup,
} from './groups.js';
import { READ_TOOLS } from './read-tools.js';
import { REPORT_TOOLS } from './report-tools.js';
import { WRITE_TOOLS } from './write-tools.js';

export const ALL_TOOLS: ToolDef[] = [
  ...COMPOSITE_TOOLS,
  ...READ_TOOLS,
  ...REPORT_TOOLS,
  ...WRITE_TOOLS,
];

type Selection = Pick<Config, 'writeTools' | 'disabledTools' | 'toolGroups'>;

/** Throws for a tool without a group, so a new tool cannot be added without choosing one. */
export function toolGroup(tool: Pick<ToolDef, 'name'>): ToolGroup {
  const group = groupOf(tool.name);
  if (!group) throw new Error(`Tool ${tool.name} has no group in src/tools/groups.ts`);
  return group;
}

/** The write rule, whatever the groups: by name, or by "all" unless it reaches clients. */
function writeAllowed(tool: ToolDef, named: Set<string>): boolean {
  if (!tool.write) return true;
  if (named.has(tool.name)) return true;
  return named.has('all') && !tool.outreach;
}

/**
 * Decides which tools exist for this run. A tool is listed only when its group is on. A disabled
 * write is not registered at all, so a client cannot call it or even see it. "all" covers writes
 * that stay inside the panel. Tools that reach clients have to be named one by one. The group and
 * the write switch are independent: a write tool needs both.
 */
export function selectTools(config: Selection): ToolDef[] {
  const named = new Set(config.writeTools);
  const disabled = new Set(config.disabledTools);
  const { enabled } = resolveGroups(config.toolGroups);
  return ALL_TOOLS.filter(
    (tool) => !disabled.has(tool.name) && enabled.has(toolGroup(tool)) && writeAllowed(tool, named),
  );
}

/** Every group with its state and size, for session_status. Sizes do not depend on the configuration. */
export function groupStatus(config: Pick<Config, 'toolGroups'>): ToolGroupStatus {
  const { enabled, unknown } = resolveGroups(config.toolGroups);
  const groups = GROUP_NAMES.map((name) => {
    const tools = ALL_TOOLS.filter((tool) => toolGroup(tool) === name);
    return {
      name,
      enabled: enabled.has(name),
      contains: GROUP_SUMMARY[name],
      read_tools: tools.filter((tool) => !tool.write).length,
      write_tools: tools.filter((tool) => tool.write).length,
    };
  });
  const off = groups.filter((group) => !group.enabled).map((group) => group.name);
  return {
    groups,
    ...(unknown.length > 0 ? { unknown_in_config: unknown } : {}),
    how_to_enable:
      off.length === 0
        ? 'Every tool group is on.'
        : `Tools of a group that is off are not listed and cannot be called. To turn groups on, ` +
          `${enableHint(off.slice(0, 2))}. Write tools also need BOOKSY_MCP_WRITE_TOOLS as before.`,
  };
}

/**
 * Why a call to a tool that is not registered was refused, when the reason is its group.
 * Undefined for unknown names and for tools that are off for another reason.
 */
export function groupRefusal(name: string, config: Selection): string | undefined {
  const tool = ALL_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) return undefined;
  const group = toolGroup(tool);
  if (resolveGroups(config.toolGroups).enabled.has(group)) return undefined;
  return (
    `The tool ${name} belongs to the tool group "${group}", which is off. To turn it on, ` +
    `${enableHint([group])}.` +
    (tool.write ? ' It is also a write tool, so it has to be enabled in BOOKSY_MCP_WRITE_TOOLS.' : '')
  );
}
