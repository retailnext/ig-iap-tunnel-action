import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { get as httpsGet, RequestOptions } from 'https';

export interface Platform {
  os: string;
  arch: string;
}

const OS_MAP: Record<string, string> = {
  linux: 'linux',
  darwin: 'darwin',
};

const ARCH_MAP: Record<string, string> = {
  x64: 'amd64',
  arm64: 'arm64',
};

export function getPlatform(): Platform {
  const os = OS_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];
  if (!os) throw new Error(`Unsupported platform: ${process.platform}`);
  if (!arch) throw new Error(`Unsupported architecture: ${process.arch}`);
  return { os, arch };
}

export function getBinaryName(version: string, os: string, arch: string): string {
  return `ig-iap-tunnel_${version.replace(/^v/, '')}_${os}_${arch}`;
}

export async function resolveVersion(versionInput: string, token = ''): Promise<string> {
  if (versionInput !== 'latest') return versionInput;
  return fetchLatestTag(token);
}

export function fetchLatestTag(token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const opts: RequestOptions = {
      hostname: 'api.github.com',
      path: '/repos/retailnext/ig-iap-tunnel/releases/latest',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ig-iap-tunnel-action',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    httpsGet(opts, (res) => {
      let raw = '';
      res.on('data', (chunk: string) => (raw += chunk));
      res.on('end', () => {
        try {
          const body = JSON.parse(raw) as { tag_name?: string };
          if (!body.tag_name) return reject(new Error('No tag_name in GitHub releases response'));
          resolve(body.tag_name);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

export function findFile(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

export function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function attempt(): void {
      const sock = new net.Socket();
      let settled = false;

      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        sock.destroy();
        if (!err) {
          resolve();
        } else if (Date.now() >= deadline) {
          reject(new Error(`Proxy on port ${port} did not become ready within ${timeoutMs / 1000}s`));
        } else {
          setTimeout(attempt, 1_000);
        }
      };

      sock.setTimeout(1_000);
      sock.connect(port, '127.0.0.1', () => finish());
      sock.on('error', finish);
      sock.on('timeout', () => finish(new Error('timeout')));
    }

    attempt();
  });
}

export function readTail(filePath: string, maxBytes: number): string {
  const stat = fs.statSync(filePath);
  if (stat.size <= maxBytes) {
    return fs.readFileSync(filePath, 'utf8');
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
    const raw = buf.toString('utf8');
    // Drop any partial first line caused by the seek offset
    const newline = raw.indexOf('\n');
    const tail = newline >= 0 ? raw.slice(newline + 1) : raw;
    return `(log truncated — ${stat.size} bytes total, showing last ${maxBytes} bytes)\n${tail}`;
  } finally {
    fs.closeSync(fd);
  }
}

export async function waitForExit(pid: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}
