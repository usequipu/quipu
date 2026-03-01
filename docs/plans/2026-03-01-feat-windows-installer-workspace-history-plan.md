---
title: "feat: Windows MSI Installer + Workspace History"
type: feat
status: active
date: 2026-03-01
origin: docs/plans/2026-02-28-feat-windows-build-wsl-remote-plan.md
---

# Windows MSI Installer + Workspace History

## Overview

Two related features: generate an MSI installer for Windows (instead of or alongside NSIS), and implement workspace history so that the last-opened workspace auto-loads on startup and recently-opened workspaces are accessible from the File menu.

## Problem Statement / Motivation

- **MSI installer**: NSIS is currently configured but MSI is the standard Windows installer format for enterprise deployment and group policy distribution. It provides a cleaner install/uninstall experience.
- **Workspace history**: Every time the user opens Quipu, they must manually select a workspace folder. There's no memory of previous sessions. This adds friction to the daily workflow.

## Proposed Solution

### Phase 1: Workspace History

This is frontend + Electron work, independent of the installer.

**Storage:** Use `electron-store` (or `localStorage` for browser mode) to persist:
```javascript
{
  lastWorkspace: "/path/to/last/opened",
  recentWorkspaces: [
    { path: "/path/to/project1", name: "project1", lastOpened: "2026-03-01T..." },
    { path: "/path/to/project2", name: "project2", lastOpened: "2026-02-28T..." },
    // max 10 entries
  ]
}
```

**Auto-open last workspace:**
- On app launch, if `lastWorkspace` exists, attempt to open it via `selectFolder(lastWorkspace)`
- If the path no longer exists (deleted/moved), show toast warning and fall back to folder picker
- Only in Electron mode (browser mode always needs explicit folder selection due to security)

**Recent workspaces in File menu:**
- Add "Open Recent" submenu to the File menu in `src/data/commands.js`
- Each entry shows folder name + full path
- Click opens that workspace
- "Clear Recent" at the bottom

**Update on workspace change:**
- When `selectFolder()` succeeds, update `lastWorkspace` and push to `recentWorkspaces` (dedup by path)

### Phase 2: MSI Installer

**electron-builder MSI target:**

#### package.json (build config)

```json
{
  "build": {
    "win": {
      "targets": [
        { "target": "msi", "arch": ["x64"] },
        { "target": "nsis", "arch": ["x64"] }
      ]
    },
    "msi": {
      "oneClick": false,
      "perMachine": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "Quipu"
    }
  }
}
```

**Note:** electron-builder's MSI support uses WiX Toolset under the hood. This requires:
- WiX Toolset v3 installed on the build machine (or in CI)
- `.wxs` template may need customization for upgrade GUIDs
- MSI supports auto-update via Windows Installer service

**Alternative:** If electron-builder's MSI support is too limited, use `electron-wix-msi` package for more control.

### Phase 3: MSI Features

- **File associations**: Associate `.quipu` files with Quipu editor
- **Upgrade GUID**: Stable GUID for clean upgrades (new version replaces old)
- **Add to PATH** (optional): Allow users to open `quipu .` from command line

## Technical Considerations

### Workspace History Storage

**Electron:** Use `electron-store` for reliable cross-platform persistence. It stores JSON in the app's userData directory (`%APPDATA%/quipu/` on Windows). This persists across reinstalls.

**Browser:** Use `localStorage` with `quipu-recent-workspaces` key. Limited by browser storage policies but acceptable for the web version.

**Service adapter:** Add `src/services/storageService.js`:
```javascript
const electronStorage = {
  get: (key) => window.electronAPI.storageGet(key),
  set: (key, value) => window.electronAPI.storageSet(key, value),
};
const browserStorage = {
  get: (key) => JSON.parse(localStorage.getItem(key)),
  set: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
};
```

### WSL Build Considerations
Per the existing plan at `docs/plans/2026-02-28-feat-windows-build-wsl-remote-plan.md`, building Windows targets from WSL requires:
- `wine` for NSIS (already documented)
- WiX Toolset does NOT run under wine — MSI must be built on native Windows or in CI (GitHub Actions with `windows-latest`)

### File Menu Integration
The MenuBar uses commands from `src/data/commands.js`. The "Open Recent" submenu needs dynamic content (workspace list). Current menu items are static. This requires either:
- Making the commands list reactive (re-read from storage on menu open)
- Or passing recent workspaces as props to MenuBar

## Acceptance Criteria

### Workspace History
- [ ] Last-opened workspace auto-loads on Electron app startup
- [ ] If last workspace path doesn't exist, shows warning toast and opens folder picker
- [ ] File > Open Recent shows up to 10 recent workspaces
- [ ] Each entry shows folder name and full path
- [ ] Clicking a recent workspace opens it
- [ ] "Clear Recent" option at the bottom of the submenu
- [ ] Recent workspaces persist across app restarts
- [ ] Browser mode uses localStorage (no auto-open, just File menu)

### MSI Installer
- [ ] `npm run build:release` produces an MSI installer for Windows x64
- [ ] MSI installs to Program Files with desktop and Start Menu shortcuts
- [ ] MSI supports clean upgrade (new version replaces old via upgrade GUID)
- [ ] `.quipu` files associated with Quipu editor
- [ ] Uninstaller cleanly removes all files

## Dependencies & Risks

- **electron-store** — New dependency for persistent storage in Electron
- **WiX Toolset** — Required for MSI generation, must be available in CI
- **Risk**: MSI build may only work on Windows/CI, not from WSL
- **Risk**: `electron-store` adds ~50KB to bundle. Minimal concern for Electron.
- **Risk**: Auto-opening last workspace could be slow if the workspace has many files

## Sources

- **Origin plan:** [docs/plans/2026-02-28-feat-windows-build-wsl-remote-plan.md](docs/plans/2026-02-28-feat-windows-build-wsl-remote-plan.md) — Windows build architecture
- Solution doc: [docs/solutions/build-errors/electron-cross-platform-native-modules-wsl.md](docs/solutions/build-errors/electron-cross-platform-native-modules-wsl.md) — WSL build gotchas
- Package config: [package.json](package.json) — current electron-builder config
- Menu system: [src/data/commands.js](src/data/commands.js) — menu items
- MenuBar: [src/components/MenuBar.jsx](src/components/MenuBar.jsx) — menu rendering
- Workspace context: [src/context/WorkspaceContext.jsx](src/context/WorkspaceContext.jsx) — `selectFolder`
