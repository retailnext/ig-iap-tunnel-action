import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import { EventEmitter } from 'events';
import { getPlatform, getBinaryName, resolveVersion, findFile, waitForExit } from '../src/lib';

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
