import * as fs from 'fs';
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
