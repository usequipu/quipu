---
date: 2026-04-11
topic: plugin-architecture
---

# Plugin-Based Architecture

## Problem Frame

Quipu's viewer extensions (pdf-viewer, code-viewer, mermaid-viewer, media-viewer, excalidraw-viewer, notebook, diff-viewer, git panel) are statically bundled into the main app. Every user gets all extensions whether they need them or not. Dependencies like Monaco, Excalidraw, and react-pdf inflate the bundle even when unused, and all viewers must be released on the same cadence as core.

The goal is a plugin system where these viewers live as independently distributed, separately installable units — each in its own GitHub repo, with its own release cycle and dependency graph — while the core app (TipTap editor, database viewer, comments, frontmatter) remains lean and first-class.

## Plugin Loading Lifecycle

```
App startup
    │
    ▼
plugins.json exists?
   │                      │
  No                     Yes
   │                      │
   ▼                      │
First-run wizard          │
  Select plugins          │
  Download & extract      │
  Write plugins.json      │
        │                 │
        └────────┬────────┘
                 ▼
      For each enabled plugin
                 │
         Read manifest.json
                 │
         Version compatible?
          │            │
         No           Yes
          │            │
        Skip +    Read source via IPC
        warn      → Blob URL → import(url)
                       │
              mod.init({ register, registerPanel,
                commands, services, React, ReactDOM })
                       │
              Registries updated (viewers,
              panels, commands, keybindings)
                       │
              (next plugin or continue)
                 │
                 ▼
           Open workspace
                 │
            Tab opened
                 │
          resolveViewer()
          │            │
        Match       No match
          │            │
     Plugin         TipTap
    component        editor
```

## Requirements

**Plugin Loading**
- R1. On startup, the host app reads `~/.quipu/plugins.json` to determine which plugins are enabled.
- R2. For each enabled plugin, the host reads the plugin source via the existing `electronAPI.readFile()` IPC call, wraps it in a Blob URL (`new Blob([source], { type: 'text/javascript' })`), and loads it via `import(blobUrl)`. No CSP changes or custom protocol modifications required.
- R3. Each plugin bundle exports an `init(api)` function. The host calls `mod.init({ register, services, React, ReactDOM })` after import. No global namespace is used.
- R4. The existing `resolveViewer()` and `getExtensionForTab()` registry API is unchanged — plugins populate the same registry as before.
- R5. Plugin loading errors (missing bundle, version mismatch, runtime exception) are isolated: a broken plugin must not crash the app. Load errors are collected and surfaced as warning toasts at startup.
- R6. Plugins declare a `quipuVersion` semver constraint in their manifest; the host evaluates it using a `semver` library and skips incompatible plugins with a logged warning.

**Plugin Manifest**
- R7. Every plugin directory must contain a `manifest.json` with: **required** fields `id`, `name`, `version`, `description`, `entry`, `quipuVersion`; **optional** fields `fileTypes` (array of handled file extensions, e.g. `[".pdf"]`), `sizeHint` (human-readable bundle size string), and `contributes` (object declaring keybindings).
- R7b. The `contributes.keybindings` field is an optional array of keybinding declarations. Each entry has: `command` (registered command id), `key` (key combination string, e.g. `"ctrl+shift+g"`), and optionally `mac` (macOS override). Example:
  ```json
  "contributes": {
    "keybindings": [
      { "command": "git.commit", "key": "ctrl+shift+g", "mac": "cmd+shift+g" }
    ]
  }
  ```
- R8. The host validates the manifest schema before loading the bundle; invalid manifests are skipped with a warning toast. The `id` field must match `^[a-z0-9][a-z0-9-]{0,63}$`; manifests with non-conforming `id` values are rejected.

