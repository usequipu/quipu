import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// kernelService selects runtime at module load time based on window.electronAPI.
// The test setup (src/test/setup.js) deletes window.electronAPI, so all tests
// run against the browser (fetch-based) implementation by default.
// To test Electron paths, assign window.electronAPI before importing.

describe('kernelService — browser runtime', () => {
  let kernelService;
  let isElectron;

  beforeEach(async () => {
    // Ensure Electron APIs are absent so browser impl is selected
    delete window.electronAPI;
    vi.resetModules();
    const mod = await import('../services/kernelService.js');
    kernelService = mod.default;
    isElectron = mod.isElectron;
  });

  it('isElectron() returns false without electronAPI', () => {
    expect(isElectron()).toBe(false);
  });

  it('getVenvPath returns null when nothing stored', async () => {
    const result = await kernelService.getVenvPath();
    expect(result).toBeNull();
  });

  it('setVenvPath stores and getVenvPath retrieves the value', async () => {
    await kernelService.setVenvPath('/home/user/.venv');
    const result = await kernelService.getVenvPath();
    expect(result).toBe('/home/user/.venv');
  });

  it('getChannelUrl returns a ws:// URL containing the kernel id', () => {
    const url = kernelService.getChannelUrl('abc-123');
    expect(url).toMatch(/^ws/);
    expect(url).toContain('abc-123');
    expect(url).toContain('/channels');
  });
});

describe('kernelService — Electron runtime', () => {
  let kernelService;
  let isElectron;

  beforeEach(async () => {
    // Stub out Electron APIs
    window.electronAPI = {
      kernelStart: vi.fn().mockResolvedValue({ status: 'started', port: 9000 }),
      kernelStop: vi.fn().mockResolvedValue({ status: 'stopped' }),
      kernelValidate: vi.fn().mockResolvedValue({ valid: true }),
      kernelProxyRest: vi.fn().mockResolvedValue({ id: 'session-1', kernel: { id: 'kernel-1' } }),
      kernelGetChannelUrl: vi.fn().mockResolvedValue('ws://127.0.0.1:9000/api/kernels/kernel-1/channels?token=tok'),
      storageGet: vi.fn().mockResolvedValue(null),
      storageSet: vi.fn().mockResolvedValue(undefined),
    };
    vi.resetModules();
    const mod = await import('../services/kernelService.js');
    kernelService = mod.default;
    isElectron = mod.isElectron;
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it('isElectron() returns true with electronAPI.kernelStart present', () => {
    expect(isElectron()).toBe(true);
  });

  it('validateVenv delegates to electronAPI.kernelValidate', async () => {
    const result = await kernelService.validateVenv('/home/user/.venv');
    expect(window.electronAPI.kernelValidate).toHaveBeenCalledWith('/home/user/.venv');
    expect(result.valid).toBe(true);
  });

  it('startServer delegates to electronAPI.kernelStart', async () => {
    const result = await kernelService.startServer('/home/user/.venv', '/workspace');
    expect(window.electronAPI.kernelStart).toHaveBeenCalledWith('/home/user/.venv', '/workspace');
    expect(result.status).toBe('started');
  });

  it('concurrent startServer calls share one in-flight Promise (no double spawn)', async () => {
    const p1 = kernelService.startServer('/home/user/.venv', '/workspace');
    const p2 = kernelService.startServer('/home/user/.venv', '/workspace');
    await Promise.all([p1, p2]);
    expect(window.electronAPI.kernelStart).toHaveBeenCalledTimes(1);
  });

  it('stopServer delegates to electronAPI.kernelStop', async () => {
    await kernelService.stopServer();
    expect(window.electronAPI.kernelStop).toHaveBeenCalled();
  });

  it('createSession delegates to electronAPI.kernelProxyRest', async () => {
    const result = await kernelService.createSession('/workspace/nb.ipynb');
    expect(window.electronAPI.kernelProxyRest).toHaveBeenCalledWith(
      'POST', '/api/sessions', expect.objectContaining({ path: '/workspace/nb.ipynb' })
    );
    expect(result.id).toBe('session-1');
  });

  it('getChannelUrl returns the ws:// URL from electronAPI', async () => {
    const url = await kernelService.getChannelUrl('kernel-1');
    expect(window.electronAPI.kernelGetChannelUrl).toHaveBeenCalledWith('kernel-1');
    expect(url).toContain('ws://');
    expect(url).toContain('kernel-1');
  });
});
