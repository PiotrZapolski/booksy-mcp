import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Config, loadConfig } from '../src/config.js';
import { createServer, toolGroupWarning } from '../src/server.js';
import { GROUP_NAMES, groupOf, resolveGroups, type ToolGroup, toolNamesOf } from '../src/tools/groups.js';
import { ALL_TOOLS, groupStatus, selectTools, toolGroup } from '../src/tools/index.js';
import { FakeBridge, tempDir, testConfig, testContext } from './helpers.js';

/** Read and write tools of every group. The README tables carry the same numbers. */
const SIZES: Record<ToolGroup, { read: number; write: number }> = {
  core: { read: 37, write: 15 },
  payments: { read: 17, write: 0 },
  inventory: { read: 9, write: 0 },
  vouchers: { read: 7, write: 0 },
  marketing: { read: 8, write: 2 },
  business: { read: 10, write: 0 },
  diagnostics: { read: 1, write: 0 },
};

const select = (toolGroups: string[], writeTools: string[] = []) =>
  selectTools({ writeTools, disabledTools: [], toolGroups });

const names = (toolGroups: string[], writeTools: string[] = []) =>
  select(toolGroups, writeTools).map((tool) => tool.name);

async function connect(config: Config) {
  const { server } = createServer(new FakeBridge(), config);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  return client;
}

const textOf = (result: unknown): string =>
  ((result as { content: Array<{ text: string }> }).content[0] as { text: string }).text;

describe('tool groups', () => {
  it('every tool is in exactly one group, and every grouped name is a tool', () => {
    const grouped = GROUP_NAMES.flatMap((group) => [...toolNamesOf(group)]);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(ALL_TOOLS.map((tool) => tool.name).sort());
    for (const tool of ALL_TOOLS) expect(groupOf(tool.name), tool.name).toBe(toolGroup(tool));
  });

  it('lists 37 tools by default and 89 with "all"', () => {
    expect(select([])).toHaveLength(37);
    expect(select([]).every((tool) => toolGroup(tool) === 'core')).toBe(true);
    expect(select(['all'])).toHaveLength(89);
    expect(select(['ALL '])).toHaveLength(89);
  });

  it.each(GROUP_NAMES.filter((group) => group !== 'core'))('"%s" adds its own tools to core', (group) => {
    const listed = select([group]);
    expect(listed).toHaveLength(SIZES.core.read + SIZES[group].read);
    const extra = listed.filter((tool) => toolGroup(tool) !== 'core');
    expect(extra.map((tool) => tool.name).sort()).toEqual(
      toolNamesOf(group)
        .filter((name) => !ALL_TOOLS.find((tool) => tool.name === name)?.write)
        .sort(),
    );
  });

  it('group sizes add up to 89 read and 17 write tools', () => {
    for (const group of GROUP_NAMES) {
      const tools = ALL_TOOLS.filter((tool) => toolGroup(tool) === group);
      expect({ group, read: tools.filter((t) => !t.write).length, write: tools.filter((t) => t.write).length })
        .toEqual({ group, ...SIZES[group] });
    }
    expect(Object.values(SIZES).reduce((sum, size) => sum + size.read, 0)).toBe(89);
    expect(Object.values(SIZES).reduce((sum, size) => sum + size.write, 0)).toBe(17);
  });

  it('core is always on, and unknown names turn nothing on', () => {
    expect(names(['core'])).toEqual(names([]));
    expect(names(['paymets'])).toEqual(names([]));
    expect(resolveGroups(['paymets', 'inventory']).unknown).toEqual(['paymets']);
    expect(toolGroupWarning({ toolGroups: ['paymets'] })).toContain('paymets');
    expect(toolGroupWarning({ toolGroups: ['payments', 'all'] })).toBeUndefined();
  });

  it('a write tool needs its group and the write switch, each on its own', () => {
    expect(select([]).filter((tool) => tool.write)).toEqual([]);
    expect(select(['all']).filter((tool) => tool.write)).toEqual([]);
    // The group alone does not enable a write, and the write switch alone does not open a group.
    expect(names(['marketing'])).not.toContain('campaign_send');
    expect(names([], ['campaign_send', 'chat_reply'])).not.toContain('campaign_send');
    expect(names(['marketing'], ['campaign_send'])).toContain('campaign_send');
    // "all" writes never covers tools that reach clients, with every group on as well.
    expect(names(['all'], ['all'])).not.toContain('campaign_send');
    expect(names(['all'], ['all'])).not.toContain('chat_reply');
    expect(select(['all'], ['all']).filter((tool) => tool.write)).toHaveLength(15);
    // Core writes work as before with no group configured.
    expect(names([], ['appointment_move']).filter((name) => name === 'appointment_move')).toHaveLength(1);
    expect(select([], ['all']).filter((tool) => tool.write)).toHaveLength(15);
  });

  it('disabledTools still removes a tool of an enabled group', () => {
    const listed = selectTools({ writeTools: [], disabledTools: ['payment_rows', 'reviews_feed'], toolGroups: ['payments'] });
    expect(listed.map((tool) => tool.name)).not.toContain('payment_rows');
    expect(listed.map((tool) => tool.name)).not.toContain('reviews_feed');
    expect(listed).toHaveLength(37 + 17 - 2);
  });
});

