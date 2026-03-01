---
title: "feat: Terminal Enhancements — Search, Multi-Instance, Padding"
type: feat
status: active
date: 2026-03-01
origin: docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md
---

# Terminal Enhancements — Search, Multi-Instance, Padding

## Overview

The terminal component (`src/components/Terminal.jsx`) currently runs a single xterm.js instance with no search, no way to open parallel terminals, and no internal padding. This plan adds three improvements: in-terminal search via xterm's SearchAddon, multi-terminal tabs with independent pty processes, and proper padding between the terminal content and its container borders.

## Problem Statement / Motivation

- **No search**: Users cannot find text in terminal output scrollback. Long build logs or command output require manual scrolling.
- **Single terminal**: Users who need to run a server in one terminal and execute commands in another must use an external terminal.
- **No padding**: Terminal text touches the container edges, making the UI feel cramped compared to VS Code or other editors.

## Proposed Solution

### 1. Terminal Search (SearchAddon)

- Install `@xterm/addon-search` (already compatible with xterm.js 6.0.0)
- When the terminal is focused, Ctrl+F opens a search overlay (absolutely positioned, top-right corner like VS Code)
- Enter = next match, Shift+Enter = previous match, Escape = close
- Search highlight colors read from CSS custom properties and passed to SearchAddon's `ISearchDecorationOptions`

### 2. Multi-Terminal Tabs

**Architecture: Terminal ID Multiplexing**

Every IPC/WebSocket message includes a `terminalId` field. Both runtimes maintain a map of terminal instances.

**New service adapter**: Create `src/services/terminalService.js` following the same pattern as `fileSystem.js` to extract dual-runtime logic from the component.

**Electron side (`electron/main.cjs` + `electron/preload.cjs`):**
- Replace single `ptyProcess` with `Map<string, ptyProcess>`
- IPC channels: `terminal-create` returns `{ terminalId }`, `terminal-write(terminalId, data)`, `terminal-resize(terminalId, cols, rows)`, `terminal-kill(terminalId)`
- `terminal-incoming` payload includes `{ terminalId, data }` — renderer filters by active terminal
- Fix `removeAllListeners` bug: use `ipcRenderer.removeListener(channel, specificCallback)` instead of `removeAllListeners`

**Go server (`server/main.go`):**
- Already supports multiple concurrent WebSocket connections (each `/term` connection spawns its own pty). No changes needed for basic multi-terminal.
- Consider adding a max connection limit (5 concurrent).

**UI:**
- Terminal tab bar inside the terminal panel area (below the resize handle, above the xterm container)
- "+" button to create new terminal, X button per tab to close
- Default label: "Terminal 1", "Terminal 2", etc. (auto-incrementing)
- Tab switching shows/hides xterm instances. Only `fitAddon.fit()` on the **visible** terminal.
- When the last terminal tab is closed, show a placeholder with "New Terminal" button
- Max 5 concurrent terminals (show toast warning if exceeded)

**State:**
- Terminal tab metadata (id, label, isActive) in `WorkspaceContext` for consistency
- xterm instances, pty connections, and refs remain local to the Terminal component

### 3. Terminal Padding

- Wrap the xterm container in a div with `p-2` (8px padding on all sides)
- The inner xterm div is what FitAddon measures, so the fit calculation is correct against the smaller container
- Outer padding div background must match xterm's `theme.background` (reads from the same CSS variable)

## Technical Considerations

### Keyboard Shortcuts
- **Ctrl+F**: Scoped to terminal focus only. When editor is focused, Ctrl+F does nothing (no editor search yet). When terminal is focused, opens terminal search overlay.
- **Ctrl+Shift+`** (backtick): New terminal shortcut (matches VS Code). Add to `src/data/commands.js`.
- **Ctrl+`**: Existing toggle. If collapsed + no terminals, creates one and expands.
- **isClaudeRunning**: Becomes per-terminal. Store alongside terminal tab metadata.

### Dual-Runtime Changes (4-Place Pattern)
1. `server/main.go` — Add connection limit, no other changes needed
2. `electron/main.cjs` — Replace single pty with Map, add terminal ID to all IPC
3. `electron/preload.cjs` — Update contextBridge to pass terminalId in all terminal methods
4. `src/services/terminalService.js` — **New file**, adapter for terminal lifecycle

### ResizeObserver
- Only the active terminal responds to resize events
- When switching tabs, immediately call `fitAddon.fit()` on the newly visible terminal
- Background terminals skip fit (would compute 0 cols/rows, corrupting pty state)

### Workspace Change
- When `selectFolder` is called, all terminal instances are killed and tabs cleared (same behavior as file tabs)

