import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import { EventEmitter } from 'events';
import { getPlatform, getBinaryName, resolveVersion, findFile, waitForPort, waitForExit, readTail } from '../src/lib';

jest.mock('https');

// ---------------------------------------------------------------------------
// getPlatform
// ---------------------------------------------------------------------------
describe('getPlatform', () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  });

  it.each<[string, string, string, string]>([
    ['linux',  'x64',   'linux',  'amd64'],
    ['darwin', 'x64',   'darwin', 'amd64'],
    ['darwin', 'arm64', 'darwin', 'arm64'],
  ])('maps %s/%s → %s/%s', (platform, arch, expectedOs, expectedArch) => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    Object.defineProperty(process, 'arch',     { value: arch,     configurable: true });
    expect(getPlatform()).toEqual({ os: expectedOs, arch: expectedArch });
  });

  it('throws on unsupported platform (including windows)', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    expect(() => getPlatform()).toThrow('Unsupported platform: win32');
  });

  it('throws on unsupported platform (other)', () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
    expect(() => getPlatform()).toThrow('Unsupported platform: freebsd');
  });

  it('throws on unsupported architecture', () => {
    Object.defineProperty(process, 'platform', { value: 'linux',  configurable: true });
    Object.defineProperty(process, 'arch',     { value: 'ia32',   configurable: true });
    expect(() => getPlatform()).toThrow('Unsupported architecture: ia32');
  });
});

// ---------------------------------------------------------------------------
// getBinaryName
// ---------------------------------------------------------------------------
describe('getBinaryName', () => {
  it('strips v prefix from version', () => {
    expect(getBinaryName('v1.2.3', 'linux', 'amd64')).toBe('ig-iap-tunnel_1.2.3_linux_amd64');
  });

  it('accepts version without v prefix', () => {
    expect(getBinaryName('1.2.3', 'darwin', 'arm64')).toBe('ig-iap-tunnel_1.2.3_darwin_arm64');
  });

});

// ---------------------------------------------------------------------------
// resolveVersion
// ---------------------------------------------------------------------------
describe('resolveVersion', () => {
  it('returns the input unchanged when not "latest"', async () => {
    await expect(resolveVersion('v1.2.3')).resolves.toBe('v1.2.3');
  });

  it('fetches the latest tag from GitHub when input is "latest"', async () => {
    const mockResponse = new EventEmitter() as ReturnType<typeof https.get>;
    (https.get as jest.Mock).mockImplementation((_opts: unknown, cb: (res: EventEmitter) => void) => {
      cb(mockResponse);
      return mockResponse;
    });

    const promise = resolveVersion('latest', 'test-token');
    mockResponse.emit('data', JSON.stringify({ tag_name: 'v3.1.0' }));
    mockResponse.emit('end');

    await expect(promise).resolves.toBe('v3.1.0');
  });

  it('rejects when the API response has no tag_name', async () => {
    const mockResponse = new EventEmitter() as ReturnType<typeof https.get>;
    (https.get as jest.Mock).mockImplementation((_opts: unknown, cb: (res: EventEmitter) => void) => {
      cb(mockResponse);
      return mockResponse;
    });

    const promise = resolveVersion('latest');
    mockResponse.emit('data', JSON.stringify({ message: 'Not Found' }));
    mockResponse.emit('end');

    await expect(promise).rejects.toThrow('No tag_name');
  });

  it('rejects on network error', async () => {
    const mockReq = new EventEmitter();
    (https.get as jest.Mock).mockImplementation((_opts: unknown, _cb: unknown) => mockReq);

    const promise = resolveVersion('latest');
    mockReq.emit('error', new Error('ECONNREFUSED'));

    await expect(promise).rejects.toThrow('ECONNREFUSED');
  });
});