describe('tool groups in the configuration', () => {
  const load = (env: Record<string, string>, file?: object) => {
    const dir = tempDir();
    if (file) writeFileSync(join(dir, 'config.json'), JSON.stringify(file));
    return loadConfig({ BOOKSY_MCP_CONFIG_DIR: dir, ...env }).toolGroups;
  };

  it('is empty by default, and reads a list or "all" from the file and the environment', () => {
    expect(load({})).toEqual([]);
    expect(load({}, { toolGroups: ['payments', 'Inventory'] })).toEqual(['payments', 'inventory']);
    expect(load({}, { toolGroups: 'all' })).toEqual(['all']);
    expect(load({}, { toolGroups: 'payments, vouchers' })).toEqual(['payments', 'vouchers']);
    expect(load({ BOOKSY_MCP_TOOL_GROUPS: 'marketing,business' })).toEqual(['marketing', 'business']);
    expect(load({ BOOKSY_MCP_TOOL_GROUPS: 'all' }, { toolGroups: [] })).toEqual(['all']);
  });

  it('the environment wins over the file, and an unknown name does not stop loading', () => {
    expect(load({ BOOKSY_MCP_TOOL_GROUPS: 'payments' }, { toolGroups: 'all' })).toEqual(['payments']);
    expect(load({ BOOKSY_MCP_TOOL_GROUPS: '' }, { toolGroups: 'all' })).toEqual([]);
    expect(load({}, { toolGroups: ['nope'] })).toEqual(['nope']);
    expect(load({}, { toolGroups: 7 })).toEqual([]);
  });
});

