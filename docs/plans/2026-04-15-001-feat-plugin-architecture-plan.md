---
title: "feat: Plugin-Based Architecture"
type: feat
status: active
date: 2026-04-15
origin: docs/brainstorms/2026-04-11-plugin-architecture-requirements.md
---

# feat: Plugin-Based Architecture

## Overview

Extract Quipu's viewer extensions into independently distributed plugins loaded from `~/.quipu/plugins/` at startup. Add VS Code-style extensibility: plugin-registered sidebar panels, a global command registry, and manifest-declared keybindings. Ship a first-run wizard and a plugin manager panel for install/uninstall/update.

## Problem Frame

All viewer extensions (pdf-viewer, code-viewer, mermaid-viewer, media-viewer, excalidraw-viewer, notebook, diff-viewer) are statically bundled into the core app. Monaco (~4 MB), Excalidraw (~3 MB), react-pdf, and mermaid inflate the bundle regardless of usage. Every viewer releases on the same cadence as core. There is no mechanism for users to install only what they need or for plugin authors to ship updates independently.

**Scope boundary:** This plan covers the host-side plugin infrastructure — loading, registries, first-run wizard, plugin manager. Extraction of each viewer to a separate GitHub repo is a follow-on effort per plugin. Static viewer imports in `src/extensions/index.ts` are NOT removed in this PR; they are removed per-plugin as external plugin repos are published and confirmed working. The database viewer stays in core permanently (see origin document §Key Decisions).

## Requirements Trace

| Req | Unit | Summary |
|-----|------|---------|
| R1 | U3 | Read `~/.quipu/plugins.json` at startup |
| R2 | U3 | Blob URL dynamic import via `electronAPI.readFile()` |
| R3 | U2, U3 | `init(api)` export pattern + api object factory |
| R4 | U7 | Existing `resolveViewer()` / `registerExtension()` interface unchanged |
| R5 | U3 | Load error isolation + warning toasts |
| R6 | U3 | semver range evaluation for `quipuVersion` |
| R7, R7b | U3 | Manifest fields including `contributes.keybindings` |
| R8 | U3 | Manifest schema validation + id regex |
| R9, R9b | U2 | Full api object: register, registerPanel, commands, services, React, ReactDOM |
| R10 | U2 | `plugin-types.d.ts` TypeScript definitions |
| R10b | U2, U7 | Extended viewer props (workspacePath, showToast); plugins bundle own file-type utils |
| R12–R16 | U9 | First-Run Wizard |
| R17–R22b | U9 | Plugin Manager panel |
| R25–R26 | U8 | Plugin registry service + 1-hour cache |
| R27, R28 | — | Static import removal + npm dep removal (deferred; per-plugin follow-on) |
| R29 | U7 | database-viewer stays in core |
| R30 | — | Registry public interface unchanged (no work needed) |
| R31 | U3 | `pluginLoader` service |
| R32 | U1 | Electron IPC handlers for plugin config, download, extract, remove |
| R33 | U3 | Blob URL loading in renderer |
| R34 | U3 | Browser mode no-op stub |
| R35 | U4 | Panel registry + dynamic ActivityBar |
| R36 | U5 | Command registry + extensible QuickOpen |
| R37 | U6 | Keybinding contributions from manifest |

## Scope Boundaries

- **In scope:** Plugin loading infrastructure, panel/command/keybinding registries, first-run wizard, plugin manager, DiffViewer migration to registry pattern.
- **Out of scope:** Extraction of any viewer to a separate GitHub repo (follow-on per plugin). Removal of `react-pdf`, `@excalidraw/excalidraw`, `mermaid`, `@monaco-editor/react` from `package.json` (per-plugin follow-on). Plugin sandboxing, hot-reload, plugin inter-communication, community marketplace, browser-mode plugin loading (stub only).

## Context & Research

### Relevant Code and Patterns

**Extension registry** (`src/extensions/registry.ts`): module-level mutable array sorted by `priority` descending. Exports `registerExtension()`, `resolveViewer()`, `getExtensionForTab()`, `getCommandsForTab()`. All four new registries (panel, command, keybinding) follow this exact pattern. Interface unchanged (R4, R30).

**ExtensionDescriptor** (`src/types/extensions.ts`): `{ id, canHandle, priority, component: ComponentType<any>, commands?, onSave?, onSnapshot? }`. The `component` is already typed `any` — no type change needed in the host for extended props.

**ActivityBar** (`src/components/ui/ActivityBar.tsx`): module-level `PANELS: PanelDef[]` constant with closed `PanelId = "explorer" | "search" | "git"` union at line 11. The `gitChangeCount` badge is special-cased at line 71 for `panel.id === "git"`. Both the type and the badge logic must be generalized.

**QuickOpen** (`src/components/ui/QuickOpen.tsx`): reads from `import { commands } from '@/data/commands'` — static array of 24 `Command` entries with shape `{ label, shortcut?, action, category }`. The `action` string is dispatched by `handleMenuAction` in App.tsx. Plugin commands integrate alongside but not by replacing this.

**App.tsx** — three coupling points to address:
- Line 26: `import DiffViewer from './extensions/diff-viewer/DiffViewer'` (direct, not registry)
- Line 73: `PanelId = 'explorer' | 'search' | 'git'` closed union
- Lines 267–352: monolithic `keydown` useEffect handler
- Lines 829–831: hardcoded panel rendering (`activePanel === 'explorer'` / `'search'` / `'git'`)
- Lines 851–856: DiffViewer rendered via `activeDiff` state overlay

