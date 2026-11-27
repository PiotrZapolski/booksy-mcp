// Builds the release files in build/: the MCP Bundle (.mcpb) and the browser extension as a zip.
// Run "npm run build" first. The bundle carries production dependencies only.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

/** Pinned on purpose: the packer decides what lands in the bundle. */
const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('mcpb/manifest.json', 'utf8'));
if (manifest.version !== pkg.version) {
  throw new Error(`mcpb/manifest.json has version ${manifest.version}, package.json ${pkg.version}`);
}
for (const needed of ['dist/index.js', 'extension/dist/manifest.json']) {
  if (!existsSync(needed)) throw new Error(`${needed} is missing. Run "npm run build" first.`);
}

const out = 'build';
const stage = join(out, 'mcpb');
rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const item of ['dist', 'extension/dist', 'package.json', 'package-lock.json', 'LICENSE', 'README.md']) {
  cpSync(item, join(stage, item), { recursive: true });
}
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);

const bundle = join(out, `booksy-mcp-${pkg.version}.mcpb`);
run('npx', ['--yes', MCPB_CLI, 'validate', join(stage, 'manifest.json')]);
run('npx', ['--yes', MCPB_CLI, 'pack', stage, bundle]);

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
const extension = join(out, `booksy-mcp-extension-${pkg.version}.zip`);
const entries = Object.fromEntries(
  files('extension/dist').map((file) => [
    relative('extension/dist', file).split('\\').join('/'),
    new Uint8Array(readFileSync(file)),
  ]),
);
writeFileSync(extension, zipSync(entries, { level: 9 }));

process.stdout.write(`${bundle}\n${extension}\n`);