// ---------------------------------------------------------------------------
// findFile
// ---------------------------------------------------------------------------
describe('findFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iap-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds a file in the root directory', () => {
    const filePath = path.join(tmpDir, 'ig-iap-tunnel_1.0.0_linux_amd64');
    fs.writeFileSync(filePath, '');
    expect(findFile(tmpDir, 'ig-iap-tunnel_1.0.0_linux_amd64')).toBe(filePath);
  });

  it('finds a file in a nested subdirectory', () => {
    const subDir = path.join(tmpDir, 'nested', 'dir');
    fs.mkdirSync(subDir, { recursive: true });
    const filePath = path.join(subDir, 'ig-iap-tunnel_1.0.0_darwin_arm64');
    fs.writeFileSync(filePath, '');
    expect(findFile(tmpDir, 'ig-iap-tunnel_1.0.0_darwin_arm64')).toBe(filePath);
  });

  it('returns null when file is not found', () => {
    expect(findFile(tmpDir, 'nonexistent')).toBeNull();
  });

  it('does not return a directory with a matching name', () => {
    const dirPath = path.join(tmpDir, 'ig-iap-tunnel_1.0.0_linux_amd64');
    fs.mkdirSync(dirPath);
    expect(findFile(tmpDir, 'ig-iap-tunnel_1.0.0_linux_amd64')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readTail
// ---------------------------------------------------------------------------
describe('readTail', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iap-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns full content when file is within the limit', () => {
    const file = path.join(tmpDir, 'small.log');
    fs.writeFileSync(file, 'line1\nline2\n');
    expect(readTail(file, 1024)).toBe('line1\nline2\n');
  });

  it('returns full content when file size equals maxBytes exactly', () => {
    const content = 'a'.repeat(16);
    const file = path.join(tmpDir, 'exact.log');
    fs.writeFileSync(file, content);
    expect(readTail(file, 16)).toBe(content);
  });

  it('truncates and prepends notice when file exceeds the limit', () => {
    const head = 'old line\n'.repeat(100);
    const tail = 'new line\n'.repeat(5);
    const file = path.join(tmpDir, 'large.log');
    fs.writeFileSync(file, head + tail);
    const result = readTail(file, tail.length);
    expect(result).toMatch(/^\(log truncated/);
    expect(result).toContain('new line\n');
    expect(result).not.toContain('old line');
  });

  it('skips a partial first line after seeking', () => {
    // Content where the seek lands mid-line: ensure no partial line appears
    const file = path.join(tmpDir, 'partial.log');
    fs.writeFileSync(file, 'PARTIAL_LINE_START\nclean line\n');
    // maxBytes covers 'LINE_START\nclean line\n' — seek lands mid-word
    const result = readTail(file, 22);
    expect(result).not.toContain('PARTIAL');
    expect(result).toContain('clean line\n');
  });

  it('returns buffer content as-is when there is no newline in the tail', () => {
    const file = path.join(tmpDir, 'nonewline.log');
    fs.writeFileSync(file, 'aaaaabbbbb');
    const result = readTail(file, 5);
    expect(result).toMatch(/^\(log truncated/);
    expect(result).toContain('bbbbb');
  });
});

// ---------------------------------------------------------------------------
// waitForPort
// ---------------------------------------------------------------------------
describe('waitForPort', () => {
  function listenOnFreePort(server: net.Server): Promise<number> {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as net.AddressInfo).port);
    }));
  }

  function closeServer(server: net.Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
  }

  it('resolves immediately when port is already listening', async () => {
    const server = net.createServer();
    const port = await listenOnFreePort(server);
    try {
      await expect(waitForPort(port, 5_000)).resolves.toBeUndefined();
    } finally {
      await closeServer(server);
    }
  }, 10_000);

  it('rejects after timeout when nothing is listening', async () => {
    // Grab a free port number, then release it so nothing is listening
    const server = net.createServer();
    const port = await listenOnFreePort(server);
    await closeServer(server);

    await expect(waitForPort(port, 100)).rejects.toThrow('did not become ready');
  }, 5_000);

  it('resolves when the port starts listening before the deadline', async () => {
    const server = net.createServer();
    const port = await listenOnFreePort(server);
    await closeServer(server);

    // Start listening again after a short delay
    setTimeout(() => server.listen(port, '127.0.0.1'), 300);

    try {
      await expect(waitForPort(port, 5_000)).resolves.toBeUndefined();
    } finally {
      await closeServer(server);
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// waitForExit
// ---------------------------------------------------------------------------
describe('waitForExit', () => {
  const realKill = process.kill.bind(process);

  afterEach(() => {
    // Restore process.kill in case a test replaced it
    Object.defineProperty(process, 'kill', { value: realKill, configurable: true, writable: true });
  });

  it('resolves immediately when process no longer exists', async () => {
    const killMock = jest.fn().mockImplementation(() => {
      const err = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      throw err;
    });
    Object.defineProperty(process, 'kill', { value: killMock, configurable: true, writable: true });

    await expect(waitForExit(99999, 1000)).resolves.toBeUndefined();
  });

  it('SIGKILLs after timeout if process does not exit', async () => {
    let callCount = 0;
    const killMock = jest.fn().mockImplementation((_pid: number, sig: string | number) => {
      if (sig === 0 || sig === 'SIGKILL') {
        callCount++;
        // Always appear alive for signal 0, silently accept SIGKILL
        if (sig === 0) return; // alive
      }
    });
    Object.defineProperty(process, 'kill', { value: killMock, configurable: true, writable: true });

    await waitForExit(12345, 100); // very short timeout

    const sigkillCalls = killMock.mock.calls.filter(([, sig]) => sig === 'SIGKILL');
    expect(sigkillCalls.length).toBeGreaterThan(0);
  });
});
