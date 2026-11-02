import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const out = 'extension/dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ['extension/src/background.ts', 'extension/src/popup.ts'],
  outdir: out,
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  // Page functions are serialised by Chrome, so their source must stay self-contained and readable.
  minify: false,
  keepNames: false,
  logLevel: 'warning',
});

cpSync('extension/public', out, { recursive: true });
