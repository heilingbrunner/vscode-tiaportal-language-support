import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// the SCL highlighter loads the oniguruma WebAssembly binary from dist/ at runtime
mkdirSync('dist', { recursive: true });
copyFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'), 'dist/onig.wasm');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
