import * as esbuild from 'esbuild';
import { cp } from 'node:fs/promises';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/bundle.js',
  sourcemap: true,
  minify: false,
  target: ['es2020'],
  logLevel: 'info',
});

await cp('node_modules/katex/dist/fonts', 'styles/fonts', { recursive: true });
