# ig-iap-tunnel-action

A GitHub Action (Node.js/TypeScript) that downloads, caches, and runs [ig-iap-tunnel](https://github.com/retailnext/ig-iap-tunnel) to create an IAP tunnel to a GCP instance group. Cleanup is handled automatically via the `post` lifecycle — no separate stop step needed.

## Repository layout

```
action.yml              — action metadata (node20, main + post lifecycle)
src/
  lib.ts                — pure helpers: getPlatform, getBinaryName, resolveVersion, findFile, waitForPort, waitForExit, readTail
  main.ts               — action entry: resolve version → restore cache → download → spawn tunnel
  post.ts               — post entry: read saved PID → SIGTERM → wait for exit → print truncated logs
__tests__/
  lib.test.ts           — unit tests for all lib.ts exports
dist/                   — bundled output (committed, built via `npm run build`)
  index.js              — bundled main
  post/index.js         — bundled post
package.json
tsconfig.json
jest.config.js
```

## Inputs (action.yml)

| Input              | Required | Default              | Description                                                                 |
|--------------------|----------|----------------------|-----------------------------------------------------------------------------|
| `version`          | no       | `latest`             | ig-iap-tunnel release tag (e.g. `v1.2.3`). `latest` resolves via GitHub API |
| `instance_group_id`| yes      | —                    | GCP instance group: `projects/{p}/regions/{r}/instanceGroups/{name}`        |
| `remote-port`      | no       | `8888`               | Port on the remote instance                                                 |
| `local-port`       | no       | `8888`               | Local port to listen on                                                     |
| `github-token`     | no       | `${{ github.token }}`| Token used to resolve the latest release version without rate-limiting      |

## How it works

1. **Resolve version** — if `latest`, calls GitHub releases API (authenticated with `github-token`) to get the concrete tag.
2. **Platform mapping** — `process.platform`/`process.arch` → `linux|darwin|windows` / `amd64|arm64`.
3. **Cache** — `@actions/cache` restores/saves `~/.ig-iap-tunnel/<version>/` keyed on `ig-iap-tunnel-<version>-<os>-<arch>`.
4. **Download** — if cache miss, fetches `ig-iap-tunnel_<version>_<os>_<arch>.zip` from the GitHub release, extracts via `@actions/tool-cache`, copies binary to cache dir.
5. **Start** (`main.ts`) — validates `local-port` (1–65535, not NaN); creates a unique log dir via `fs.mkdtempSync` (`$TMPDIR/ig-iap-tunnel-XXXXXX/ig-iap-tunnel.log`); spawns binary with `{ detached: true, stdio: ['ignore', logFd, logFd] }` + `unref()`; saves PID and log path to job state via `core.saveState`.
6. **Stop** (`post.ts`, runs automatically with `post-if: always()`) — reads PID from state, SIGTERMs, polls with `kill -0` until exit (up to 10 s), then SIGKILLs; reads and prints the last 64 KB of the log file (with a truncation notice if larger).

## Binary naming convention

Releases follow: `ig-iap-tunnel_<version>_<os>_<arch>.zip`
`<version>` has the `v` prefix stripped (tag `v1.2.3` → `ig-iap-tunnel_1.2.3_linux_amd64.zip`).

## Usage

```yaml
steps:
  - uses: retailnext/ig-iap-tunnel-action@v1
    with:
      instance_group_id: 'projects/my-project/regions/us-central1/instanceGroups/my-group'
      # version, remote-port, local-port all have sensible defaults
```

Cleanup runs automatically — no `if: always()` step needed.

## Development

```bash
npm install           # install deps
npm test              # run unit tests (jest + ts-jest)
npm run build         # bundle src/main.ts → dist/index.js and src/post.ts → dist/post/index.js
```

**Always commit `dist/` after building.** GitHub Actions loads `dist/index.js` and `dist/post/index.js` directly.

## Design notes

- `lib.ts` contains only pure/testable functions; `main.ts` and `post.ts` are thin orchestration layers that integrate with Actions APIs and child processes.
- `waitForExit` uses `kill -0` polling (not `wait`) because the post shell is a different process than the one that spawned the tunnel.
- `@actions/cache` v4+ is required (v3 is deprecated).
- The log file lives in a `mkdtemp`-created directory so concurrent or repeated runs on the same runner don't collide or read stale output.
- `readTail` in `lib.ts` reads the last N bytes of a file, skips any partial first line at the seek boundary, and prepends a truncation notice — used by `post.ts` to cap log output at 64 KB.
- `local-port` is parsed and range-checked (1–65535) immediately after input reading; the resulting number is used for spawn args, log messages, and `waitForPort` — no repeated `parseInt` at call sites.
- `scripts/postbuild.js` strips an unused `var net2 = require("net")` line injected by the `tunnel` package; it uses a regex to handle both quote styles and silently no-ops if the line is absent (esbuild output varies across versions).
