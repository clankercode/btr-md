import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// CodeMirror/Lezer rely on *singleton* module instances: facets (@codemirror/
// state), the Language machinery + `syntaxTree` (@codemirror/language) and node
// types/props (@lezer/common) only interoperate when every consumer shares one
// copy. This project's node_modules has several duplicated physical copies of
// these packages. Without deduping, esbuild bundles each copy separately, so
// e.g. `markdown()` registers its parse state in one `@codemirror/language`
// instance while an imported `syntaxTree` reads another — yielding an empty
// tree (no highlighting, no markdown decorations).
//
// We anchor resolution at a modern 6.x package (@codemirror/lang-markdown) so
// we pick the 6.x copies it actually uses: the *top-level*
// node_modules/@codemirror/language is an old 0.20 copy hoisted from the unused
// @codemirror/basic-setup dep and lacks exports the 6.x sub-languages need.
// Only the genuine singletons are aliased — NOT @lezer/lr or @lezer/highlight,
// which differ by grammar version and hold no cross-package shared state.
const root = process.cwd();
const anchor = path.join(root, 'node_modules', '@codemirror', 'lang-markdown', 'package.json');
const req = createRequire(anchor);

// Resolve a package's directory by resolving its entry and walking up to the
// dir whose package.json `name` matches (the packages restrict `exports`, so we
// can't resolve `<pkg>/package.json` directly).
function packageDir(name) {
  let dir = path.dirname(req.resolve(name));
  while (dir !== path.dirname(dir)) {
    const pj = path.join(dir, 'package.json');
    if (existsSync(pj) && JSON.parse(readFileSync(pj, 'utf8')).name === name) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`could not locate package dir for ${name}`);
}

const SINGLETONS = [
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/language',
  '@lezer/common',
];

const alias = {};
for (const pkg of SINGLETONS) {
  alias[pkg] = packageDir(pkg);
}
console.log('[build-codemirror] dedupe aliases:');
for (const [k, v] of Object.entries(alias)) {
  const ver = JSON.parse(readFileSync(path.join(v, 'package.json'), 'utf8')).version;
  console.log(`  ${k} -> ${ver}`);
}

await esbuild.build({
  entryPoints: ['src/codemirror-entry.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'vendor/codemirror-6/codemirror.bundle.js',
  sourcemap: true,
  minify: false,
  target: ['es2020'],
  alias,
  logLevel: 'info',
});
