import * as esbuild from 'esbuild';

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
