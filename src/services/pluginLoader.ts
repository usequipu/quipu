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

export interface PluginsConfigEntry {
  id: string;
  enabled: boolean;
}

export interface PluginsConfig {
  plugins: PluginsConfigEntry[];
}

// ---------------------------------------------------------------------------
// Public service interface
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// React proxy blob URLs — created once, reused across all plugins.
// Redirects plugin's `import from 'react'` to the host React instance so
// all hooks share the same dispatcher (prevents "Invalid hook call").
// ---------------------------------------------------------------------------

let _reactProxy: string | null = null;
let _reactDomProxy: string | null = null;
let _jsxProxy: string | null = null;

async function ensureReactProxies(hostApi: PluginApi): Promise<void> {
  if (_reactProxy) return;

  const jsxRuntime = await import('react/jsx-runtime') as Record<string, unknown>;
  (globalThis as Record<string, unknown>).__quipuReact    = hostApi.React;
  (globalThis as Record<string, unknown>).__quipuReactDOM = hostApi.ReactDOM;
  (globalThis as Record<string, unknown>).__quipuJsx      = jsxRuntime;

  _reactProxy = URL.createObjectURL(new Blob([
    `const R=globalThis.__quipuReact;export default R;
export const{useState,useEffect,useCallback,useMemo,useRef,useContext,
createContext,createElement,forwardRef,memo,lazy,Suspense,Fragment,
Component,PureComponent,Children,cloneElement,isValidElement,createRef,
startTransition,useTransition,useDeferredValue,useId,useInsertionEffect,
useLayoutEffect,useImperativeHandle,useReducer,useSyncExternalStore,
useDebugValue,Profiler,StrictMode,version,use}=R;`,
  ], { type: 'application/javascript' }));

  _reactDomProxy = URL.createObjectURL(new Blob([
    `const RD=globalThis.__quipuReactDOM;export default RD;
export const{createPortal,flushSync,unstable_batchedUpdates,version,
findDOMNode,render,hydrate,unmountComponentAtNode,
preconnect,prefetchDNS,preinit,preinitModule,preload,preloadModule,
requestFormReset,useFormState,useFormStatus}=RD;`,
  ], { type: 'application/javascript' }));

  _jsxProxy = URL.createObjectURL(new Blob([
    `const J=globalThis.__quipuJsx;
export const jsx=J.jsx,jsxs=J.jsxs,Fragment=J.Fragment;`,
  ], { type: 'application/javascript' }));
}

/**
 * Loads a plugin from its ESM source string.
 *
 * For plugins built with react/react-dom externalized (v0.1.1+), rewrites
 * their import specifiers to proxy blob URLs that forward to the host React
 * instance, preventing the two-React-instances hook failure.
 *
 * Legacy plugins that bundle their own React load as-is via blob URL.
 */
export async function importFromBlobUrl(source: string, hostApi?: PluginApi): Promise<unknown> {
  // Polyfill `process` for libraries like Excalidraw that reference it.
  if (typeof (globalThis as Record<string, unknown>).process === 'undefined') {
    (globalThis as Record<string, unknown>).process = {
      env: { NODE_ENV: 'production' }, browser: true, version: '',
    };
  }

  let patchedSource = source;

  // Polyfill CJS `exports` for plugins whose bundled dependencies reference it.
  // Rollup sometimes emits `exports.xxx = ...` helpers inside ESM bundles when
  // inlining CJS packages; injecting a local var keeps the module from throwing.
  if (/\bexports\b/.test(patchedSource)) {
    patchedSource = 'var exports = {};\n' + patchedSource;
  }

  // If plugin imports react externally, redirect to host React proxies.
  if (hostApi && /from\s*['"]react['"]|from\s*['"]react\//.test(source)) {
    await ensureReactProxies(hostApi);
    patchedSource = patchedSource
      .replace(/(['"])react\/jsx-runtime\1/g, `'${_jsxProxy}'`)
      .replace(/(['"])react-dom\/client\1/g,  `'${_reactDomProxy}'`)
      .replace(/(['"])react-dom\1/g,          `'${_reactDomProxy}'`)
      .replace(/(['"])react\1/g,              `'${_reactProxy}'`);
  }

  const blob = new Blob([patchedSource], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
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
    const doImport = options._importFromBlobUrl ?? ((src: string) => importFromBlobUrl(src, api));

    // 1. Read plugins config
    let configJson: string | null;
    try {
      configJson = await window.electronAPI!.readPluginsConfig();
    } catch {
      return { loaded, errors, firstRun: false };
    }

    if (configJson === null) {
      // No plugins.json — first-run wizard handles this; nothing to load yet.
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

    return { loaded, errors, firstRun: false };
  },
};

// ---------------------------------------------------------------------------
// Browser stub (no-op — browser mode plugin support is deferred)
// ---------------------------------------------------------------------------

const browserPluginLoader: PluginLoaderService = {
  loadAll(): Promise<PluginLoadResult> {
    return Promise.resolve({ loaded: [], errors: [], firstRun: false });
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const pluginLoader: PluginLoaderService = isElectron() ? electronPluginLoader : browserPluginLoader;
export default pluginLoader;
