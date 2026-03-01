---
title: "feat: Windows Build + WSL Remote Integration"
type: feat
status: active
date: 2026-02-28
origin: docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md
---

# Windows Build + WSL Remote Integration

## Overview

Ship Quipu as a native Windows app that can run in two modes:

1. **Standalone** — Electron thin shell bundles a Go server binary, spawns it on launch, connects via HTTP/WebSocket. Works like any desktop app.
2. **WSL Remote** — Same thin shell connects to a Go server running inside WSL, giving native Linux filesystem/terminal access from a Windows GUI. Replicates VSCode's Remote-WSL pattern.

Both modes eliminate `node-pty` from the Electron build entirely. The Go server (which already handles files, git, search, and terminal via `creack/pty`) becomes the sole backend.

## Problem Statement

- **No Windows build exists.** `electron:pack` has no configuration — no `build` key in `package.json`, no targets, no icons.
- **`node-pty` blocks cross-compilation.** It's a C++ native module that must be compiled with MSVC on Windows. Cannot cross-compile from WSL.
- **WSL users edit code in WSL but have no native GUI.** They either use the browser (no desktop integration) or switch to VSCode.

## Proposed Solution: Thin Shell Architecture

```
Current (Electron mode):
  [Electron main.cjs] <--IPC--> [React renderer]
      |-- node-pty (native C++)
      |-- fs (Node.js)
      |-- child_process (git, rg)

Proposed (Thin Shell):
  [Electron shell] loads [React dist/] --HTTP/WS--> [Go server]
      No native modules in Electron
      Go server handles ALL backend operations
```

**Key insight**: The browser-mode code path already exists and mirrors 100% of the Electron IPC surface. The thin shell simply forces browser-mode by not exposing `window.electronAPI`. The existing `isElectron()` check in all three service files returns `false`, and the browser/Go-server path activates automatically — zero frontend changes needed.

## Implementation Phases

### Phase 1: Thin Shell + Go Server Bundling

**Goal**: Package Quipu as a Windows app that spawns a local Go server.

#### 1a. Create `electron/main-thin.cjs`

New main process file (~60 lines) that:
- Spawns the bundled Go server binary on `app.whenReady()`
- Waits for server health check (`GET /health`) before creating `BrowserWindow`
- Loads `dist/index.html` (browser mode — no preload, no IPC)
- Kills Go server on `app.quit()` and `window-all-closed`
- Uses dynamic port assignment to avoid conflicts with multiple instances

```javascript
// electron/main-thin.cjs (sketch)
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let mainWindow, goServer;

function getServerBinary() {
  if (process.env.VITE_DEV_SERVER_URL) return null; // dev: run server manually
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(process.resourcesPath, 'server', `quipu-server${ext}`);
}

function startServer(port) {
  const bin = getServerBinary();
  if (!bin) return Promise.resolve();
  goServer = spawn(bin, ['-addr', `localhost:${port}`], { stdio: 'pipe' });
  return waitForHealth(port, 5000);
}

function waitForHealth(port, timeout) {
  // Poll GET http://localhost:{port}/health every 100ms until 200 or timeout
}

app.whenReady().then(async () => {
  const port = await findFreePort(3000);
  await startServer(port);
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
});
```

#### 1b. Add `/health` endpoint to Go server

```go
// server/main.go
http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("ok"))
})
```

#### 1c. Make server URL configurable in frontend

Replace hardcoded `http://localhost:3000` in all service files with a single config:

**New file: `src/config.js`**
```javascript
// src/config.js
export const SERVER_URL = window.__QUIPU_SERVER_URL__ || 'http://localhost:3000';
export const WS_URL = SERVER_URL.replace(/^http/, 'ws');
```

**Files to update** (replace hardcoded URLs):
- `src/services/fileSystem.js` — `GO_SERVER` constant (line ~5)
- `src/services/searchService.js` — `GO_SERVER` constant (line ~5)
- `src/services/gitService.js` — `GO_SERVER` constant (line ~5)
- `src/components/Terminal.jsx` — WebSocket URL `ws://localhost:3000/term`

The thin shell's main process injects the URL before page load:
```javascript
mainWindow.webContents.executeJavaScript(
  `window.__QUIPU_SERVER_URL__ = "http://localhost:${port}";`
);
```

#### 1d. Cross-compile Go server

```bash
# scripts/build-server.sh
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o server/bin/win/quipu-server.exe ./server
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o server/bin/linux/quipu-server ./server
```

`creack/pty` is pure Go (no CGO) — cross-compilation works from WSL with no extra toolchains.