**Dual-runtime adapter pattern** (`src/services/fileSystem.ts`): `isElectron()` checks `!!(window.electronAPI && window.electronAPI.readDirectory)`. Module-load-time selection: `const fs = isElectron() ? electronFS : browserFS`. `pluginLoader.ts` follows this identically.

**Electron IPC**: `read-file` handler (main.cjs line 325) returns UTF-8 string or `null` on ENOENT — already the right shape for plugin source loading. Preload exposes `readFile` at line 23. Six new handlers are needed for plugin management.

**Existing npm packages relevant to extraction:** `@excalidraw/excalidraw ^0.18.0`, `mermaid ^11.14.0`, `@monaco-editor/react ^4.7.0`, `react-pdf ^10.4.1` are all present. `semver` is NOT installed — must be added.

### Institutional Learnings

- **Priority contract in extension registry**: `canHandle` + `priority` ordering is load-bearing. Plugin-registered viewers must declare `priority` explicitly — they must be inserted before the catch-all TipTap editor fallback or files silently open in the wrong viewer.
- **Dual-runtime 4-place rule**: Every new backend feature requires changes in 4 places (Go server, Electron IPC, preload, service adapter). The plugin loader's browser stub (R34) counts as the browser adapter — the Go server needs no plugin endpoint in v1.
- **IPC null-on-ENOENT contract**: IPC handlers return `null` for missing files, throw only for unexpected errors. Plugin manifest + bundle reads must follow this contract — missing plugin → `null` → skip gracefully.
- **Single command source of truth**: Commands from MenuBar and QuickOpen must flow from one registry. Plugin commands pushed into a separate list won't appear in Ctrl+P. The commandRegistry must be the source QuickOpen reads from, merged with the static array.
- **Sidebar panel → main area callback pattern**: Panels that trigger main-area views (like DiffViewer) use prop callbacks (`onOpenDiff`-style), not direct context mutation. Plugin panels follow the same contract — emit events via `api.commands.execute()`, App.tsx owns the resulting state.

## High-Level Technical Design

### Plugin Loading Flow (startup)

```
App.tsx useEffect (on mount)
  │
  └─ pluginLoader.loadAll(api)               [src/services/pluginLoader.ts]
       │
       ├─ electronAPI.readPluginsConfig()    → null if first run
       │
       └─ For each enabled plugin entry:
            │
            ├─ readFile(.quipu/plugins/<id>/manifest.json)
            ├─ validate: schema + id regex + semver quipuVersion
            │   └─ invalid → collect error, skip
            │
            ├─ readFile(.quipu/plugins/<id>/index.js)
            ├─ Blob → URL.createObjectURL → import(blobUrl) → revokeObjectURL
            │
            ├─ mod.init(api)                [wrapped in try/catch]
            │   ├─ api.register(descriptor)      → extensionRegistry (R4)
            │   ├─ api.registerPanel(descriptor) → panelRegistry (R35)
            │   └─ api.commands.register(...)    → commandRegistry (R36)
            │
            └─ manifest.contributes?.keybindings → keybindingRegistry (R37)

  └─ { loaded, errors }
       └─ errors → showToast('warning') for each (R5)
```

### Plugin API shape (directional — not implementation specification)

```typescript
interface PluginApi {
  register: (descriptor: ExtensionDescriptor) => void;
  registerPanel: (descriptor: PanelDescriptor) => void;
  commands: {
    register: (id: string, handler: PluginCommandHandler, options?: PluginCommandOptions) => void;
    execute: (id: string, ...args: unknown[]) => void;
  };
  services: {
    fileSystem: FileSystemService;
    gitService: GitService;
    kernelService: KernelService;
    terminalService: TerminalService;
  };
  React: typeof React;
  ReactDOM: typeof ReactDOM;
}
```

### Registry Architecture

Four registries — new ones follow the exact module-level mutable array + exported accessor pattern of `src/extensions/registry.ts`:

```
src/extensions/
  registry.ts           # existing — ExtensionDescriptor[] (unchanged)
  panelRegistry.ts      # new — PanelDescriptor[]
  commandRegistry.ts    # new — PluginCommand[]
  keybindingRegistry.ts # new — KeybindingEntry[]
```

## Key Technical Decisions

