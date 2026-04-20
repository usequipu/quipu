import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PluginApi } from '../types/plugin-types';

// pluginLoader selects its runtime adapter at module load time.
// We reset modules in each describe block and assign window.electronAPI
// before importing to control which adapter is selected.

const MOCK_QUIPU_DIR = '/home/user/.quipu';

const makeApi = (): PluginApi =>
  ({
    register: vi.fn(),
    registerPanel: vi.fn(),
    commands: { register: vi.fn(), execute: vi.fn() },
    services: {} as PluginApi['services'],
    React: {} as PluginApi['React'],
    ReactDOM: {} as PluginApi['ReactDOM'],
  }) as unknown as PluginApi;

const makeElectronApi = (overrides: Record<string, unknown> = {}) =>
  ({
    readDirectory: vi.fn(),
    readPluginsConfig: vi.fn().mockResolvedValue(null),
    writePluginsConfig: vi.fn().mockResolvedValue({ success: true }),
    getQuipuDir: vi.fn().mockResolvedValue(MOCK_QUIPU_DIR),
    readFile: vi.fn().mockResolvedValue(null),
    listPluginDirs: vi.fn().mockResolvedValue([]),
    removePluginDir: vi.fn().mockResolvedValue({ success: true }),
    downloadAndExtractPlugin: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  }) as unknown as typeof window.electronAPI;

// ---------------------------------------------------------------------------
// validateManifest (pure function — tested independently)
// ---------------------------------------------------------------------------