**Plugin API (Host → Plugin)**
- R9. The host passes an `api` object to each plugin's `init()` function containing:
  - `register(descriptor: ExtensionDescriptor)` — register a viewer for the main editor area
  - `registerPanel(descriptor: PanelDescriptor)` — register a sidebar panel in the activity bar
  - `commands.register(id, handler, options?: { label, category })` — register a global command
  - `commands.execute(id, ...args)` — invoke any registered command by id
  - `services.fileSystem` — file CRUD adapter
  - `services.gitService` — git operations adapter
  - `services.kernelService` — Jupyter kernel management
  - `services.terminalService` — terminal I/O
  - `React` — shared React instance (avoids duplicate React across plugin bundles)
  - `ReactDOM` — shared ReactDOM instance (required for correct hook deduplication alongside React)
- R9b. `PanelDescriptor` has: `id` (string), `label` (string), `icon` (Phosphor icon name), `component` (React component rendered as the panel content), `order` (optional number, position after built-in panels), `badge` (optional `() => number | null` for the activity bar badge count).
- R10. A TypeScript types file (`plugin-types.d.ts`) in the core repo exports type definitions for the `init` api parameter, `ExtensionDescriptor`, `PanelDescriptor`, `PluginCommand`, `Tab`, `ActiveFile`, and all service interfaces. Plugin authors reference it via their tsconfig. A separate published npm package is not required at this stage.
- R10b. Plugin component props are extended beyond the current `{ tab, activeFile, onContentChange, isActive }` to include `workspacePath: string` and `showToast: (message: string, type: 'error' | 'warning' | 'success' | 'info') => void`. Plugins bundle their own file-type detection utilities (e.g., `isPdf`, `getLanguage`) rather than importing them from the host.

**First-Run Wizard**
- R12. On first launch (no `~/.quipu/plugins.json` exists), the app shows a setup wizard before opening the main workspace.
- R13. The wizard presents a curated list of official plugins fetched from the plugin registry, each showing: name, description, file types handled, and bundle size hint.
- R14. The user selects which plugins to install; the wizard downloads and extracts them to `~/.quipu/plugins/<id>/`.
- R15. The user can skip the wizard entirely; the app opens with no plugins enabled.
- R16. The wizard can be re-launched from the plugin manager at any time.

**Plugin Manager Panel**
- R17. A plugin manager is accessible from the app settings or activity bar.
- R18. The manager lists installed plugins with: name, version, description, an enabled/disabled toggle, and an uninstall action.
- R19. The manager fetches the plugin registry and surfaces available (not yet installed) plugins with an install action.
- R20. Installing a plugin downloads and extracts the zip archive to `~/.quipu/plugins/<id>/`; a restart notification is shown to activate it.
- R21. Uninstalling removes the plugin directory; a restart notification is shown to deactivate it.
- R22. The manager shows an "Update available" badge when an installed plugin's version is behind the registry's latest (comparison uses semver `gt()`; pre-release versions are not surfaced as updates).
- R22b. The manager provides an Update action alongside the badge that downloads the latest version zip, replaces the plugin directory, and shows the restart notification per R20. In-progress state and failure states follow the same pattern as R20.

**Official Plugin Repos**
- R23. Each of the following becomes a separate GitHub repository with its own Vite build config, `manifest.json`, and GitHub Actions release pipeline:

  | Plugin repo | Replaces | Key dependency |
  |---|---|---|
  | `quipu-plugin-pdf-viewer` | `src/extensions/pdf-viewer/` | react-pdf |
  | `quipu-plugin-code-viewer` | `src/extensions/code-viewer/` | @monaco-editor/react |
  | `quipu-plugin-mermaid-viewer` | `src/extensions/mermaid-viewer/` | mermaid |
  | `quipu-plugin-media-viewer` | `src/extensions/media-viewer/` | (none large) |
  | `quipu-plugin-excalidraw-viewer` | `src/extensions/excalidraw-viewer/` | @excalidraw/excalidraw |
  | `quipu-plugin-notebook` | `src/extensions/notebook/` | (Jupyter protocol) |
  | `quipu-plugin-git` | `src/extensions/diff-viewer/` + git panel | (none large) |

- R24. Each plugin repo publishes a GitHub Release containing a zip archive with `manifest.json` + `index.js` (and optional `index.css`).