- **`adm-zip` for zip extraction** (Electron main process): CommonJS-compatible, simpler API than `yauzl`. Zip slip protection mandatory — canonicalize each entry path, reject entire archive if any entry escapes `~/.quipu/plugins/<id>/`. (See origin Outstanding Questions: R20.)
- **`semver` npm package for range evaluation** (R6): not currently installed; added to dependencies. Imported only in the Electron plugin loader path.
- **DiffViewer becomes a registry extension**: Currently a direct App.tsx import rendered via `activeDiff` overlay. It must become an `ExtensionDescriptor` with `canHandle: tab => tab.type === 'diff'` so `quipu-plugin-git` can later extract it cleanly. The `activeDiff` state overlay is removed; diff tabs are opened via a built-in `'diff.open'` command.
- **SourceControlPanel registered in panelRegistry.ts as a built-in until `quipu-plugin-git` is published**: Avoids breaking the git panel during infrastructure migration. Registration moves to the plugin when extraction happens.
- **Plugin commands have `id` + `handler`; static commands have `action` string**: No collision possible. QuickOpen merges both; handler-based commands are called directly, action-based ones go through `handleMenuAction`.
- **Built-in keybindings take precedence**: The keydown handler checks built-ins first and returns early. `resolveKeybinding()` is called only after all built-ins pass.
- **Plugin panels use Phosphor icon name strings (not imported components)**: Host renders the icon from a name→component map. Plugins don't need to bundle Phosphor. Map starts with built-in icons; grows as official plugins are extracted.
- **PluginManager is a built-in panel (not a plugin)**: Bootstrapping circular dependency — you need the manager to install plugins, so it can't itself be a plugin.
- **Static viewer imports NOT removed in this PR**: Removing without published replacement plugins breaks those file types. This is explicitly a per-plugin follow-on step.
- **APP_VERSION from env**: Add `define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version) }` to `vite.config.ts` for semver range evaluation.

## Open Questions

### Resolved During Planning

- **Blob URL vs file:// vs custom protocol**: Blob URL via `electronAPI.readFile()` — file:// is blocked by contextIsolation, custom protocol requires config changes. (See origin Key Decisions.)
- **Init pattern**: `init(api)` export — avoids `window.__quipu*` globals that TerminalContext was built to eliminate.
- **Zip library**: `adm-zip` — see above.
- **DiffViewer migration approach**: Tab-based registry extension (not overlay state) — enables clean extraction to `quipu-plugin-git`.
- **Command dispatch**: Plugin commands use direct handler calls; static commands use `action` string through `handleMenuAction`. No unified refactor needed.

### Deferred to Implementation

- **Blob URL import in production Electron build**: verify `import(URL.createObjectURL(blob))` works in the packaged app. The renderer has no `sandbox: true` — should work, but confirm before U7.
- **Download mechanism in Electron main**: `net.request` (follows session proxy) vs Node.js `https` module. Prefer `net.request` for proxy support; decide at implementation time.
- **Plugin registry URL**: `PLUGIN_REGISTRY_URL` constant is a placeholder; the actual GitHub Pages URL is determined when `quipu-plugins` repo is created (origin R26).
- **ActivityBar icon map completeness**: Start with 3 built-in icons; add more as official plugins are extracted.
- **React/ReactDOM externalization in plugin Vite builds**: `external: ['react', 'react-dom']` in each plugin repo's Vite lib config — a plugin repo concern, not a core concern.

## Implementation Units

- [ ] **U1: Electron IPC for Plugin Management**

**Goal:** Add IPC handlers for reading/writing plugin config, downloading/extracting plugin zips, removing plugin directories, and listing plugin dirs. Add `semver` and `adm-zip` to dependencies.

**Requirements:** R32

**Dependencies:** None

**Files:**
- Modify: `package.json` — add `semver`, `@types/semver`, `adm-zip`, `@types/adm-zip` to dependencies
- Modify: `electron/main.cjs` — add 6 IPC handlers inside `app.whenReady().then(...)`
- Modify: `electron/preload.cjs` — expose 6 new methods on `electronAPI` via contextBridge

**New IPC handlers (`electron/main.cjs`):**

| Channel | Input | Output | Notes |
|---|---|---|---|
| `read-plugins-config` | — | `string \| null` | Read `~/.quipu/plugins.json`; ENOENT → null |
| `write-plugins-config` | `content: string` | `{ success: true }` | Write `~/.quipu/plugins.json`; mkdir `~/.quipu` if missing |
| `download-and-extract-plugin` | `{ id: string, downloadUrl: string }` | `{ success: true } \| { error: string }` | Download zip, extract to `~/.quipu/plugins/<id>/` with zip slip check |
| `remove-plugin-dir` | `id: string` | `{ success: true }` | `fs.rmSync(~/.quipu/plugins/<id>/, { recursive: true })` |
| `list-plugin-dirs` | — | `string[]` | `fs.readdirSync(~/.quipu/plugins/)` dir names; `[]` if missing |
| `get-quipu-dir` | — | `string` | `os.homedir() + '/.quipu'` |

**Zip slip protection** (mandatory in `download-and-extract-plugin`): For each entry in the archive, resolve `path.resolve(destDir, entryPath)` and verify it starts with `path.resolve(destDir) + path.sep`. Reject the entire archive (do not extract any entry) if any entry fails.

**Preload additions** (alongside existing `electronAPI` methods):
`readPluginsConfig`, `writePluginsConfig`, `downloadAndExtractPlugin`, `removePluginDir`, `listPluginDirs`, `getQuipuDir`

**Test scenarios:**
- `read-plugins-config` returns `null` when `~/.quipu/plugins.json` does not exist (ENOENT → null, not throw)
- `read-plugins-config` returns file content string when file present
- `write-plugins-config` creates `~/.quipu/` directory if it does not exist before writing
- `download-and-extract-plugin` rejects any archive containing a `../` path traversal entry and extracts nothing
- `download-and-extract-plugin` extracts a valid zip with `manifest.json` + `index.js` to the correct directory
- `list-plugin-dirs` returns `[]` when `~/.quipu/plugins/` does not exist

---

- [ ] **U2: Plugin API Types**

**Goal:** Define all public types needed by plugin authors and the host's `api` object factory.

