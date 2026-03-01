---
title: Windows installer configuration and workspace history persistence
problem: Quipu lacked Windows-native app distribution and workspace state recovery across app launches
symptoms:
  - No Windows installer or file association for .quipu files
  - Workspace context lost after closing app
  - No recent workspaces available for quick reopening
  - Cross-runtime storage inconsistency between Electron and browser modes
components:
  - src/services/storageService.js
  - electron/main.cjs
  - electron/preload.cjs
  - src/components/MenuBar.jsx
  - src/context/WorkspaceContext.jsx
  - src/data/commands.js
  - package.json
tags:
  - windows-installer
  - electron-builder
  - nsis
  - msi
  - file-association
  - workspace-persistence
  - storage-service
  - dual-runtime
  - ipc-handlers
  - recent-files
  - localStorage
related_plans:
  - docs/plans/2026-02-28-feat-windows-build-wsl-remote-plan.md
date: 2026-03-01
status: solved
category: feature-implementation
---

# Windows Installer Configuration and Workspace History

## Root Cause / Problem Statement

The Quipu editor needed two complementary features:

1. **Windows installer support** — Package the Electron app for Windows distribution with MSI, NSIS, and portable executables, file association for `.quipu` documents, and system shortcuts.
2. **Workspace history** — Remember recently opened folders in persistent storage (separate from session state), auto-open the last workspace on launch in Electron, and provide an "Open Recent" menu capped at 10 entries.

These features expose a critical architectural constraint: **all persistent data must follow the dual-runtime adapter pattern**, since Quipu runs both as a standalone Electron desktop app and as a browser + Go server backend. The solution required adding a new storage service layer alongside the existing filesystem service.

## Solution

### Step 1: Create the Storage Service (`src/services/storageService.js`)

A dual-runtime storage adapter provides a consistent async interface for both Electron and browser contexts. Detection happens **at module load time**, not at every call.

```javascript
function isElectron() {
  return !!(window.electronAPI && window.electronAPI.storageGet);
}

const electronStorage = {
  get: (key) => window.electronAPI.storageGet(key),
  set: (key, value) => window.electronAPI.storageSet(key, value),
};

const browserStorage = {
  get: (key) => {
    try {
      return Promise.resolve(JSON.parse(localStorage.getItem(key)));
    } catch {
      return Promise.resolve(null);
    }
  },
  set: (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
    return Promise.resolve();
  },
};

export const isElectronRuntime = isElectron;
export default isElectron() ? electronStorage : browserStorage;
```

- **Electron mode**: Delegates to IPC handlers exposed via preload
- **Browser mode** (including thin-shell): Wraps `localStorage` in a Promise-based API for identical call sites
- Exported `isElectronRuntime` enables conditional logic in consumers (e.g., auto-open on startup)

### Step 2: Add Electron IPC Handlers (`electron/main.cjs`)

Simple file-based storage in the app's `userData` directory — no external dependencies.

```javascript
function getStorageFile() {
    return path.join(app.getPath('userData'), 'quipu-state.json');
}

function readStorage() {
    try {
        const data = fs.readFileSync(getStorageFile(), 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};  // Graceful fallback on missing or corrupt file
    }
}

function writeStorage(data) {
    fs.writeFileSync(getStorageFile(), JSON.stringify(data, null, 2), 'utf-8');
}

ipcMain.handle('storage-get', (event, key) => {
    const store = readStorage();
    return store[key] ?? null;
});

ipcMain.handle('storage-set', (event, key, value) => {
    const store = readStorage();
    store[key] = value;
    writeStorage(store);
    return { success: true };
});
```

Storage file location by platform:
- macOS: `~/Library/Application Support/Quipu/quipu-state.json`
- Windows: `C:\Users\<user>\AppData\Roaming\Quipu\quipu-state.json`
- Linux: `~/.config/Quipu/quipu-state.json`

### Step 3: Expose in Preload Bridge (`electron/preload.cjs`)

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
    // ... existing handlers ...
    storageGet: (key) => ipcRenderer.invoke('storage-get', key),
    storageSet: (key, value) => ipcRenderer.invoke('storage-set', key, value),
});
```

**Critical:** The detection in `storageService.js` specifically checks for `window.electronAPI.storageGet`, so adding the handler here is what activates Electron mode. Preload and IPC handler must be added together.

### Step 4: Integrate Workspace History in Context (`src/context/WorkspaceContext.jsx`)

```javascript
import storage, { isElectronRuntime } from '../services/storageService';

const [recentWorkspaces, setRecentWorkspaces] = useState([]);