### Search Theming
- SearchAddon uses programmatic decoration colors (not CSS)
- On theme change, read CSS custom property values via `getComputedStyle` and update SearchAddon options
- Match highlight: `--color-accent-muted`, Active match: `--color-accent`

## Acceptance Criteria

- [ ] Ctrl+F opens search overlay when terminal is focused
- [ ] Search finds text in scrollback, highlights matches, navigates with Enter/Shift+Enter
- [ ] Escape closes search, clears highlights, returns focus to terminal
- [ ] "+" button creates a new terminal tab with independent pty/WebSocket
- [ ] Closing a terminal tab kills its pty process
- [ ] Switching tabs preserves terminal state and scrollback
- [ ] Max 5 concurrent terminals with toast warning
- [ ] Terminal text has 8px padding from container edges
- [ ] FitAddon correctly calculates dimensions with padding
- [ ] All features work in both Electron and browser runtimes
- [ ] `handleSendToTerminal` and `handleSendToClaude` target the active terminal
- [ ] Closing one terminal does not break data flow to other terminals
- [ ] Ctrl+Shift+` creates a new terminal

## Dependencies & Risks

- **`@xterm/addon-search`** — Must be compatible with xterm.js 6.0.0
- **IPC refactor** — Breaking change to terminal IPC protocol. Must update all 4 places atomically.
- **Performance** — 5 concurrent pty processes + xterm instances. Monitor memory usage.
- **Risk**: `removeAllListeners` bug is critical — if not fixed, closing one terminal breaks all others.

## MVP

### src/services/terminalService.js

```javascript
import { isElectron } from './fileSystem.js';

const electronTerminal = {
  create: async (cwd) => {
    return await window.electronAPI.createTerminal({ cwd });
    // Returns { terminalId }
  },
  write: (terminalId, data) => {
    window.electronAPI.writeTerminal(terminalId, data);
  },
  resize: (terminalId, cols, rows) => {
    window.electronAPI.resizeTerminal(terminalId, cols, rows);
  },
  kill: (terminalId) => {
    window.electronAPI.killTerminal(terminalId);
  },
  onData: (terminalId, callback) => {
    return window.electronAPI.onTerminalData(terminalId, callback);
  },
  removeListener: (terminalId, callback) => {
    window.electronAPI.removeTerminalListener(terminalId, callback);
  }
};

const browserTerminal = {
  create: async (cwd) => {
    const terminalId = crypto.randomUUID();
    // WebSocket connection created per terminal
    return { terminalId, cwd };
  },
  // ... browser implementations using WebSocket per terminal
};

const terminalService = isElectron() ? electronTerminal : browserTerminal;
export default terminalService;
```

### electron/main.cjs (multi-pty changes)

```javascript
// Replace: let ptyProcess = null;
const ptyProcesses = new Map(); // terminalId -> ptyProcess

ipcMain.handle('terminal-create', async (event, { cwd }) => {
  const terminalId = crypto.randomUUID();
  const pty = require('node-pty').spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80, rows: 24,
    cwd: cwd || process.env.HOME,
    env: process.env
  });
  ptyProcesses.set(terminalId, pty);
  pty.onData((data) => {
    mainWindow.webContents.send('terminal-incoming', { terminalId, data });
  });
  pty.onExit(() => {
    ptyProcesses.delete(terminalId);
  });
  return { terminalId };
});

ipcMain.on('terminal-write', (event, { terminalId, data }) => {
  const pty = ptyProcesses.get(terminalId);
  if (pty) pty.write(data);
});

ipcMain.on('terminal-resize', (event, { terminalId, cols, rows }) => {
  const pty = ptyProcesses.get(terminalId);
  if (pty) pty.resize(cols, rows);
});

ipcMain.handle('terminal-kill', async (event, { terminalId }) => {
  const pty = ptyProcesses.get(terminalId);
  if (pty) {
    pty.kill();
    ptyProcesses.delete(terminalId);
  }
});
```

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md](docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md)
- Existing terminal: [src/components/Terminal.jsx](src/components/Terminal.jsx)
- Existing IPC handlers: [electron/main.cjs](electron/main.cjs)
- Preload bridge: [electron/preload.cjs](electron/preload.cjs)
- Go terminal WebSocket: [server/main.go](server/main.go)
- File system adapter pattern: [src/services/fileSystem.js](src/services/fileSystem.js)
- Solution doc (terminal restart fix): [docs/solutions/integration-issues/frame-system-multi-component-sync.md](docs/solutions/integration-issues/frame-system-multi-component-sync.md)