**Requirements:** R9, R9b, R10, R10b

**Dependencies:** None (types only)

**Files:**
- Create: `src/types/plugin-types.d.ts`

**What to define:**
- `PluginApi` (full shape: `register`, `registerPanel`, `commands.register`, `commands.execute`, `services`, `React`, `ReactDOM`)
- `PanelDescriptor`: `{ id: string; label: string; icon: string; component: ComponentType; order?: number; badge?: () => number | null }`
- `PluginCommandHandler`: `(...args: unknown[]) => void`
- `PluginCommandOptions`: `{ label: string; category: string; shortcut?: string }`
- `PluginCommand`: `{ id: string; handler: PluginCommandHandler; label: string; category: string; shortcut?: string }`
- `ExtendedViewerProps`: `{ workspacePath: string; showToast: (msg: string, type: 'error' | 'warning' | 'success' | 'info') => void }` — the additional props plugins receive alongside existing `{ tab, activeFile, onContentChange, isActive }`
- Service interface stubs (import and re-export or reference `FileSystemService`, `GitService`, `KernelService`, `TerminalService` from their respective service files)
- `icon` in `PanelDescriptor` is a Phosphor icon name string — the host renders the icon component; plugins do not import Phosphor

**Test scenarios:**
- `npx tsc --noEmit` passes with no new errors after adding the file (types-only unit)

---

- [ ] **U3: Plugin Loader Service (dual-runtime)**

**Goal:** Implement the `pluginLoader` service — Electron adapter loads plugins from disk via Blob URL; browser adapter is a no-op stub.

**Requirements:** R1, R2, R3, R5, R6, R7, R7b, R8, R31, R33, R34

**Dependencies:** U1 (IPC handlers), U2 (PluginApi type)

**Files:**
- Create: `src/services/pluginLoader.ts`
- Create: `src/services/pluginLoader.test.ts`

**Interface:**
```typescript
interface PluginLoaderService {
  loadAll(api: PluginApi): Promise<PluginLoadResult>;
}
interface PluginLoadResult {
  loaded: { id: string; name: string }[];
  errors: { id: string; reason: string }[];
}
```

**Electron adapter — `loadAll` behavior:**
1. Call `electronAPI.readPluginsConfig()` → parse JSON → `{ plugins: { id, enabled }[] }`
2. If result is `null`: return `{ loaded: [], errors: [] }` — first-run wizard (U9) handles first launch separately
3. For each plugin where `enabled === true`:
   - Read + parse `manifest.json` via `electronAPI.readFile(quipuDir + '/plugins/' + id + '/manifest.json')`
   - Validate manifest: required fields present (`id`, `name`, `version`, `description`, `entry`, `quipuVersion`); id matches `^[a-z0-9][a-z0-9-]{0,63}$`
   - Evaluate `semver.satisfies(APP_VERSION, manifest.quipuVersion)` — skip with warning if false
   - Read plugin source via `electronAPI.readFile(quipuDir + '/plugins/' + id + '/' + manifest.entry)`
   - `const blob = new Blob([source], { type: 'application/javascript' })`
   - `const blobUrl = URL.createObjectURL(blob)`
   - `const mod = await import(blobUrl)` — wrapped in try/catch
   - `URL.revokeObjectURL(blobUrl)` (immediately after import resolves)
   - Call `mod.init(api)` — wrapped in try/catch
   - Read `manifest.contributes?.keybindings ?? []` → call `registerKeybinding()` for each valid entry (entries missing `command` or `key` are silently skipped)
   - On any error at any step: `errors.push({ id, reason: err.message })`, continue to next plugin

**Browser adapter:** `loadAll` returns `Promise.resolve({ loaded: [], errors: [] })` immediately.

**Module-load selection** (follow `src/services/fileSystem.ts` pattern exactly):
```typescript
const pluginLoader: PluginLoaderService = isElectron() ? electronPluginLoader : browserPluginLoader;
export default pluginLoader;
```

**`APP_VERSION`**: read from `import.meta.env.VITE_APP_VERSION` (added to `vite.config.ts` in U7).

**`createPluginApi` factory**: implement alongside the loader (not exported as public API). Constructs the `PluginApi` object from `{ register, registerPanel, executeCommand, registerCommand, services, React, ReactDOM }` parameters. Called from App.tsx when invoking `loadAll`.

**Test scenarios** (unit tests with mocked `window.electronAPI`):
- Missing `plugins.json` (readPluginsConfig returns null): returns `{ loaded: [], errors: [] }`
- Browser mode (no `electronAPI`): returns `{ loaded: [], errors: [] }`
- Plugin with id `my_plugin` (underscore): skipped, error collected, reason mentions id validation
- Plugin with `quipuVersion: "^99.0.0"`: skipped, error collected, reason mentions version mismatch
- Plugin manifest missing `entry` field: skipped, error collected
- Plugin whose `init()` throws `new Error('boom')`: skipped, error collected, next plugin in list still loads successfully
- Valid plugin: `mod.init` called with `api` object; `{ id, name }` appears in `loaded` list

---

- [ ] **U4: Panel Registry + Dynamic ActivityBar**

**Goal:** Replace ActivityBar's hardcoded panel list and closed PanelId union with a dynamic registry. Built-in panels (Explorer, Search, SourceControl) are registered at module load.

**Requirements:** R35

**Dependencies:** U2 (PanelDescriptor type)

