import * as React from 'react';
import * as ReactDOM from 'react-dom';
import semver from 'semver';
import type {
  PluginApi,
  PanelDescriptor,
  PluginCommandHandler,
  PluginCommandOptions,
} from '../types/plugin-types';
import type { ExtensionDescriptor } from '../types/extensions';
import type { KeybindingEntry } from '../extensions/keybindingRegistry';

// ---------------------------------------------------------------------------
// App version (set by vite.config.ts in U7; falls back to '0.0.0' until then)
// ---------------------------------------------------------------------------
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.0.0';

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

interface KeybindingDeclaration {
  command: string;
  key: string;
  mac?: string;
}

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: string;
  quipuVersion: string;
  fileTypes?: string[];
  sizeHint?: string;
  contributes?: {
    keybindings?: KeybindingDeclaration[];
  };
}

interface PluginsConfig {
  plugins: Array<{ id: string; enabled: boolean }>;
}

// ---------------------------------------------------------------------------
// Public service interface
// ---------------------------------------------------------------------------

export interface PluginLoadResult {
  loaded: { id: string; name: string }[];
  errors: { id: string; reason: string }[];
}

export type { KeybindingEntry } from '../extensions/keybindingRegistry';

export interface PluginLoaderOptions {
  /**
   * Called for each valid keybinding declaration in a plugin's manifest after
   * init() completes. Provided by App.tsx once keybindingRegistry (U6) exists.
   */
  registerKeybinding?: (entry: KeybindingEntry) => void;
  /**
   * Override the Blob URL dynamic import. Used in tests to avoid real ES module
   * imports which aren't supported in jsdom.
   */
  _importFromBlobUrl?: (source: string) => Promise<unknown>;
}

export interface PluginLoaderService {
  loadAll(api: PluginApi, options?: PluginLoaderOptions): Promise<PluginLoadResult>;
}

// ---------------------------------------------------------------------------
// createPluginApi factory
// ---------------------------------------------------------------------------

interface PluginApiFactoryParams {
  register: (descriptor: ExtensionDescriptor) => void;
  registerPanel: (descriptor: PanelDescriptor) => void;
  registerCommand: (id: string, handler: PluginCommandHandler, options?: PluginCommandOptions) => void;
  executeCommand: (id: string, ...args: unknown[]) => void;
  services: PluginApi['services'];
}

/**
 * Constructs the PluginApi object passed to each plugin's init() function.
 * Called by App.tsx once all registries are available.
 */
export function createPluginApi(params: PluginApiFactoryParams): PluginApi {
  return {
    register: params.register,
    registerPanel: params.registerPanel,
    commands: {
      register: params.registerCommand,
      execute: params.executeCommand,
    },
    services: params.services,
    React: React as PluginApi['React'],
    ReactDOM: ReactDOM as PluginApi['ReactDOM'],
  };
}

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REQUIRED_FIELDS: (keyof PluginManifest)[] = [
  'id',
  'name',
  'version',
  'description',
  'entry',
  'quipuVersion',
];

export type ManifestValidationResult =
  | { valid: true; manifest: PluginManifest }
  | { valid: false; reason: string };

export function validateManifest(raw: unknown): ManifestValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'manifest.json is not a JSON object' };
  }
  const data = raw as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (typeof data[field] !== 'string' || !(data[field] as string).trim()) {
      return { valid: false, reason: `manifest.json missing required field: "${field}"` };
    }
  }

  const manifest = data as unknown as PluginManifest;

  if (!PLUGIN_ID_RE.test(manifest.id)) {
    return {
      valid: false,
      reason: `manifest.json "id" must match ^[a-z0-9][a-z0-9-]{0,63}$ (got "${manifest.id}")`,
    };
  }

  if (!semver.validRange(manifest.quipuVersion)) {
    return {
      valid: false,
      reason: `manifest.json "quipuVersion" is not a valid semver range: "${manifest.quipuVersion}"`,
    };
  }

  if (!semver.satisfies(APP_VERSION, manifest.quipuVersion)) {
    return {
      valid: false,
      reason: `plugin requires quipu ${manifest.quipuVersion} but host is ${APP_VERSION}`,
    };
  }

  return { valid: true, manifest };
}

// ---------------------------------------------------------------------------
// Blob URL dynamic import (exported so tests can spy on it)
// ---------------------------------------------------------------------------