**Plugin Registry**
- R25. A central registry JSON file lists all official plugins with: `id`, `name`, `description`, `version`, `downloadUrl`, `sizeHint`, and `fileTypes`.
- R26. The host app fetches this registry when the plugin manager is opened; results are cached locally for 1 hour, invalidated by explicit user refresh action in the manager.

**Core App Changes**
- R27. Remove static imports of the six viewer extensions listed in R23 (pdf-viewer, code-viewer, mermaid-viewer, media-viewer, excalidraw-viewer, notebook, git) from `src/extensions/index.ts`; `database-viewer` remains and is statically registered per R29.
- R28. Remove npm dependencies that are solely needed by extracted plugins (react-pdf, @excalidraw/excalidraw, mermaid, @monaco-editor/react) — to be confirmed per-dependency during planning.
- R29. The database viewer (`src/extensions/database-viewer/`) remains in core, statically registered. Its inline embedding via `EmbeddedDatabase.ts` makes extraction impractical without a separate effort.
- R30. The registry (`src/extensions/registry.ts`) and type definitions (`src/types/extensions.ts`) are unchanged in their public interface.
- R31. A new `pluginLoader` service (`src/services/pluginLoader.ts`) handles: reading `~/.quipu/plugins.json`, dynamically importing each enabled plugin's bundle, and collecting load errors for display.
- R35. A panel registry (analogous to the extension viewer registry) stores `PanelDescriptor` entries registered via `api.registerPanel()`. The `ActivityBar` component reads from this registry instead of a hardcoded array, rendering built-in panels first (explorer, search) followed by plugin panels in `order` sequence. The existing git panel (`SourceControlPanel`) is migrated to be registered by `quipu-plugin-git` rather than hardcoded.
- R36. A command registry stores plugin-registered commands (`api.commands.register()`). The `QuickOpen` command palette reads from both the static `commands.ts` and the command registry, so plugin commands appear in the palette alongside built-in commands. `api.commands.execute(id)` resolves commands from both sources.
- R37. After loading each plugin, the plugin loader reads `contributes.keybindings` from the manifest and registers each binding with the global keyboard handler in `App.tsx`. Built-in bindings take precedence over plugin bindings on conflict. In v1, keybindings are always-active (no `when` context evaluation).

**Electron Integration**
- R32. The Electron main process exposes IPC handlers for: reading/writing `~/.quipu/plugins.json`, downloading a plugin zip, extracting it to the plugin directory, and listing installed plugin directories. Zip extraction must canonicalize each entry path and verify it falls strictly under `~/.quipu/plugins/<id>/`; archives containing path traversal sequences are rejected in full.
- R33. Plugin bundles are loaded in the Electron renderer via Blob URL dynamic imports: the renderer calls the existing `electronAPI.readFile()` IPC to read each plugin's `index.js` as a string, constructs a Blob URL, and calls `import(blobUrl)`. No changes to `webPreferences`, CSP, or custom protocol privileges are required.
- R34. The `pluginLoader` service exposes a browser-mode stub that returns an empty plugin list and is a no-op. This preserves the dual-runtime adapter pattern so browser mode remains a valid compile target.

## Success Criteria

- A file handled by an installed plugin renders with the same fidelity as it does today with the bundled extension.
- A broken or missing plugin does not prevent the app from launching or opening other files.
- A fresh install with no plugins chosen loads the main workspace without any extension-specific npm dependencies in the bundle.
- A developer can build a new plugin against `plugin-types.d.ts`, drop its built bundle into `~/.quipu/plugins/`, and have it load — registering viewers, panels, commands, and keybindings — without touching the core repo.
- The first-run wizard completes the download and setup of a full plugin set in under 30 seconds on a normal connection.

## Scope Boundaries

- Browser mode (Go server) plugin support is deferred to a future iteration.
- Plugin sandboxing / JS isolation (iframes, workers) is out of scope — plugins run in the same renderer process.
- A community plugin marketplace (third-party plugins) is out of scope; the registry lists only official plugins initially.
- Plugin inter-communication (plugin A calling into plugin B) is out of scope.
- Hot-reload of plugins without a restart is out of scope for the initial cut.
- The `database-viewer` stays in core and is not extracted to a plugin.
- The `EmbeddedDatabase` TipTap node that inline-embeds the database viewer is out of scope for extraction.