**Files:**
- Create: `src/extensions/panelRegistry.ts`
- Modify: `src/components/ui/ActivityBar.tsx`
- Modify: `src/App.tsx`

**`panelRegistry.ts`** (follow `src/extensions/registry.ts` pattern):
- Module-level `panels: PanelDescriptor[]`, sorted by `order` ascending
- `registerPanel(descriptor: PanelDescriptor): void` — appends + re-sorts
- `getRegisteredPanels(): PanelDescriptor[]` — returns shallow copy
- Register built-in panels at module load:
  - `{ id: 'explorer', label: 'Explorer', icon: 'FilesIcon', component: FileExplorer, order: 0 }`
  - `{ id: 'search', label: 'Search', icon: 'MagnifyingGlassIcon', component: SearchPanel, order: 1 }`
  - `{ id: 'git', label: 'Source Control', icon: 'GitBranchIcon', component: SourceControlPanel, order: 2, badge: () => gitChangeCount }` — temporary until `quipu-plugin-git` extracts it; `gitChangeCount` is accessed via a getter function passed at registration
  - `{ id: 'plugin-manager', label: 'Plugins', icon: 'PuzzlePieceIcon', component: PluginManager, order: 99 }` — registered after U9 creates the component

**ActivityBar.tsx changes:**
- Remove `PanelId` closed union (line 11) and `PANELS` constant (line 24)
- Accept `panels: PanelDescriptor[]` as prop
- Maintain a `PHOSPHOR_ICON_MAP: Record<string, ComponentType>` for the Phosphor icons used by built-in panels; fallback to `CircleIcon` for unknown names
- Badge: call `panel.badge?.()` to get count; `gitChangeCount` badge is now the badge callback on the git panel descriptor

**App.tsx changes:**
- Remove local `PanelId` type alias (line 73) — use `string`
- `handlePanelToggle` parameter: `(panelId: string) => void`
- Pass `panels={getRegisteredPanels()}` to `<ActivityBar />`
- Panel rendering area (lines 829–831) → dynamic:
  ```tsx
  {activePanel && (() => {
    const def = getRegisteredPanels().find(p => p.id === activePanel);
    return def ? <def.component {...panelProps[def.id]} /> : null;
  })()}
  ```
  Panel-specific props (e.g., `onOpenDiff` for SourceControlPanel) are passed via a `panelProps` lookup map in App.tsx.

**Test scenarios:**
- `registerPanel()` appends entry and re-sorts by `order`
- `getRegisteredPanels()` returns copy (mutation of result does not affect registry)
- Built-in panels (explorer, search, git) are in registry at module load
- ActivityBar renders panel list from props — adding a new `PanelDescriptor` causes it to appear
- Panel with unknown icon name renders fallback icon without crashing
- Badge callback returning `5` shows count `5` on the icon; returning `null` shows no badge

---

- [ ] **U5: Command Registry + Extensible QuickOpen**

**Goal:** Add a plugin command registry. QuickOpen merges static commands with plugin-registered ones. App.tsx dispatches plugin commands via handler calls.

**Requirements:** R36

**Dependencies:** U2 (PluginCommand type)

**Files:**
- Create: `src/extensions/commandRegistry.ts`
- Modify: `src/components/ui/QuickOpen.tsx`
- Modify: `src/App.tsx` (minor — default case in handleMenuAction)

**`commandRegistry.ts`** (follow `src/extensions/registry.ts` pattern):
- Module-level `pluginCommands: PluginCommand[]`
- `registerCommand(id: string, handler: PluginCommandHandler, options?: PluginCommandOptions): void`
- `executeCommand(id: string, ...args: unknown[]): void` — looks up by id, calls handler; silent no-op if not found
- `getRegisteredCommands(): PluginCommand[]`

**QuickOpen.tsx changes:**
- Add `import { getRegisteredCommands, executeCommand } from '@/extensions/commandRegistry'`
- In command palette mode (`query.startsWith('>')`), merge:
  ```typescript
  const allCommands = [
    ...commands.map(c => ({ ...c, _type: 'static' as const })),
    ...getRegisteredCommands().map(c => ({ label: c.label, category: c.category, shortcut: c.shortcut, action: c.id, _type: 'plugin' as const })),
  ];
  ```
- On selection: if `_type === 'plugin'`, call `executeCommand(item.action)`; if `_type === 'static'`, call existing `onAction(item.action)` prop

**App.tsx `handleMenuAction` change:**
- The existing `default:` case (or end of switch) should call `executeCommand(action)` for unrecognized action strings — ensures plugin commands exposed through `api.commands.execute()` that pass their id as an action string also work through the menu dispatch path

**Test scenarios:**
- `registerCommand('git.commit', handler, { label: 'Git: Commit', category: 'Git' })` — stored in registry
- `executeCommand('git.commit')` — calls handler
- `executeCommand('unknown.command')` — silent no-op, no throw, no console error
- QuickOpen in `>` mode shows plugin command label alongside static commands when query matches
- Selecting a plugin command from palette calls `executeCommand` (not `handleMenuAction`)

---

- [ ] **U6: Keybinding Contributions**

**Goal:** Parse `contributes.keybindings` from each plugin manifest after `init()` and register them into a keybinding registry. App.tsx keydown handler checks plugin bindings after all built-ins.

**Requirements:** R37

