import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer } from '../src/server.js';
import { ALL_TOOLS, selectTools } from '../src/tools/index.js';
import { FakeBridge, testConfig } from './helpers.js';

interface JsonSchema {
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
}

/** Every named field of an input schema, also inside lists of objects, with its path. */
function fields(schema: JsonSchema, prefix = ''): Array<[string, JsonSchema]> {
  const own = Object.entries(schema.properties ?? {}).flatMap(([name, field]) => [
    [`${prefix}${name}`, field] as [string, JsonSchema],
    ...fields(field, `${prefix}${name}.`),
  ]);
  return schema.items ? [...own, ...fields(schema.items, prefix)] : own;
}

const inputSchema = (input: z.ZodRawShape): JsonSchema =>
  z.toJSONSchema(z.object(input), { io: 'input' }) as JsonSchema;

describe('tool descriptions', () => {
  it('89 read tools are listed by default, and 17 write tools only when enabled', () => {
    expect(selectTools({ writeTools: [], disabledTools: [] })).toHaveLength(89);
    expect(ALL_TOOLS.filter((tool) => tool.write)).toHaveLength(17);
  });

  it('an MCP client receives the descriptions of every tool and parameter', async () => {
    const writes = ALL_TOOLS.filter((tool) => tool.write).map((tool) => tool.name);
    const { server } = createServer(new FakeBridge(), testConfig({ writeTools: writes }));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(clientSide);
    const listed = (await client.listTools()).tools;
    await client.close();

    expect(listed).toHaveLength(ALL_TOOLS.length);
    const missing = listed.flatMap((tool) =>
      fields(tool.inputSchema as JsonSchema)
        .filter(([, field]) => (field.description ?? '').trim().length < 10)
        .map(([name]) => `${tool.name}.${name}`),
    );
    expect(missing).toEqual([]);
    for (const tool of listed) expect((tool.description ?? '').length, tool.name).toBeGreaterThanOrEqual(80);
  });

  it('every tool says what it does in at least 80 characters and two sentences', () => {
    const weak = ALL_TOOLS.filter(
      (tool) => tool.description.length < 80 || tool.description.split(/\.\s/).length < 2,
    );
    expect(weak.map((tool) => tool.name)).toEqual([]);
  });

  it('every parameter has a description, also inside lists', () => {
    const missing = ALL_TOOLS.flatMap((tool) =>
      fields(inputSchema(tool.input))
        .filter(([, field]) => (field.description ?? '').trim().length < 10)
        .map(([name]) => `${tool.name}.${name}`),
    );
    expect(missing).toEqual([]);
  });

  it('every tool says whether it only reads or writes', () => {
    for (const tool of ALL_TOOLS) {
      if (tool.write) {
        expect(tool.description, tool.name).toContain('Write tool, off by default');
        expect(tool.description, tool.name).toContain('mode=dry_run');
        expect(tool.description, tool.name).toContain('confirm_token');
      } else {
        expect(tool.description, tool.name).toMatch(/Read-only|sends nothing|changes nothing in Booksy|only calculates/);
      }
    }
  });

  it('tools that reach clients say that "all" does not enable them', () => {
    for (const tool of ALL_TOOLS.filter((candidate) => candidate.outreach)) {
      expect(tool.description, tool.name).toContain('not covered by "all"');
    }
  });

  it('descriptions use plain hyphens only', () => {
    for (const tool of ALL_TOOLS) {
      const texts = [tool.description, ...fields(inputSchema(tool.input)).map(([, f]) => f.description ?? '')];
      for (const text of texts) expect(text, tool.name).not.toMatch(/[–—]/);
    }
  });
});
