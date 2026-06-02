import * as esbuild from 'esbuild';
import { cp } from 'node:fs/promises';

// Code splitting (todo #8): mermaid + its diagram libraries and KaTeX are
// dynamically imported by their runner modules, so esbuild emits them as
// separate chunks loaded on demand. A plain Markdown document therefore never
// loads those multi-MB libraries at startup. `bundle` stays the entry name so
// index.html's `./dist/bundle.js` reference is unchanged; chunks land beside it
// in dist/ and ship via frontendDist ("../../ui").
await esbuild.build({
  entryPoints: { bundle: 'src/main.ts' },
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: 'dist',
  sourcemap: true,
  minify: false,
  target: ['es2020'],
  logLevel: 'info',
});

await cp('node_modules/katex/dist/fonts', 'styles/fonts', { recursive: true });
