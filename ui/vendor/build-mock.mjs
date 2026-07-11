import * as esbuild from 'esbuild';

// Compile the typed e2e mock (e2e/mock/mock.ts) into a self-contained IIFE that
// Playwright injects via `page.addInitScript({ path })`. The mock imports ONLY
// types from src/ (erased by esbuild), so the output has no runtime dependency
// on the app bundle. It reads its per-test config from `window.__pmdMockConfig`
// and installs `window.__TAURI_INTERNALS__`.
await esbuild.build({
  entryPoints: { mock: 'e2e/mock/mock.ts' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: 'e2e/mock/dist/mock.js',
  sourcemap: false,
  target: ['es2020'],
  logLevel: 'info',
});