// Load history on mount; auto-open last workspace in Electron mode
useEffect(() => {
  (async () => {
    const recent = await storage.get('recentWorkspaces') || [];
    setRecentWorkspaces(recent);

    if (isElectronRuntime() && recent.length > 0) {
      const last = recent[0];
      try {
        const entries = await fs.readDirectory(last.path);
        setWorkspacePath(last.path);
        setFileTree(entries);
        claudeInstaller.installFrameSkills(last.path).catch(() => {});
      } catch {
        showToast(`Last workspace not found: ${last.name || last.path}`, 'warning');
      }
    }
  })();
}, []); // eslint-disable-line react-hooks/exhaustive-deps

const updateRecentWorkspaces = useCallback(async (folderPath) => {
  const name = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
  const entry = { path: folderPath, name, lastOpened: new Date().toISOString() };
  const recent = await storage.get('recentWorkspaces') || [];
  const deduped = recent.filter(r => r.path !== folderPath);
  const updated = [entry, ...deduped].slice(0, 10);  // LRU, max 10
  await storage.set('recentWorkspaces', updated);
  setRecentWorkspaces(updated);
}, []);

const clearRecentWorkspaces = useCallback(async () => {
  await storage.set('recentWorkspaces', []);
  setRecentWorkspaces([]);
}, []);
```

Hook into `selectFolder` (fire-and-forget, non-critical):

```javascript
const selectFolder = useCallback(async (folderPath) => {
  // ... existing directory loading logic ...
  updateRecentWorkspaces(folderPath).catch(() => {});
  claudeInstaller.installFrameSkills(folderPath).catch(() => {});
}, [showToast, updateRecentWorkspaces]);
```

Expose from context value: `recentWorkspaces`, `clearRecentWorkspaces`.

### Step 5: "Open Recent" Submenu in MenuBar (`src/components/MenuBar.jsx`)

Timer-based hover UX prevents submenu flicker during mouse movement:

```javascript
import { CaretRight } from '@phosphor-icons/react';

const { recentWorkspaces, selectFolder, clearRecentWorkspaces } = useWorkspace();
const [openSubmenu, setOpenSubmenu] = useState(null);
const submenuTimerRef = useRef(null);

const handleSubmenuEnter = (i) => {
  clearTimeout(submenuTimerRef.current);
  setOpenSubmenu(i);
};

const handleSubmenuLeave = () => {
  submenuTimerRef.current = setTimeout(() => setOpenSubmenu(null), 150);
};
```

Render for `item.type === 'openRecent'`:

```jsx
<div
  className="relative flex items-center justify-between py-1.5 px-4 cursor-default"
  onMouseEnter={() => handleSubmenuEnter(i)}
  onMouseLeave={handleSubmenuLeave}
>
  <span>Open Recent</span>
  <CaretRight size={10} className="ml-6 text-text-tertiary" />
  {openSubmenu === i && (
    <div className="absolute left-full top-0 min-w-[280px] bg-bg-elevated border border-border rounded-md py-1 z-[1001]">
      {recentWorkspaces.length === 0 ? (
        <div className="py-1.5 px-4 text-text-tertiary">No recent workspaces</div>
      ) : (
        recentWorkspaces.map(ws => (
          <div
            key={ws.path}
            className="flex flex-col py-1.5 px-4 hover:bg-accent-muted"
            onClick={(e) => { e.stopPropagation(); selectFolder(ws.path); closeAll(); }}
          >
            <span className="text-text-primary">{ws.name}</span>
            <span className="text-text-tertiary truncate max-w-[260px]">{ws.path}</span>
          </div>
        ))
      )}
      <div className="h-px bg-border mx-2 my-1" />
      <div
        className="py-1.5 px-4 hover:bg-accent-muted"
        onClick={(e) => { e.stopPropagation(); clearRecentWorkspaces(); closeAll(); }}
      >
        Clear Recent
      </div>
    </div>
  )}