**Important caveat**: `creack/pty` uses Unix PTY syscalls. The Windows-compiled Go binary will NOT have a working terminal. This is acceptable because:
- **Standalone Windows mode**: Terminal can fall back to `os/exec` with piped stdin/stdout (no PTY, but functional)
- **WSL Remote mode**: Terminal works natively because the server runs in Linux

#### 1e. electron-builder configuration

Add `build` key to `package.json`:

```json
{
  "build": {
    "appId": "com.quipu.editor",
    "productName": "Quipu",
    "directories": { "output": "release" },
    "files": [
      "dist/**/*",
      "electron/main-thin.cjs",
      "package.json"
    ],
    "extraResources": [
      {
        "from": "server/bin/${os}/",
        "to": "server/",
        "filter": ["**/*"]
      }
    ],
    "win": {
      "target": [
        { "target": "nsis", "arch": ["x64"] },
        { "target": "portable", "arch": ["x64"] }
      ]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    },
    "linux": {
      "target": ["AppImage"],
      "category": "Development"
    }
  }
}
```

No native modules = can build Windows target from WSL (electron-builder uses Wine for NSIS, installed automatically).

#### 1f. Build script

```bash
# scripts/build-release.sh
#!/bin/bash
set -euo pipefail

echo "Building Go server..."
bash scripts/build-server.sh

echo "Building Vite frontend..."
npm run build

echo "Packaging Electron app..."
npx electron-builder --win --linux
```

---

### Phase 2: WSL Remote Mode

**Goal**: Windows Quipu connects to a Go server running inside WSL for native Linux file/terminal access.

#### 2a. WSL detection and server launch

Add WSL management to the thin shell main process:

```javascript
// electron/wsl.cjs
const { execSync, spawn } = require('child_process');

function isWSLAvailable() {
  try {
    execSync('wsl.exe --list --quiet', { encoding: 'utf8' });
    return true;
  } catch { return false; }
}

function getWSLDistros() {
  const output = execSync('wsl.exe --list --quiet', { encoding: 'utf8' });
  return output.split('\n').map(s => s.trim()).filter(Boolean);
}

function launchServerInWSL(distro, port) {
  // The Go server binary lives in WSL filesystem
  const proc = spawn('wsl.exe', [
    '-d', distro, '--',
    '/path/to/quipu-server', '-addr', `0.0.0.0:${port}`
  ], { stdio: 'pipe' });
  return proc;
}
```

#### 2b. Connection mode selector

On app launch, if WSL is detected, show a simple startup screen:

- **Local** — spawn bundled Go server (default, no WSL needed)
- **WSL: Ubuntu** (or whatever distros are found) — launch server in that distro

This can be a simple HTML page loaded before the main editor, or a native Electron dialog.

#### 2c. Go server security hardening

When running in WSL Remote mode, the server binds to `0.0.0.0` (network-accessible). Add token-based auth:

```go
// server/main.go
var authToken = flag.String("token", "", "auth token (required for non-localhost)")

func authMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if *authToken != "" {
            token := r.Header.Get("Authorization")
            if token != "Bearer "+*authToken {
                http.Error(w, "unauthorized", http.StatusUnauthorized)
                return
            }
        }
        next.ServeHTTP(w, r)
    })
}
```

The Electron app generates a random token on each launch, passes it to the Go server via `-token` flag, and injects it into the frontend via `window.__QUIPU_AUTH_TOKEN__`.

#### 2d. CORS updates

Extend `allowedOrigins` in `server/main.go`:

```go
var allowedOrigins = map[string]bool{
    "http://localhost:5173": true,
    "http://localhost:3000": true,
    "file://":              true,  // Electron loading from dist/
}

// Or better: accept origin from flag
var corsOrigin = flag.String("cors-origin", "", "additional CORS origin")
```

#### 2e. File watching via WebSocket

The `browserFS.onDirectoryChanged` is currently a no-op. For parity with Electron mode, add a WebSocket channel for file change notifications from the Go server. This is a nice-to-have for Phase 2 — the editor works without it (just needs manual refresh).

---

### Phase 3: Developer Experience Polish

- **Status bar indicator**: Show "Local" or "WSL: Ubuntu" connection mode
- **Reconnection**: If server connection drops, show overlay with retry/reconnect
- **Port conflict handling**: Dynamic port assignment with retry
- **Go server auto-install in WSL**: If user doesn't have the server binary in WSL, offer to copy it
- **Settings UI**: Configure default mode, WSL distro, server port

## Acceptance Criteria

### Phase 1 (Windows Build)
- [ ] `npm run build:release` produces a working Windows `.exe` installer
- [ ] App launches on Windows, Go server starts automatically
- [x] Files, search, git operations all work via Go server
- [x] Build can be done entirely from WSL (no Windows toolchain needed)
- [x] Multiple app instances don't conflict (dynamic ports)