**Dependencies:** U5 (commandRegistry.executeCommand), U3 (pluginLoader reads keybindings)

**Files:**
- Create: `src/extensions/keybindingRegistry.ts`
- Modify: `src/App.tsx` (add `resolveKeybinding` call at end of keydown handler)
- Modify: `src/services/pluginLoader.ts` (call `registerKeybinding` for each manifest entry after `mod.init`)

**`keybindingRegistry.ts`:**
```typescript
interface KeybindingEntry {
  key: string;        // e.g. "ctrl+shift+g"
  mac?: string;       // e.g. "cmd+shift+g"
  commandId: string;
}
```
- `registerKeybinding(entry: KeybindingEntry): void`
- `resolveKeybinding(event: KeyboardEvent): string | null` — normalize event to lowercase key combination string, compare against `entry.mac` on macOS (`navigator.platform.startsWith('Mac')`), `entry.key` otherwise; return `commandId` of first match or `null`
- Key normalization: construct `[ctrl+][shift+][alt+]key` string; e.g., `Ctrl+Shift+G` event → `"ctrl+shift+g"`

**pluginLoader.ts extension** (after `mod.init(api)` succeeds):
```typescript
for (const kb of manifest.contributes?.keybindings ?? []) {
  if (!kb.command || !kb.key) continue; // skip malformed silently
  registerKeybinding({ key: kb.key, mac: kb.mac, commandId: kb.command });
}
```

**App.tsx keydown handler extension** (at the very end of the handler, after all built-in checks):
```typescript
const pluginCommandId = resolveKeybinding(e);
if (pluginCommandId) {
  e.preventDefault();
  executeCommand(pluginCommandId);
  return;
}
```
Built-ins take precedence naturally because they are checked first and return early.

**Test scenarios:**
- Plugin manifest with valid `contributes.keybindings` → `registerKeybinding()` called for each entry
- Manifest entry missing `key` → silently skipped, no crash, no error toast
- Manifest entry missing `command` → silently skipped
- `resolveKeybinding` with Ctrl+Shift+G event → returns `'git.commit'`
- Built-in binding for `ctrl+p` fires even if a plugin registered the same key (built-in returns early before `resolveKeybinding` is reached)
- macOS: `entry.mac` value is matched instead of `entry.key`

---

- [ ] **U7: Core App Startup Integration + DiffViewer Migration**

**Goal:** Invoke the plugin loader at startup, surface load errors as toasts, remove the DiffViewer overlay from App.tsx, and migrate DiffViewer to a proper registry extension so it can later be extracted to `quipu-plugin-git`.

**Requirements:** R4, R5, R10b, R27 (partial — noted but not yet applied), R29, R33

