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

const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.0.0';

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

export interface PluginsConfigEntry {
  id: string;
  enabled: boolean;
}

export interface PluginsConfig {
  plugins: PluginsConfigEntry[];
}

export interface PluginLoadResult {
  loaded: { id: string; name: string }[];
  errors: { id: string; reason: string }[];
  /** True when plugins.json did not exist — signals App.tsx to show the first-run wizard. */
  firstRun: boolean;
}

export type { KeybindingEntry } from '../extensions/keybindingRegistry';

export interface PluginLoaderOptions {
  /**
   * Called for each valid keybinding declaration in a plugin's manifest after
   * init() completes. Provided by App.tsx once keybindingRegistry (U6) exists.
   */
  registerKeybinding?: (entry: KeybindingEntry) => void;
  /**
   * Override the dynamic import. Tests pass a stub because jsdom cannot
   * resolve `quipu-plugin://` URLs. Production resolves via the Electron
   * protocol handler (see electron/main.cjs).
   */
  _importPlugin?: (url: string) => Promise<unknown>;
}

export interface PluginLoaderService {
  loadAll(api: PluginApi, options?: PluginLoaderOptions): Promise<PluginLoadResult>;
}

interface PluginApiFactoryParams {
  register: (descriptor: ExtensionDescriptor) => void;
  registerPanel: (descriptor: PanelDescriptor) => void;
  registerCommand: (id: string, handler: PluginCommandHandler, options?: PluginCommandOptions) => void;
  executeCommand: (id: string, ...args: unknown[]) => void;
  services: PluginApi['services'];
}

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

// Expose the host's React to `quipu-runtime://` proxy modules. The main-process
// protocol handler generates the proxy code; it reads from these globals at
// import time so every plugin shares the host's single React instance and
// hook dispatcher.
let _reactGlobalsInstalled = false;
async function ensureReactGlobals(hostApi: PluginApi): Promise<void> {
  if (_reactGlobalsInstalled) return;
  const jsxRuntime = (await import('react/jsx-runtime')) as Record<string, unknown>;
  const g = globalThis as Record<string, unknown>;
  g.__quipuReact = hostApi.React;
  g.__quipuReactDOM = hostApi.ReactDOM;
  g.__quipuJsx = jsxRuntime;
  _reactGlobalsInstalled = true;
}

export function isElectron(): boolean {
  return !!(window.electronAPI && window.electronAPI.readPluginsConfig);
}

function pluginEntryUrl(pluginId: string, entry: string): string {
  const cleaned = entry.replace(/^\/+/, '');
  return `quipu-plugin://${pluginId}/${cleaned}`;
}

const electronPluginLoader: PluginLoaderService = {
  async loadAll(api: PluginApi, options: PluginLoaderOptions = {}): Promise<PluginLoadResult> {
    const loaded: PluginLoadResult['loaded'] = [];
    const errors: PluginLoadResult['errors'] = [];
    const doImport = options._importPlugin ?? ((url: string) => import(/* @vite-ignore */ url));

    let configJson: string | null;
    try {
      configJson = await window.electronAPI!.readPluginsConfig();
    } catch {
      return { loaded, errors, firstRun: false };
    }

    if (configJson === null) {
      return { loaded, errors, firstRun: true };
    }

    let config: PluginsConfig;
    try {
      config = JSON.parse(configJson) as PluginsConfig;
      if (!config || !Array.isArray(config.plugins)) {
        return { loaded, errors, firstRun: false };
      }
    } catch {
      return { loaded, errors, firstRun: false };
    }

    const quipuDir = await window.electronAPI!.getQuipuDir();

    await ensureReactGlobals(api);

    for (const entry of config.plugins) {
      const { id, enabled } = entry;
      if (!enabled) continue;

      try {
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

        // Pre-flight existence check so "entry not found" fails cleanly before
        // dynamic-import surfaces a generic fetch error.
        const entryPath = `${quipuDir}/plugins/${id}/${manifest.entry}`;
        const entryExists = await window.electronAPI!.pathExists(entryPath);
        if (!entryExists) {
          errors.push({ id, reason: `plugin entry not found: ${entryPath}` });
          continue;
        }

        let mod: unknown;
        try {
          mod = await doImport(pluginEntryUrl(id, manifest.entry));
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

        const keybindings = manifest.contributes?.keybindings ?? [];
        if (options.registerKeybinding) {
          for (const kb of keybindings) {
            if (!kb.command || !kb.key) continue;
            options.registerKeybinding({ key: kb.key, mac: kb.mac, commandId: kb.command });
          }
        }

        loaded.push({ id, name: manifest.name });
      } catch (err) {
        errors.push({
          id,
          reason: `unexpected error loading plugin: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return { loaded, errors, firstRun: false };
  },
};

const browserPluginLoader: PluginLoaderService = {
  loadAll(): Promise<PluginLoadResult> {
    return Promise.resolve({ loaded: [], errors: [], firstRun: false });
  },
};

const pluginLoader: PluginLoaderService = isElectron() ? electronPluginLoader : browserPluginLoader;
export default pluginLoader;
