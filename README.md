# ig-iap-tunnel-action

A GitHub Action that downloads, caches, and runs [ig-iap-tunnel](https://github.com/retailnext/ig-iap-tunnel) to open an IAP tunnel to a GCP instance group. The tunnel runs in the background for the duration of the job and is stopped automatically during cleanup.

This action can be useful if you want to reach your internal private network through http proxy server (e.g. tiny proxy). For example

1. Create a GCP instance group which start tinyproxy server on port 8888.
2. Using the action, open the iap-tunnel from the local port (8888) to the tinyproxy port (8888).
3. `export HTTPS_PROXY=localhost:8888`
4. HTTPS calls to get proxied through the tunnel to the network the proxy server belongs.

## Usage

```yaml
steps:
  - uses: actions/checkout@v4

  - uses: google-github-actions/auth@v2
    with:
      credentials_json: ${{ secrets.GCP_CREDENTIALS }}

  - uses: retailnext/ig-iap-tunnel-action@v1
    with:
      instance_group_id: 'projects/my-project/regions/us-central1/instanceGroups/my-group'
      remote-port: '8888'
      local-port: '8888'

  # Subsequent steps can reach the tunnel on localhost:8888.
  - run: curl "https://myinterdoamin"
    env:
      HTTPS_PROXY: 'localhost:8888'
```

## Inputs

| Input               | Required | Default               | Description |
|---------------------|----------|-----------------------|-------------|
| `instance_group_id` | yes      |                       | GCP instance group: `projects/{project}/regions/{region}/instanceGroups/{name}` |
| `version`           | no       | `latest`              | Release tag of ig-iap-tunnel to use (e.g. `v1.2.3`) |
| `remote-port`       | no       | `8888`                | Port on the remote instance to forward |
| `local-port`        | no       | `8888`                | Local port to listen on |
| `github-token`      | no       | `${{ github.token }}` | Token used to resolve the latest release via the GitHub API |

## Cleanup

The tunnel process is terminated automatically at the end of the job (including on failure) via the action's `post` step — no extra cleanup step is required.

## Custom version and ports

```yaml
- uses: retailnext/ig-iap-tunnel-action@v1
  with:
    instance_group_id: 'projects/my-project/regions/us-central1/instanceGroups/my-group'
    version: 'v1.2.3'
    remote-port: '9090'
    local-port: '9090'
```

## Caching

The binary is cached using [`actions/cache`](https://github.com/actions/cache) and keyed on the resolved version, OS, and architecture. Subsequent runs that hit the cache skip the download entirely.

## Development

```bash
npm install       # install dependencies
npm test          # run unit tests
npm run build     # bundle src/ → dist/ (commit dist/ after changes)
```

`dist/` must be committed. The CI `build` job verifies that the committed bundle matches the source.