**Dependencies:** U3 (pluginLoader), U4 (panelRegistry), U5 (commandRegistry), U6 (keybindingRegistry)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/extensions/index.ts`
- Modify: `src/extensions/diff-viewer/DiffViewer.tsx` (or create `src/extensions/diff-viewer/index.ts`)
- Modify: `src/types/tab.ts` (add `type?: 'diff'` and diff-specific fields, or use a discriminated union)
- Modify: `vite.config.ts` (add `VITE_APP_VERSION` define)

**`vite.config.ts`:**
```typescript
define: {
  'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
}
```

**DiffViewer migration:**
1. Extend `Tab` type (or create a `DiffTab` subtype) with optional `diffBase?: string; diffHead?: string` fields and `type?: 'diff'`
2. Refactor `DiffViewer` component to accept standard viewer props `{ tab, activeFile, onContentChange, isActive }` — read `tab.diffBase` and `tab.diffHead` from the tab object instead of receiving them directly
3. Create/update `src/extensions/diff-viewer/index.ts` to call `registerExtension({ id: 'diff-viewer', canHandle: tab => tab.type === 'diff', priority: 90, component: DiffViewer })`
4. Import `src/extensions/diff-viewer/index.ts` in `src/extensions/index.ts` (static registration in core until `quipu-plugin-git` is published)
5. Add a built-in `'diff.open'` command in App.tsx (registered in commandRegistry during startup): handler calls `openTab({ ..., type: 'diff', diffBase, diffHead })`
6. Update `SourceControlPanel` to call `executeCommand('diff.open', { base, head })` instead of receiving `onOpenDiff` prop
7. Remove `activeDiff` state and the DiffViewer overlay render (lines 851–856) from App.tsx
8. Remove direct `DiffViewer` import (App.tsx line 26)

**Startup integration (App.tsx):**
```typescript
useEffect(() => {
  const api = createPluginApi({
    register: registerExtension,
    registerPanel,
    commands: { register: registerCommand, execute: executeCommand },
    services: { fileSystem, gitService, kernelService, terminalService },
    React,
    ReactDOM,
  });
  pluginLoader.loadAll(api).then(result => {
    result.errors.forEach(e => showToast(`Plugin "${e.id}" failed to load: ${e.reason}`, 'warning'));
  });
}, []);
```
Place after context providers are mounted — `showToast` must be available.

**Extended viewer props (R10b):**
- Locate where App.tsx renders `<ViewerComponent tab={tab} activeFile={activeFile} ... />` via `resolveViewer()`
- Add `workspacePath={workspacePath}` and `showToast={showToast}` to the props spread

**`src/extensions/index.ts`:**
- Add a comment block listing the 6 viewer static imports that will be removed per plugin as plugin repos are published
- Add import of `src/extensions/diff-viewer/index.ts`
- Do NOT remove any other static viewer import in this PR

**Test scenarios:**
- `pluginLoader.loadAll()` is called once at app startup (useEffect fires on mount)
- Each error in `result.errors` produces one 'warning' toast
- DiffViewer no longer imported directly in App.tsx
- Calling `executeCommand('diff.open', { base: 'a', head: 'b' })` opens a tab with `type: 'diff'`
- `resolveViewer()` for a diff tab returns the DiffViewer component (not the TipTap editor)
- Viewer components receive `workspacePath` and `showToast` as additional props
- `database-viewer` remains registered and functional (R29)

---

- [x] **U8: Plugin Registry Service**

**Goal:** HTTP client for the plugin registry (hosted on GitHub Pages). Fetches and caches plugin entries for 1 hour.

**Requirements:** R25, R26

**Dependencies:** None (uses existing `storageService`)

**Files:**
- Create: `src/services/pluginRegistry.ts`

**Interface:**
```typescript
interface PluginRegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  downloadUrl: string;
  sizeHint: string;
  fileTypes: string[];
}
interface PluginRegistryService {
  fetchRegistry(forceRefresh?: boolean): Promise<PluginRegistryEntry[]>;
}
```

**Implementation:**
- `PLUGIN_REGISTRY_URL`: string constant (placeholder — actual URL filled in when `quipu-plugins` repo is created)
- Cache key: `'plugin-registry-cache'` via `storageService.get()` / `storageService.set()` (dual-runtime already handled by storageService)
- Cache TTL: 3 600 000 ms (1 hour)
- Cache miss or `forceRefresh: true` → `fetch(PLUGIN_REGISTRY_URL)` → parse JSON array → validate → store `{ entries, fetchedAt: Date.now() }` → return entries
- Cache hit (within TTL, not forceRefresh) → return cached entries without network call
- Network failure + existing cache → return stale cache (degrade gracefully, no error throw)
- Network failure + no cache → throw (caller shows error toast)
- No dual-runtime adapter needed beyond what storageService already provides

**Test scenarios:**
- First call → fetches from network, stores result in `storageService`
- Second call within 1 hour → returns cached entries, fetch NOT called
- `fetchRegistry(true)` → fetches regardless of cache age
- Network failure with existing cache → returns stale cache entries without throwing
- Network failure with no cache → throws (error propagates to caller)

---

- [x] **U9: First-Run Wizard + Plugin Manager**

**Goal:** First-run wizard shown before workspace on first launch. Plugin Manager panel for install/uninstall/update of installed plugins.

**Requirements:** R12–R22b

**Dependencies:** U1 (IPC), U4 (panelRegistry — register PluginManager panel), U8 (pluginRegistry service)

**Files:**
- Create: `src/components/ui/FirstRunWizard.tsx`
- Create: `src/components/ui/PluginManager.tsx`
- Modify: `src/App.tsx` (wizard visibility state + conditional render)
- Modify: `src/extensions/panelRegistry.ts` (register PluginManager as built-in panel — order 99)

**`FirstRunWizard.tsx`:**
- Shown full-screen before main workspace when `plugins.json` was null (App.tsx sets a `showWizard` boolean from the pluginLoader startup check)
- On mount: calls `pluginRegistry.fetchRegistry()` to get available plugins list
- Displays each plugin: name, description, fileTypes joined as string, sizeHint, checkbox to select
- "Install Selected" button: calls `electronAPI.downloadAndExtractPlugin({ id, downloadUrl })` for each checked plugin; shows progress indicator per plugin; on all complete, writes `plugins.json` with `{ plugins: [{ id, enabled: true }, ...] }` and calls `onComplete()`
- "Skip" button: writes `{ plugins: [] }` to `plugins.json` and calls `onComplete()`
- In browser mode: hidden (browser mode has no plugin support in v1)
- Props: `{ onComplete: () => void }`

**`PluginManager.tsx`:**
- Registered in panelRegistry.ts (U4) as order-99 built-in panel after the component is created
- Reads installed plugin list from `plugins.json` state (held in App.tsx, passed as prop or via a context ref)
- Three tabs: **Installed** / **Available** / **Updates**
- **Installed tab**: each entry shows name, version, description, enabled toggle, uninstall button
  - Enable/disable toggle: update `plugins.json` via `electronAPI.writePluginsConfig()`, show restart-required toast
  - Uninstall: `electronAPI.removePluginDir(id)` + update `plugins.json`, show restart-required toast
- **Available tab**: shows registry entries not yet in `plugins.json`; Install button: `downloadAndExtractPlugin()` + update `plugins.json`, show restart toast; Refresh button: `pluginRegistry.fetchRegistry(true)` + re-render
- **Updates tab**: for installed plugins where `semver.gt(registryEntry.version, installed.version)`: show "Update available" badge and Update button. Update: `downloadAndExtractPlugin()` (overwrites existing dir), show restart toast. Loading state during download.
- Restart-required toast: `showToast('Restart Quipu to activate changes', 'info')`
- In browser mode: show a "Plugin management is only available in the desktop app" message

**App.tsx changes:**
- `const [showWizard, setShowWizard] = useState(false)`
- In the startup `useEffect` (U7): if `pluginsConfig` was null (checked before calling `loadAll`), set `setShowWizard(true)`
- Render: `{showWizard ? <FirstRunWizard onComplete={() => setShowWizard(false)} /> : <MainWorkspace />}`

**Test scenarios:**
- No `plugins.json` on launch → wizard rendered before workspace
- Wizard "Skip" → `writePluginsConfig` called with `{ plugins: [] }`, workspace opens
- Wizard "Install Selected" → `downloadAndExtractPlugin` called for each selected plugin, `writePluginsConfig` called with enabled entries, workspace opens
- Plugin Manager Installed tab shows entries from `plugins.json`
- Plugin Manager Uninstall → `removePluginDir` called, entry removed from config, restart toast shown
- Plugin Manager Available tab shows registry entries not currently installed
- Plugin Manager Updates tab shows badge for installed plugin whose registry version is higher
- Plugin Manager Update action → `downloadAndExtractPlugin` called, restart toast shown
- Plugin Manager in browser mode → "desktop only" message shown, no IPC calls made

---

## Dependencies and Sequencing

```
U1 (IPC + semver + adm-zip)
  └─ U3 (pluginLoader uses IPC and semver)
       └─ U7 (startup calls pluginLoader.loadAll)
            └─ U9 (wizard checks plugins.json before startup completes)