</div>
```

### Step 6: Register Menu Item (`src/data/commands.js`)

```javascript
export const menus = [
  {
    label: 'File',
    items: [
      commands.find(c => c.action === 'file.new'),
      commands.find(c => c.action === 'file.openFolder'),
      { type: 'openRecent' },  // Special marker rendered by MenuBar
      sep,
      commands.find(c => c.action === 'file.save'),
    ],
  },
];
```

### Step 7: Configure Windows Installer (`package.json`)

```json
{
  "build": {
    "appId": "com.quipu.editor",
    "productName": "Quipu",
    "extraMetadata": { "main": "electron/main-thin.cjs" },
    "files": ["dist/**/*", "electron/main-thin.cjs", "electron/preload-thin.cjs", "package.json"],
    "extraResources": [
      { "from": "server/bin/${os}/", "to": "server/", "filter": ["**/*"] }
    ],
    "win": {
      "target": [
        { "target": "msi",      "arch": ["x64"] },
        { "target": "nsis",     "arch": ["x64"] },
        { "target": "portable", "arch": ["x64"] }
      ],
      "fileAssociations": [
        { "ext": "quipu", "name": "Quipu Document", "description": "Quipu rich text document", "role": "Editor" }
      ]
    },
    "msi": {
      "oneClick": false,
      "perMachine": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "Quipu"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    }
  }
}
```

Three installer formats:
- **MSI**: System-wide installation, better for enterprise/IT deployment
- **NSIS**: End-user installer with custom directory selection
- **Portable**: No installation required, self-contained

Run the full release build with:

```bash
npm run build:release        # current platform
npm run build:release -- win  # Windows targets from WSL
```

## Key Design Decisions

1. **Adapter pattern for storage** — mirrors `fileSystem.js`. Identical call sites in React; runtime selected at module load. Adding new persistent state follows the same pattern.

2. **Detection specificity** — `storageService.js` checks for `window.electronAPI.storageGet` (not just `window.electronAPI`). This means the thin-shell preload (`preload-thin.cjs`) correctly falls back to localStorage since it doesn't expose `electronAPI`.

3. **Fire-and-forget storage updates** — `updateRecentWorkspaces().catch(() => {})` in `selectFolder`. History is non-critical; file loading takes precedence. Storage failures don't surface to the user.

4. **Auto-open Electron-only** — Browser mode requires explicit user action to select a folder (privacy model). Electron mode auto-opens last workspace because users expect a native app to restore their session.

5. **IPC simplicity over complexity** — Single JSON file in `userData` vs. a library like `electron-store`. No external dependencies, trivial recovery from corruption (delete the file), human-readable format.

6. **Submenu timer UX** — 150ms close delay on mouse leave prevents the flyout from disappearing while the cursor traverses the gap between the menu item and the submenu panel.

7. **Three installer formats** — MSI covers enterprise IT scenarios (per-machine, Group Policy compatible), NSIS covers power users who want custom install paths, portable covers restricted environments where installation isn't possible.

## Related Documentation

- [docs/plans/2026-02-28-feat-windows-build-wsl-remote-plan.md](../../plans/2026-02-28-feat-windows-build-wsl-remote-plan.md) — Master plan: thin-shell architecture, Go server bundling, WSL remote mode, dynamic port assignment
- [docs/solutions/build-errors/electron-cross-platform-native-modules-wsl.md](../build-errors/electron-cross-platform-native-modules-wsl.md) — How to cross-compile from WSL, why `node-pty` was removed from the production build
- [docs/solutions/ui-bugs/editor-font-command-palette-theme-toggle.md](../ui-bugs/editor-font-command-palette-theme-toggle.md) — Related localStorage persistence pattern for editor preferences

## Prevention Strategies

### Dual-Runtime Detection

- Detection happens once at module load in `storageService.js`. If `electronAPI` loads asynchronously (it doesn't — preload runs synchronously), detection would silently fall back.
- Any new IPC method in preload must also get a handler in `main.cjs` — mismatches cause silent `undefined` returns from `ipcRenderer.invoke`.
- Use `isElectronRuntime()` from `storageService` (not a local check) across all consumers to ensure consistent logic.

### Storage Key Collisions

Define a central key registry to prevent future collisions:

```javascript
// In a shared constants file or at the top of main.cjs
const STORAGE_KEYS = {
  RECENT_WORKSPACES: 'recentWorkspaces',
  // future: APP_SETTINGS: 'appSettings',
};
```

### Stale Recent Workspace Entries

Users can delete folders outside the app. On auto-open failure, the app already shows a warning toast. A future improvement: validate all paths on startup and prune stale entries asynchronously.

### Build Artifacts

After every `build:release`, verify:
1. All three installer formats present in `release/`
2. Go server binary is in `extraResources` (check inside the installer)
3. On a clean VM: install, double-click a `.quipu` file, confirm app opens

## Testing Checklist

### Workspace History
- [ ] Open a folder → appears in File > Open Recent
- [ ] Recent list caps at 10 entries, deduplicates paths
- [ ] Click a recent entry → folder opens correctly
- [ ] Relaunch app (Electron) → last workspace auto-opens
- [ ] File > Open Recent > Clear Recent → list clears
- [ ] Click a recent entry whose folder was deleted → error toast shown, app doesn't crash

### Storage Persistence
- [ ] Storage persists across app restarts (verify `quipu-state.json` in `userData`)
- [ ] Corrupt `quipu-state.json` manually → app falls back to empty state, no crash
- [ ] Browser mode: localStorage used (no `electronAPI` exposed)
- [ ] Thin-shell mode: localStorage used (no `electronAPI` exposed)

### Windows Installer
- [ ] MSI installs system-wide, appears in Add/Remove Programs
- [ ] NSIS installer allows custom directory selection
- [ ] Portable `.exe` runs without installation
- [ ] Double-clicking a `.quipu` file opens Quipu
- [ ] Uninstall removes Start Menu and Desktop shortcuts
- [ ] Build completes from WSL: `npm run build:release -- win`
