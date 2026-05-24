import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/codemirror-entry.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'vendor/codemirror-6/codemirror.bundle.js',
  sourcemap: true,
  minify: false,
  target: ['es2020'],
  logLevel: 'info',
});
