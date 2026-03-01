---
title: "Cross-compiling Electron app from WSL2 to Windows: node-pty and native module workaround"
date: 2026-02-28
category: build-errors
tags:
  - electron
  - wsl2
  - cross-compilation
  - node-pty
  - native-modules
  - windows
  - go
  - thin-shell
severity: medium
components:
  - electron/main-thin.cjs
  - electron/preload-thin.cjs
  - src/config.js
  - src/services/fileSystem.js
  - src/services/searchService.js
  - src/services/gitService.js
  - src/components/Terminal.jsx
  - server/main.go
  - package.json
  - scripts/build-server.sh
  - scripts/build-release.sh
symptoms:
  - "electron-builder cannot cross-compile node-pty from Linux to Windows"
  - "Hardcoded http://localhost:3000 URLs prevent configurable server connections"
  - "No electron-builder configuration exists for Windows builds"
root_cause: "Native C++ modules (node-pty) cannot be cross-compiled from WSL2 to Windows, and the frontend lacked configurable server URLs for dynamic port assignment"
---

# Cross-Compiling Electron from WSL2: Native Module Workaround

## Problem Description

When building Quipu (React + Vite + Electron app with Go backend) for Windows from WSL2, the build fails because `node-pty` is a C++ native module requiring MSVC compilation. electron-builder cannot cross-compile native modules from Linux to Windows — the resulting `.node` binary is compiled for the wrong platform.

Additional blockers:
- Server URLs hardcoded as `http://localhost:3000` in 4 frontend files
- No electron-builder `build` config in `package.json`
- Go server's `creack/pty` uses Unix PTY syscalls (no native Windows terminal support)

## Root Cause

Native Node.js modules compiled via `node-gyp` produce platform-specific binaries. `node-pty` compiles C++ code against the host OS — from WSL2, this produces a Linux ELF binary that won't load in a Windows Electron process. There is no viable cross-compilation path without a full Windows MSVC toolchain.

## Solution: Thin Shell Architecture

Instead of cross-compiling `node-pty`, eliminate it from the Electron build entirely. The project already had a complete browser-mode code path (HTTP/WebSocket to Go server) that mirrored 100% of the Electron IPC surface. The thin shell forces browser-mode by not exposing `window.electronAPI`.

### New files created

**`electron/main-thin.cjs`** — Production Electron main process:
- Finds a free TCP port (starting from 3000, falls back to OS-assigned)
- Spawns bundled Go server binary with `-addr 127.0.0.1:{port}`
- Polls `/health` endpoint every 100ms until ready (10s timeout)
- Creates BrowserWindow with `preload-thin.cjs` (no IPC handlers)
- Kills Go server on app quit
- Sets executable permissions on Unix before spawning

**`electron/preload-thin.cjs`** — Minimal preload:
```javascript
const { contextBridge } = require('electron');
const port = process.env.QUIPU_SERVER_PORT || '3000';
contextBridge.exposeInMainWorld('__QUIPU_CONFIG__', {
    serverUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
});
```

Note: `window.electronAPI` is intentionally NOT exposed — this triggers browser-mode in all service adapters.

**`src/config.js`** — Centralized URL config:
```javascript
const config = window.__QUIPU_CONFIG__;
export const SERVER_URL = config?.serverUrl || 'http://localhost:3000';
export const WS_URL = config?.wsUrl || SERVER_URL.replace(/^http/, 'ws');
```

### Files modified

Service files replaced `const GO_SERVER = 'http://localhost:3000'` with:
```javascript
import { SERVER_URL } from '../config.js';
const GO_SERVER = SERVER_URL;
```

Applied to: `fileSystem.js`, `searchService.js`, `gitService.js`, `Terminal.jsx`

### electron-builder config

```json
{
  "build": {
    "extraMetadata": { "main": "electron/main-thin.cjs" },
    "files": ["dist/**/*", "electron/main-thin.cjs", "electron/preload-thin.cjs", "package.json"],
    "extraResources": [{ "from": "server/bin/${os}/", "to": "server/" }],
    "win": { "target": ["nsis", "portable"] },
    "linux": { "target": ["AppImage"] }
  }
}
```

`extraMetadata.main` overrides the `main` field only in the packaged app, keeping `electron/main.cjs` for development.

### Go server cross-compilation

```bash
cd server
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o bin/win/quipu-server.exe .
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o bin/linux/quipu-server .
```

`creack/pty` is pure Go (no CGO) — cross-compilation works without any Windows toolchain. Binaries are ~5.8MB (Windows) and ~5.6MB (Linux).

## Key Decisions

1. **Thin shell over fixing cross-compilation**: Rather than fighting `node-pty` builds, leverage the existing browser-mode code path. Zero frontend logic changes needed.

2. **Preload + contextBridge over executeJavaScript**: Early attempt used `did-finish-load` + `executeJavaScript` to inject server URL — this failed because ES modules evaluate before that event fires. Preload runs before any renderer code.

3. **Dynamic port assignment**: Go server spawns on a free port to prevent conflicts with multiple instances or occupied ports.

4. **`extraMetadata.main` for build-only override**: Dev mode still uses `electron/main.cjs` with full IPC + `node-pty`. No dev workflow changes.

## Prevention Strategies

### Avoid native modules in Electron builds
Treat the Electron shell as a thin Chromium wrapper. Native functionality should run in a separate process (Go binary, Rust sidecar) communicating over HTTP/WebSocket. The `isElectron()` adapter pattern already supports this — default to the HTTP path.

### Centralize configuration
Never hardcode URLs, ports, or environment-dependent values in multiple files. Use a single config module (`src/config.js`) that reads from the appropriate source (preload bridge, env var, or fallback).

### ES module timing
Never rely on `window.*` globals at module top level for runtime configuration. ES modules evaluate at import time, before DOM events or script injection. Use preload + `contextBridge` (Electron) or build-time substitution (`import.meta.env` in Vite).

## Testing Checklist

- [ ] `npm run dev` — browser mode with Go server still works
- [ ] `npm run start` — Electron dev mode with full IPC still works
- [ ] `npm run build` — Vite build succeeds with new imports
- [ ] `bash scripts/build-server.sh` — Go cross-compilation for Windows + Linux
- [ ] `npm run build:release` — electron-builder produces Windows installer
- [ ] Packaged app launches, Go server starts, basic operations work
- [ ] Multiple app instances don't conflict (dynamic ports)

## Related Documentation

- [Dual-runtime adapter pattern](../ui-bugs/editor-overhaul-tabs-search-git.md) — The "4-place rule" for new backend features
- [WSL folder dialog fallback](../integration-issues/file-explorer-editor-integration-fixes.md) — Fix 6: native dialog fails on WSL
- [electron-squirrel-startup handling](../integration-issues/file-explorer-editor-integration-fixes.md) — Fix 5: optional module crash
- [electron-builder: Multi Platform Build](https://www.electron.build/multi-platform-build.html) — Official cross-compilation docs
- [Go cross-compilation](https://go.dev/wiki/WindowsCrossCompiling) — `GOOS`/`GOARCH` usage
