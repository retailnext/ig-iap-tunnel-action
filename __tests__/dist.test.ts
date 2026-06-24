/**
 * Smoke tests for the built dist bundles. Run via `npm run test:dist`
 * (and automatically at the end of `npm run build`), separate from the
 * unit suite so it always runs against freshly-built output.
 *
 * These run against the committed dist/ files (not src/) so they catch
 * bundling regressions that unit tests on src/ cannot detect. The bundles are
 * ESM (--format=esm). A CommonJS leaf dependency (tunnel, via
 * @actions/http-client) calls require() at load time, which only works because
 * the build injects a createRequire banner — drop that banner and the bundle
 * dies at load with `Dynamic require of "net" is not supported`. The runtime
 * check below catches exactly that class of load-time failure.
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = path.join(__dirname, '..', 'dist');
const BUNDLES = [
  path.join(DIST_ROOT, 'index.js'),
  path.join(DIST_ROOT, 'post', 'index.js'),
];

describe('dist bundle integrity', () => {
  it.each(BUNDLES)('exists: %s', (bundle) => {
    expect(fs.existsSync(bundle)).toBe(true);
  });

  // Regression guard: the broken CJS form is `import_meta.url` (underscore),
  // which references an empty `var import_meta = {}` esbuild emits when it
  // lowers a dependency's import.meta.url into CommonJS output, becoming
  // createRequire(undefined). Our ESM output uses the native `import.meta.url`
  // (dot) instead, which is valid; the underscore form must never appear.
  it.each(BUNDLES)('does not contain lowered import_meta.url: %s', (bundle) => {
    const content = fs.readFileSync(bundle, 'utf8');
    expect(content).not.toMatch(/import_meta\.url/);
  });

  // Runtime check: execute the bundle in a child process — exactly how the
  // GitHub Actions runner loads it (`node dist/index.js`). Without inputs the
  // action exits non-zero via core.setFailed, which is the *healthy* path. What
  // must NOT happen is a module-load/initialization crash. We run in a child
  // (not require()) so the action's setFailed can't poison this process's exit
  // code, and so we exercise the same entrypoint the runner does.
  const LOAD_CRASH = /Dynamic require of|ERR_INVALID_ARG_VALUE|Cannot find module|is not a function|before initialization|ERR_REQUIRE_ESM/;
  it.each(BUNDLES)('loads without a module-load crash: %s', (bundle) => {
    const result = spawnSync(process.execPath, [bundle], {
      encoding: 'utf8',
      // Empty env so the action takes the "missing input" path rather than
      // anything that depends on a real runner; keep PATH for node itself.
      env: { PATH: process.env.PATH },
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).not.toMatch(LOAD_CRASH);
  });
});
