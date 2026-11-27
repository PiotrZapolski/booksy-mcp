// Writes the server.json that goes to the MCP Registry for one release:
//   node scripts/release-server-json.mjs <bundle.mcpb> <output.json>
// The identifier is the release asset URL and fileSha256 is the hash of that exact file.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [bundle, output] = process.argv.slice(2);
if (!bundle || !output) {
  console.error('Usage: node scripts/release-server-json.mjs <bundle.mcpb> <output.json>');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const server = JSON.parse(readFileSync('server.json', 'utf8'));
const repository = server.repository.url;
const sha256 = createHash('sha256').update(readFileSync(bundle)).digest('hex');

server.version = pkg.version;
server.packages = server.packages.map((entry) =>
  entry.registryType === 'mcpb'
    ? {
        ...entry,
        identifier: `${repository}/releases/download/v${pkg.version}/${basename(bundle)}`,
        version: pkg.version,
        fileSha256: sha256,
      }
    : entry,
);

writeFileSync(output, `${JSON.stringify(server, null, 2)}\n`);
process.stdout.write(`${sha256}  ${basename(bundle)}\n`);