/**
 * Wraps a plugin source string in a Blob URL, dynamically imports it,
 * and revokes the URL immediately after import resolves.
 */
export async function importFromBlobUrl(source: string): Promise<unknown> {
  const blob = new Blob([source], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// isElectron detection
// ---------------------------------------------------------------------------

export function isElectron(): boolean {
  return !!(window.electronAPI && window.electronAPI.readPluginsConfig);
}

// ---------------------------------------------------------------------------
// Electron adapter
// ---------------------------------------------------------------------------

const electronPluginLoader: PluginLoaderService = {
  async loadAll(api: PluginApi, options: PluginLoaderOptions = {}): Promise<PluginLoadResult> {
    const loaded: PluginLoadResult['loaded'] = [];
    const errors: PluginLoadResult['errors'] = [];
    const doImport = options._importFromBlobUrl ?? importFromBlobUrl;

    // 1. Read plugins config
    let configJson: string | null;
    try {
      configJson = await window.electronAPI!.readPluginsConfig();
    } catch (err) {
      return { loaded, errors };
    }

    if (configJson === null) {
      // No plugins.json — first-run wizard handles this; nothing to load
      return { loaded, errors };
    }

    let config: PluginsConfig;
    try {
      config = JSON.parse(configJson) as PluginsConfig;
      if (!config || !Array.isArray(config.plugins)) {
        return { loaded, errors };
      }
    } catch {
      return { loaded, errors };
    }

    // 2. Load each enabled plugin
    const quipuDir = await window.electronAPI!.getQuipuDir();

    for (const entry of config.plugins) {
      const { id, enabled } = entry;
      if (!enabled) continue;

      try {
        // 2a. Read and validate manifest
        const manifestPath = `${quipuDir}/plugins/${id}/manifest.json`;
        const manifestRaw = await window.electronAPI!.readFile(manifestPath);
        if (manifestRaw === null) {
          errors.push({ id, reason: `manifest.json not found at ${manifestPath}` });
          continue;
        }

        let manifestData: unknown;
        try {
          manifestData = JSON.parse(manifestRaw);
        } catch {
          errors.push({ id, reason: 'manifest.json is not valid JSON' });
          continue;
        }

        const validation = validateManifest(manifestData);
        if (!validation.valid) {
          errors.push({ id, reason: validation.reason });
          continue;
        }
        const { manifest } = validation;

        // 2b. Read plugin source
        const entryPath = `${quipuDir}/plugins/${id}/${manifest.entry}`;
        const source = await window.electronAPI!.readFile(entryPath);
        if (source === null) {
          errors.push({ id, reason: `plugin entry not found: ${entryPath}` });
          continue;
        }

        // 2c. Import via Blob URL and call init(api)
        let mod: unknown;
        try {
          mod = await doImport(source);
        } catch (err) {
          errors.push({
            id,
            reason: `failed to import plugin: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }

        try {
          const pluginModule = mod as { init?: (api: PluginApi) => void };
          if (typeof pluginModule.init !== 'function') {
            errors.push({ id, reason: 'plugin bundle does not export an init() function' });
            continue;
          }
          pluginModule.init(api);
        } catch (err) {
          errors.push({
            id,
            reason: `plugin init() threw: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }

        // 2d. Register keybindings from manifest contributes
        const keybindings = manifest.contributes?.keybindings ?? [];
        if (options.registerKeybinding) {
          for (const kb of keybindings) {
            if (!kb.command || !kb.key) continue; // skip malformed entries silently
            options.registerKeybinding({ key: kb.key, mac: kb.mac, commandId: kb.command });
          }
        }

        loaded.push({ id, name: manifest.name });
      } catch (err) {
        // Catch-all: isolate unexpected errors so one broken plugin can't crash the loop
        errors.push({
          id,
          reason: `unexpected error loading plugin: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return { loaded, errors };
  },
};

// ---------------------------------------------------------------------------
// Browser stub (no-op — browser mode plugin support is deferred)
// ---------------------------------------------------------------------------

const browserPluginLoader: PluginLoaderService = {
  loadAll(): Promise<PluginLoadResult> {
    return Promise.resolve({ loaded: [], errors: [] });
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const pluginLoader: PluginLoaderService = isElectron() ? electronPluginLoader : browserPluginLoader;
export default pluginLoader;
