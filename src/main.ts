import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { getPlatform, getBinaryName, resolveVersion, findFile, waitForPort } from './lib';

const BINARY = 'ig-iap-tunnel';

async function run(): Promise<void> {
  const versionInput = core.getInput('version') || 'latest';
  const instanceGroupId = core.getInput('instance_group_id', { required: true });
  const remotePort = core.getInput('remote-port') || '8888';
  const localPortInput = core.getInput('local-port') || '8888';
  const localPort = parseInt(localPortInput, 10);
  if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
    throw new Error(`Invalid local-port: ${localPortInput}`);
  }
  const token = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';

  const version = await resolveVersion(versionInput, token);
  core.info(`ig-iap-tunnel version: ${version}`);

  const platform = getPlatform();
  const binaryName = getBinaryName(version, platform.os, platform.arch);
  const cacheDir = path.join(os.homedir(), '.ig-iap-tunnel', version);
  const binaryPath = path.join(cacheDir, BINARY);
  const cacheKey = `${BINARY}-${version}-${platform.os}-${platform.arch}`;

  const hit = await cache.restoreCache([cacheDir], cacheKey);
  if (!hit) {
    core.info('Cache miss — downloading binary');
    await download(version, binaryName, cacheDir, binaryPath);
    await cache.saveCache([cacheDir], cacheKey);
    core.info('Binary cached');
  } else {
    core.info(`Binary restored from cache (${cacheKey})`);
  }

  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-iap-tunnel-'));
  const logFile = path.join(logDir, 'ig-iap-tunnel.log');
  const logFd = fs.openSync(logFile, 'w');

  const proc = spawn(
    binaryPath,
    [
      '--instance-group-id', instanceGroupId,
      '--remote-port', remotePort,
      '--local-port', String(localPort),
    ],
    { detached: true, stdio: ['ignore', logFd, logFd] },
  );

  fs.closeSync(logFd);
  proc.unref();

  if (proc.pid === undefined) {
    throw new Error('Failed to start ig-iap-tunnel: process did not return a PID');
  }

  core.saveState('pid', String(proc.pid));
  core.saveState('log_file', logFile);
  core.info(`ig-iap-tunnel started (PID ${proc.pid}), waiting for proxy on port ${localPort}...`);
  await waitForPort(localPort, 60_000);
  core.info(`Proxy is ready on port ${localPort}`);
}

async function download(
  version: string,
  binaryName: string,
  destDir: string,
  destPath: string,
): Promise<void> {
  const tarName = `${binaryName}.tar.gz`;
  const url = `https://github.com/retailnext/ig-iap-tunnel/releases/download/${version}/${tarName}`;

  core.info(`Downloading ${url}`);
  const tarPath = await tc.downloadTool(url);
  const extractDir = await tc.extractTar(tarPath);

  const found = findFile(extractDir, BINARY);
  if (!found) {
    throw new Error(`Binary '${BINARY}' not found in archive extracted at ${extractDir}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(found, destPath);
  fs.chmodSync(destPath, 0o755);
}

run().catch(core.setFailed);