U2 (plugin-types.d.ts)
  └─ U3 (pluginLoader constructs PluginApi)
  └─ U4 (PanelDescriptor type)
  └─ U5 (PluginCommand type)

U4 (panelRegistry)
  └─ U7 (App.tsx uses dynamic panel rendering)
  └─ U9 (PluginManager registered as built-in panel)

U5 (commandRegistry)
  └─ U6 (keybindingRegistry calls executeCommand)
  └─ U7 (diff.open command, handleMenuAction default case)

U6 (keybindingRegistry)
  └─ U7 (App.tsx keydown handler integration)

U8 (pluginRegistry service)
  └─ U9 (wizard + manager fetch registry)
```

**Recommended order:** U1 → U2 → U3 → U4 → U5 → U6 → U7 → U8 → U9

U1–U2 have no dependencies and can start immediately. U3 requires U1+U2. U4, U5 require U2 and can run in parallel with U3. U6 requires U5. U7 requires U3+U4+U5+U6. U8 can run any time after U1 (only uses storageService). U9 requires U4+U8.

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Blob URL import blocked in packaged Electron build | Low | Verify in `npm run start` build before landing U7. contextIsolation without sandbox:true should permit it. |
| DiffViewer migration breaks existing diff flow | Medium | Keep both code paths working in parallel until U7 is confirmed; remove overlay only after registry-based path is tested. |
| Zip slip vulnerability in `adm-zip` extraction | Medium | Explicit canonicalization check per entry; reject entire archive on any failure. Covered by test in U1. |
| `init()` calling `registerPanel` before panelRegistry is imported | Low | Registries are module-level singletons — as long as they are imported in App.tsx before `loadAll()` fires, they are initialized. Verify import order. |
| `gitChangeCount` badge not updating after DiffViewer migration | Medium | The git panel's `badge` callback in panelRegistry holds a getter reference, not a snapshot. Ensure the getter reads from the current `gitStatus` state, not a closure capture. Implement as a ref or a function passed at registration. |
| Static commands and plugin commands with overlapping labels in QuickOpen | Low | Display category alongside label; plugin commands can use namespaced labels like "Git: Commit". |

## Key Files Changed

| File | Change |
|---|---|
| `package.json` | Add `semver`, `@types/semver`, `adm-zip`, `@types/adm-zip` |
| `vite.config.ts` | Add `VITE_APP_VERSION` define |
| `electron/main.cjs` | Add 6 plugin IPC handlers |
| `electron/preload.cjs` | Expose 6 new methods on `electronAPI` |
| `src/types/plugin-types.d.ts` | New — full plugin author type definitions |
| `src/services/pluginLoader.ts` | New — dual-runtime plugin loader |
| `src/services/pluginLoader.test.ts` | New — unit tests |
| `src/services/pluginRegistry.ts` | New — registry HTTP client + 1-hour cache |
| `src/extensions/panelRegistry.ts` | New — PanelDescriptor registry |
| `src/extensions/commandRegistry.ts` | New — PluginCommand registry |
| `src/extensions/keybindingRegistry.ts` | New — KeybindingEntry registry |
| `src/extensions/index.ts` | Add diff-viewer import; annotate future static import removals |
| `src/extensions/diff-viewer/DiffViewer.tsx` | Refactor to accept standard viewer props |
| `src/extensions/diff-viewer/index.ts` | New — registers DiffViewer via registerExtension() |
| `src/types/tab.ts` | Add optional `type`, `diffBase`, `diffHead` fields |
| `src/components/ui/ActivityBar.tsx` | Dynamic panel list from registry |
| `src/components/ui/QuickOpen.tsx` | Merge static + plugin commands |
| `src/components/ui/SourceControlPanel.tsx` | Replace `onOpenDiff` prop with `executeCommand('diff.open', ...)` |
| `src/components/ui/FirstRunWizard.tsx` | New — first-launch plugin selection |
| `src/components/ui/PluginManager.tsx` | New — installed/available/updates panel |
| `src/App.tsx` | Startup integration, widen PanelId, dynamic panels, keybinding hook, remove DiffViewer overlay |