describe('validateManifest', () => {
  let validateManifest: typeof import('../services/pluginLoader')['validateManifest'];

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../services/pluginLoader');
    validateManifest = mod.validateManifest;
  });

  it('rejects null input', () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
  });

  it('rejects non-object input', () => {
    const result = validateManifest('string');
    expect(result.valid).toBe(false);
  });

  it('rejects manifest missing required fields', () => {
    const result = validateManifest({ id: 'my-plugin', name: 'My Plugin' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/missing required field/);
  });

  it('rejects id with underscores', () => {
    const result = validateManifest({
      id: 'my_plugin',
      name: 'My Plugin',
      version: '1.0.0',
      description: 'A plugin',
      entry: 'index.js',
      quipuVersion: '*',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/id/);
  });

  it('rejects id starting with a number that would fail regex', () => {
    // ids starting with a digit followed by valid chars are actually OK per regex
    // but ids with capital letters are not
    const result = validateManifest({
      id: 'MyPlugin',
      name: 'My Plugin',
      version: '1.0.0',
      description: 'A plugin',
      entry: 'index.js',
      quipuVersion: '*',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/id/);
  });

  it('rejects invalid semver range in quipuVersion', () => {
    const result = validateManifest({
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      description: 'A plugin',
      entry: 'index.js',
      quipuVersion: 'not-a-semver',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/quipuVersion/);
  });

  it('rejects incompatible quipuVersion range', () => {
    // Host version is 0.0.0 in tests (VITE_APP_VERSION not set)
    const result = validateManifest({
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      description: 'A plugin',
      entry: 'index.js',
      quipuVersion: '^99.0.0',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/quipuVersion|requires/);
  });

  it('accepts a valid manifest with wildcard quipuVersion', () => {
    const result = validateManifest({
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      description: 'A plugin',
      entry: 'index.js',
      quipuVersion: '*',
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.manifest.id).toBe('my-plugin');
      expect(result.manifest.name).toBe('My Plugin');
    }
  });

  it('accepts id starting with a digit', () => {
    const result = validateManifest({
      id: '0cool-plugin',
      name: 'Cool',
      version: '1.0.0',
      description: 'A plugin',
      entry: 'index.js',
      quipuVersion: '*',
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Browser mode (no-op stub)
// ---------------------------------------------------------------------------

describe('pluginLoader — browser runtime', () => {
  let pluginLoader: typeof import('../services/pluginLoader')['default'];
  let isElectron: typeof import('../services/pluginLoader')['isElectron'];

  beforeEach(async () => {
    delete (window as unknown as Record<string, unknown>).electronAPI;
    vi.resetModules();
    const mod = await import('../services/pluginLoader');
    pluginLoader = mod.default;
    isElectron = mod.isElectron;
  });

  it('isElectron() returns false without electronAPI', () => {
    expect(isElectron()).toBe(false);
  });

  it('loadAll returns empty loaded and errors lists', async () => {
    const result = await pluginLoader.loadAll(makeApi());
    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Electron mode — config edge cases
// ---------------------------------------------------------------------------

describe('pluginLoader — Electron runtime, config handling', () => {
  let pluginLoader: typeof import('../services/pluginLoader')['default'];
  let isElectron: typeof import('../services/pluginLoader')['isElectron'];

  beforeEach(async () => {
    window.electronAPI = makeElectronApi();
    vi.resetModules();
    const mod = await import('../services/pluginLoader');
    pluginLoader = mod.default;
    isElectron = mod.isElectron;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI;
  });

  it('isElectron() returns true when electronAPI.readPluginsConfig is present', () => {
    expect(isElectron()).toBe(true);
  });

  it('returns empty result when readPluginsConfig returns null (no plugins.json)', async () => {
    const result = await pluginLoader.loadAll(makeApi());
    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('returns empty result when plugins array is empty', async () => {
    (window.electronAPI!.readPluginsConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ plugins: [] })
    );
    const result = await pluginLoader.loadAll(makeApi());
    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('skips disabled plugins', async () => {
    (window.electronAPI!.readPluginsConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ plugins: [{ id: 'my-plugin', enabled: false }] })
    );
    const result = await pluginLoader.loadAll(makeApi());
    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Electron mode — manifest validation errors
// ---------------------------------------------------------------------------

describe('pluginLoader — Electron runtime, manifest validation', () => {
  let pluginLoader: typeof import('../services/pluginLoader')['default'];
  let importFromBlobUrl: typeof import('../services/pluginLoader')['importFromBlobUrl'];

  const validManifest = JSON.stringify({
    id: 'valid-plugin',
    name: 'Valid Plugin',
    version: '1.0.0',
    description: 'A valid plugin',
    entry: 'index.js',
    quipuVersion: '*',
  });

  beforeEach(async () => {
    window.electronAPI = makeElectronApi({
      readPluginsConfig: vi.fn().mockResolvedValue(
        JSON.stringify({ plugins: [{ id: 'some-plugin', enabled: true }] })
      ),
      readFile: vi.fn().mockResolvedValue(null), // manifest not found by default
    });
    vi.resetModules();
    const mod = await import('../services/pluginLoader');
    pluginLoader = mod.default;
    importFromBlobUrl = mod.importFromBlobUrl;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI;
  });

  it('collects error when manifest.json not found', async () => {
    // readFile returns null → ENOENT
    const result = await pluginLoader.loadAll(makeApi());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('some-plugin');
    expect(result.errors[0].reason).toMatch(/not found/);
  });

  it('collects error for invalid manifest JSON', async () => {
    (window.electronAPI!.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('not-json{{{');
    const result = await pluginLoader.loadAll(makeApi());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/not valid JSON/);
  });

  it('collects error for manifest with invalid id (underscore)', async () => {
    const badManifest = JSON.stringify({
      id: 'bad_plugin',
      name: 'Bad',
      version: '1.0.0',
      description: 'Bad id',
      entry: 'index.js',
      quipuVersion: '*',
    });
    (window.electronAPI!.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(badManifest);
    const result = await pluginLoader.loadAll(makeApi());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/id/);
  });

  it('collects error for incompatible quipuVersion', async () => {
    const manifest = JSON.stringify({
      id: 'some-plugin',
      name: 'Some Plugin',
      version: '1.0.0',
      description: 'Incompatible',
      entry: 'index.js',
      quipuVersion: '^99.0.0',
    });
    (window.electronAPI!.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(manifest);
    const result = await pluginLoader.loadAll(makeApi());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/quipuVersion|requires/);
  });

  it('collects error when entry file is not found', async () => {
    // First call (manifest) returns the valid manifest; second call (entry) returns null
    const readFileMock = window.electronAPI!.readFile as ReturnType<typeof vi.fn>;
    readFileMock
      .mockResolvedValueOnce(validManifest)  // manifest read
      .mockResolvedValueOnce(null);          // entry read → not found
    const result = await pluginLoader.loadAll(makeApi());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/entry not found/);
  });
});

// ---------------------------------------------------------------------------
// Electron mode — error isolation and successful load
// ---------------------------------------------------------------------------

describe('pluginLoader — Electron runtime, error isolation and init', () => {
  let pluginLoader: typeof import('../services/pluginLoader')['default'];

  const validManifest = (id: string) =>
    JSON.stringify({
      id,
      name: `Plugin ${id}`,
      version: '1.0.0',
      description: 'A plugin',
      entry: 'index.js',
      quipuVersion: '*',
    });

  const PLUGIN_SOURCE = `export function init(api) { api.register({ id: 'test' }); }`;

  beforeEach(async () => {
    window.electronAPI = makeElectronApi({
      readPluginsConfig: vi.fn(),
      readFile: vi.fn(),
    });
    vi.resetModules();
    const mod = await import('../services/pluginLoader');
    pluginLoader = mod.default;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI;
  });

  it('continues loading remaining plugins when one init() throws', async () => {
    (window.electronAPI!.readPluginsConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        plugins: [
          { id: 'bad-plugin', enabled: true },
          { id: 'good-plugin', enabled: true },
        ],
      })
    );

    const readFileMock = window.electronAPI!.readFile as ReturnType<typeof vi.fn>;
    readFileMock
      .mockResolvedValueOnce(validManifest('bad-plugin'))
      .mockResolvedValueOnce(PLUGIN_SOURCE)
      .mockResolvedValueOnce(validManifest('good-plugin'))
      .mockResolvedValueOnce(PLUGIN_SOURCE);

    // Use _importFromBlobUrl option to inject mock importers
    const mockImporter = vi.fn()
      .mockResolvedValueOnce({ init: () => { throw new Error('boom'); } })  // bad-plugin
      .mockResolvedValueOnce({ init: vi.fn() });                            // good-plugin

    const result = await pluginLoader.loadAll(makeApi(), { _importFromBlobUrl: mockImporter });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('bad-plugin');
    expect(result.errors[0].reason).toMatch(/init\(\) threw|boom/);

    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].id).toBe('good-plugin');
    expect(result.loaded[0].name).toBe('Plugin good-plugin');
  });

  it('collects error when plugin has no init export', async () => {
    (window.electronAPI!.readPluginsConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ plugins: [{ id: 'no-init', enabled: true }] })
    );
    (window.electronAPI!.readFile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(validManifest('no-init'))
      .mockResolvedValueOnce(PLUGIN_SOURCE);

    const result = await pluginLoader.loadAll(makeApi(), {
      _importFromBlobUrl: vi.fn().mockResolvedValueOnce({ notInit: vi.fn() }),
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/init/);
  });

  it('calls init(api) with the provided api object', async () => {
    (window.electronAPI!.readPluginsConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ plugins: [{ id: 'my-plugin', enabled: true }] })
    );
    (window.electronAPI!.readFile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(validManifest('my-plugin'))
      .mockResolvedValueOnce(PLUGIN_SOURCE);

    const initFn = vi.fn();
    const api = makeApi();
    await pluginLoader.loadAll(api, {
      _importFromBlobUrl: vi.fn().mockResolvedValueOnce({ init: initFn }),
    });

    expect(initFn).toHaveBeenCalledOnce();
    expect(initFn).toHaveBeenCalledWith(api);
  });

  it('calls registerKeybinding for each valid keybinding in manifest contributes', async () => {
    const manifest = JSON.stringify({
      id: 'kb-plugin',
      name: 'Keybinding Plugin',
      version: '1.0.0',
      description: 'Has keybindings',
      entry: 'index.js',
      quipuVersion: '*',
      contributes: {
        keybindings: [
          { command: 'git.commit', key: 'ctrl+shift+g', mac: 'cmd+shift+g' },
          { command: 'git.push', key: 'ctrl+shift+p' },
          { key: 'ctrl+x' },         // missing command — should be skipped
          { command: 'x', key: '' }, // empty key — should be skipped
        ],
      },
    });

    (window.electronAPI!.readPluginsConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ plugins: [{ id: 'kb-plugin', enabled: true }] })
    );
    (window.electronAPI!.readFile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(manifest)
      .mockResolvedValueOnce(PLUGIN_SOURCE);

    const registerKeybinding = vi.fn();
    await pluginLoader.loadAll(makeApi(), {
      _importFromBlobUrl: vi.fn().mockResolvedValueOnce({ init: vi.fn() }),
      registerKeybinding,
    });

    // Only the 2 valid entries should be registered
    expect(registerKeybinding).toHaveBeenCalledTimes(2);
    expect(registerKeybinding).toHaveBeenCalledWith({
      key: 'ctrl+shift+g',
      mac: 'cmd+shift+g',
      commandId: 'git.commit',
    });
    expect(registerKeybinding).toHaveBeenCalledWith({
      key: 'ctrl+shift+p',
      mac: undefined,
      commandId: 'git.push',
    });
  });
});