### Phase 2 (WSL Remote)
- [ ] App detects available WSL distros on startup
- [ ] User can choose to connect to WSL Go server
- [ ] File operations read/write WSL filesystem
- [ ] Terminal sessions run in WSL (Linux shell)
- [ ] Git operations work on WSL repos
- [ ] Auth token prevents unauthorized access

## Technical Considerations

### Terminal on Native Windows
`creack/pty` uses Unix PTY syscalls — it won't compile with PTY support for `GOOS=windows`. Options:
1. **Use `conpty`** — Windows' pseudo-console API. The Go library [`github.com/UserExistsError/conpty`](https://github.com/UserExistsError/conpty) provides this. Build-tag switch between `creack/pty` (Linux/macOS) and `conpty` (Windows).
2. **Skip terminal in standalone Windows mode** — only offer terminal in WSL Remote mode where PTY works natively. Show a message like "Terminal available in WSL Remote mode."
3. **Pipe-based fallback** — use `os/exec` with piped stdin/stdout. Works but no colors/resize/interactive programs.

Recommendation: Option 2 for Phase 1 (simplest), Option 1 for Phase 3.

### What Stays vs. What Changes

| File                            | Changes?   | Notes                                      |
| ------------------------------- | ---------- | ------------------------------------------ |
| `electron/main.cjs`             | Keep as-is | Still used for full Electron dev mode      |
| `electron/preload.cjs`          | Keep as-is | Still used for full Electron dev mode      |
| `electron/main-thin.cjs`        | **New**    | Thin shell for production builds           |
| `electron/wsl.cjs`              | **New**    | WSL detection and server management        |
| `src/config.js`                 | **New**    | Centralized server URL config              |
| `src/services/fileSystem.js`    | Modify     | Import URL from config.js                  |
| `src/services/searchService.js` | Modify     | Import URL from config.js                  |
| `src/services/gitService.js`    | Modify     | Import URL from config.js                  |
| `src/components/Terminal.jsx`   | Modify     | Import WS URL from config.js               |
| `server/main.go`                | Modify     | Add `/health`, `-token` flag, CORS updates |
| `scripts/build-server.sh`       | **New**    | Go cross-compilation                       |
| `scripts/build-release.sh`      | **New**    | Full release build pipeline                |
| `package.json`                  | Modify     | Add `build` config for electron-builder    |

### Keeping Full Electron Mode

The existing `electron/main.cjs` + `preload.cjs` + IPC handlers remain untouched. They're used for:
- Local development (`npm run start`)
- Future macOS builds where node-pty works natively

The `package.json` `main` field switches between modes:
- Dev: `"main": "electron/main.cjs"` (full IPC mode)
- Production build: electron-builder uses `"main": "electron/main-thin.cjs"` via the `build.files` config

## Dependencies & Risks

| Risk                                    | Mitigation                                                               |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `creack/pty` doesn't work on Windows    | Expected — skip terminal in standalone Windows mode, works in WSL Remote |
| WSL2 localhost forwarding unreliable    | Use `wsl hostname -I` as fallback to get WSL IP directly                 |
| electron-builder Wine/NSIS fails on WSL | Fall back to building on Windows directly via PowerShell                 |
| Go server crashes                       | Health check loop with auto-restart (3 attempts)                         |
| Port 3000 already in use                | Dynamic port assignment via `net.Listen(":0")`                           |
| Multiple windows share one server       | Single server, multiple BrowserWindows connecting to same port           |

## Sources & References

### Internal References
- Dual-runtime adapter pattern: [src/services/fileSystem.js](src/services/fileSystem.js)
- Go server endpoints: [server/main.go](server/main.go)
- Electron main process: [electron/main.cjs](electron/main.cjs)
- WSL dialog workaround: [docs/solutions/integration-issues/file-explorer-editor-integration-fixes.md](docs/solutions/integration-issues/file-explorer-editor-integration-fixes.md)

### External References
- [electron-builder: Multi Platform Build](https://www.electron.build/multi-platform-build.html) — cross-compilation limitations
- [electron-builder: Application Contents](https://www.electron.build/contents.html) — `files` and `extraResources` config
- [Electron Forge: Developing with WSL](https://www.electronforge.io/guides/developing-with-wsl) — WSL build guidance
- [Go cross-compilation](https://go.dev/wiki/WindowsCrossCompiling) — `GOOS`/`GOARCH` usage
- [creack/pty](https://github.com/creack/pty) — pure Go, no CGO, Unix-only PTY

### Origin
- **Brainstorm document:** [docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md](docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md) — established dual-runtime architecture and Go server as the canonical backend