describe('tool groups for an MCP client', () => {
  it('tools/list has the core group only, and a group from the configuration adds its tools', async () => {
    const byDefault = await connect(testConfig());
    const listed = (await byDefault.listTools()).tools.map((tool) => tool.name);
    await byDefault.close();
    expect(listed).toHaveLength(37);
    expect(listed).toContain('calendar_agenda');
    expect(listed).not.toContain('payment_rows');

    const withPayments = await connect(testConfig({ toolGroups: ['payments'] }));
    const more = (await withPayments.listTools()).tools.map((tool) => tool.name);
    await withPayments.close();
    expect(more).toHaveLength(54);
    expect(more).toContain('payment_rows');
  });

  it('calling a tool of a group that is off names the group and says how to turn it on', async () => {
    const client = await connect(testConfig());
    const result = await client.callTool({ name: 'payment_rows', arguments: {} });
    expect(result.isError).toBe(true);
    const body = JSON.parse(textOf(result)) as { error: string; message: string };
    expect(body.error).toBe('tool_group_disabled');
    expect(body.message).toContain('"payments"');
    expect(body.message).toContain('"toolGroups"');
    expect(body.message).toContain('BOOKSY_MCP_TOOL_GROUPS=payments');

    const write = await client.callTool({ name: 'campaign_send', arguments: {} });
    expect((JSON.parse(textOf(write)) as { message: string }).message).toContain('"marketing"');
    expect(textOf(write)).toContain('BOOKSY_MCP_WRITE_TOOLS');

    // Other refusals stay with the SDK: a name that is no tool, and a write that is not enabled.
    const unknown = await client.callTool({ name: 'no_such_tool', arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('not found');
    const writeOff = await client.callTool({ name: 'customer_delete', arguments: {} });
    expect(textOf(writeOff)).toContain('not found');
    await client.close();
  });

  it('a tool of an enabled group runs as before', async () => {
    const client = await connect(testConfig({ toolGroups: ['business'] }));
    const result = await client.callTool({ name: 'business_profile', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toMatchObject({ business_id: '1001' });
    const status = await client.callTool({ name: 'session_status', arguments: {} });
    expect(status.isError).toBeFalsy();
    await client.close();
  });
});

describe('session_status and tool groups', () => {
  const session = ALL_TOOLS.find((tool) => tool.name === 'session_status');

  it('lists every group with its state and size, and says how to enable the rest', async () => {
    const bridge = new FakeBridge();
    const config = testConfig({ toolGroups: ['inventory', 'nope'] });
    const result = (await session?.handler({}, testContext(bridge, { config, toolGroups: () => groupStatus(config) }))) as {
      tool_groups: ReturnType<typeof groupStatus>;
    };
    const groups = result.tool_groups.groups;
    expect(groups.map((group) => group.name)).toEqual([...GROUP_NAMES]);
    expect(groups.filter((group) => group.enabled).map((group) => group.name)).toEqual(['core', 'inventory']);
    for (const group of groups) {
      expect({ read: group.read_tools, write: group.write_tools }, group.name).toEqual(SIZES[group.name as ToolGroup]);
      expect(group.contains.length).toBeGreaterThan(20);
    }
    expect(result.tool_groups.unknown_in_config).toEqual(['nope']);
    expect(result.tool_groups.how_to_enable).toContain('"toolGroups"');
    expect(result.tool_groups.how_to_enable).toContain('BOOKSY_MCP_TOOL_GROUPS');
    expect(groupStatus({ toolGroups: ['all'] }).how_to_enable).toBe('Every tool group is on.');
  });

  it('shows the groups also when the extension is not connected', async () => {
    const bridge = new FakeBridge();
    bridge.connected = false;
    const result = (await session?.handler({}, testContext(bridge))) as { tool_groups: { groups: unknown[] } };
    expect(result.tool_groups.groups).toHaveLength(GROUP_NAMES.length);
  });

  it('its description tells the assistant about groups', () => {
    expect(session?.description).toContain('tool_groups');
    expect(session?.description).toContain('how_to_enable');
  });
});

describe('tool groups in the documentation', () => {
  it.each(['README.md', 'README.pl.md'])('%s has every group with its size and the way back to all', (file) => {
    const text = readFileSync(file, 'utf8');
    for (const group of GROUP_NAMES) {
      const size = SIZES[group];
      expect(text, group).toContain(`| \`${group}\` | ${size.read} | ${size.write} |`);
    }
    expect(text).toContain('"toolGroups": "all"');
    expect(text).toContain('BOOKSY_MCP_TOOL_GROUPS');
  });

  it('the job does not read the tool selection at all', () => {
    const job = readFileSync('src/job.ts', 'utf8');
    expect(job).not.toMatch(/tools\/(index|groups)\.js|toolGroups|selectTools/);
  });
});