## Key Decisions

- **Local directory over npm packages**: npm install would require rebuilding the host app to add plugins; local directory loading enables post-install plugin management without recompilation.
- **Blob URL dynamic import over `file://` or custom protocol**: `file://` import is blocked by `contextIsolation: true`; Blob URL via `electronAPI.readFile()` requires no Electron config changes and uses existing IPC.
- **`init(api)` export over `window.__quipu` global**: calling a module's exported `init()` avoids reintroducing the global pattern that TerminalContext was built to eliminate; aligns with the preload bridge model.
- **Plugin registry hosted in a standalone `quipu-plugins` GitHub repo (GitHub Pages)**: independent release cadence from the main app; clean URL; easy to update without touching core.
- **Plugins bundle their own file-type utilities; host passes extended props**: avoids growing the host API surface with utility functions; each plugin is self-contained for file detection; `workspacePath` and `showToast` are passed as props so plugins can notify the user.
- **Separate repos over monorepo packages**: each plugin has its own release cycle and dependency graph; a monorepo would re-entangle them and require coordinated releases.
- **Restart required for install/uninstall**: avoids the complexity of dynamic module unloading and re-sorting the registry; can be relaxed later.
- **Database viewer stays in core**: tightly integrated with TipTap via `EmbeddedDatabase.ts` and the inline-embedding feature; extracting it cleanly is a separate effort.
- **Git panel merged with diff-viewer into `quipu-plugin-git`**: they share the same domain and service dependency (`gitService`); shipping as one plugin reduces install fragmentation. Note: `DiffViewer` is currently a direct import in `App.tsx` (not a registry extension) — migration to the plugin registry requires changing the App.tsx rendering path.

## Dependencies / Assumptions

- Blob URL dynamic import (`import(URL.createObjectURL(blob))`) is confirmed feasible in Electron renderers with `contextIsolation: true` — no Electron config changes required.
- Each plugin bundles its own large dependencies (Monaco ~4 MB, Excalidraw ~3 MB) plus its own file-type detection utilities; the host provides only React and ReactDOM.
- Plugin registry is hosted via GitHub Pages on a standalone `quipu-plugins` repo.
- `@tanstack/react-table` and `@tanstack/react-virtual` are used exclusively by `database-viewer` (confirmed) and remain in core's `package.json`.
- Evaluating `quipuVersion` semver range strings (R6) requires a semver library (e.g., the `semver` npm package), which is not currently in the project's dependencies.
- The `SourceControlPanel` in `App.tsx` is currently hardcoded — it must be migrated to `quipu-plugin-git`'s `registerPanel()` call as part of the git plugin extraction.

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] Blob URL imports are same-session only — plugin source must be re-read and re-imported on each startup. Verify that this produces no meaningful performance penalty vs. cached loading.
- [Affects R3][Technical] What is the minimal Vite lib-mode config for a plugin bundle that exports `init(api)`, externalizes `react` and `react-dom`, and targets IIFE or ESM format compatible with Blob URL import?
- [Affects R20][Technical] What library handles zip extraction in the Electron main process? (`adm-zip`, `yauzl`, or a Node.js `zlib` approach).
- [Affects R28][Technical] Which `package.json` dependencies can be removed from core after extraction? (react-pdf, @excalidraw/excalidraw, mermaid, @monaco-editor/react — to be confirmed per extension against actual import sites).
- [Affects R32][Technical] Does the Electron download flow use `net.request`, `session.downloadURL`, or a preload-exposed `fetch`?
- [Affects R23][Technical] `DiffViewer` is currently a direct import in `App.tsx` rendered via local state (`activeDiff`), not a registry extension. Migration to `quipu-plugin-git` requires changing the App.tsx rendering path — plan must address this specifically.

## Next Steps
→ `/ce:plan`
