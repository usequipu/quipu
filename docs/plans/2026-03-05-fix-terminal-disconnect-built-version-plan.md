---
title: "Fix Terminal Disconnection in Built Version"
type: fix
status: active
date: 2026-03-05
---

# Fix Terminal Disconnection in Built Version

## Overview

The terminal shows "Disconnected from terminal server" in the built (production) version of the app. This works fine in dev mode.

## Problem

In `Terminal.jsx` lines 170-172, the WebSocket `onclose` handler fires:
```javascript
ws.onclose = () => {
  xterm.writeln("\r\n\x1b[31mDisconnected from terminal server\x1b[0m");
};
```

This means the WebSocket connection to `${WS_URL}/term` is either:
1. Never establishing (server not running / wrong URL)
2. Establishing then immediately closing
3. Rejected by the server

## Root Cause Analysis

### URL Configuration (`src/config.js`)

```javascript
const config = window.__QUIPU_CONFIG__;
export const SERVER_URL = config?.serverUrl || 'http://localhost:3000';
export const WS_URL = config?.wsUrl || SERVER_URL.replace(/^http/, 'ws');
```

In dev mode, this defaults to `ws://localhost:3000`. In a **built** version:
- If `window.__QUIPU_CONFIG__` is not set, it still defaults to `localhost:3000`
- If the Go server isn't running, the WebSocket will fail immediately
- If built as Electron, it should use IPC instead of WebSocket (check `isElectron()` detection)

### Likely Root Causes

1. **Go server not started**: Built browser version requires the Go server to be running separately. If the user runs the built app without `go run main.go`, the terminal can't connect.
2. **Electron mode detection failure**: If `isElectron()` returns false in the built Electron app, it falls through to the browser WebSocket path, which won't work without the Go server.
3. **URL mismatch**: The built app might be served from a different origin/port, and `localhost:3000` is hardcoded as the fallback.
4. **No reconnection logic**: Unlike the file watcher (`fileWatcher.js` lines 51-56 has 5-second reconnect), the terminal has no reconnection — one disconnect is permanent.

### Investigation Steps

1. **Determine build context**: Is this Electron build or browser build?
2. **Check `isElectron()` in built Electron**: Verify `window.electronAPI` is available
3. **Check if Go server runs**: In browser build, verify Go server is started
4. **Check WebSocket URL**: Log `WS_URL` in built version to verify it resolves correctly

## Proposed Solution

### 1. Add Terminal Reconnection (`src/components/Terminal.jsx`)

Add reconnection logic matching the file watcher pattern:
- On `ws.onclose`, attempt reconnect after 3 seconds
- Max 5 retry attempts
- Show "Reconnecting..." message instead of immediately showing "Disconnected"
- After max retries, show final "Disconnected" message with a "Reconnect" button

### 2. Validate Electron Detection (`src/components/Terminal.jsx`)

Ensure the `isElectron()` check at line 148 correctly identifies Electron in built apps. Add logging if it falls through to browser mode unexpectedly.

### 3. Improve Error Messages (`src/components/Terminal.jsx`)

- `ws.onerror`: Show the actual WebSocket URL that failed
- `ws.onclose`: Distinguish between "never connected" vs "lost connection"

### 4. Config Validation (`src/config.js`)

- Add a dev warning if `SERVER_URL` is still defaulting to `localhost:3000` in a non-dev build
- Consider reading from environment variables or a config file during build

## Files to Modify

- `src/components/Terminal.jsx` — add reconnection logic, improve error messages
- `src/config.js` — add build-time URL validation (if needed)
- `electron/preload.cjs` — verify terminal IPC is properly exposed (if Electron build issue)

## Acceptance Criteria

- [ ] Terminal connects successfully in built version (both Electron and browser)
- [ ] Terminal attempts reconnection on disconnect (3-5 retries)
- [ ] User sees "Reconnecting..." message during retry attempts
- [ ] Clear error message when all retries are exhausted
- [ ] Dev mode continues to work as before
