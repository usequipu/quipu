---
title: "Terminal WebSocket Permanent Disconnect in Built Version"
date: 2026-03-05
category: integration-issues
tags: [websocket, reconnection, reliability, terminal]
severity: critical
component: Terminal.jsx
root_cause: "No reconnection logic; single WebSocket failure resulted in permanent disconnect"
related_prs: ["#36"]
---

# Terminal WebSocket Permanent Disconnect in Built Version

## Symptom

Terminal displays red "Disconnected from terminal server" in the built/production version with no way to reconnect without reloading the app.

## Root Cause

The browser WebSocket path in `Terminal.jsx` had a single-shot connection with no retry logic:

```javascript
// Before: permanent disconnect on any close
ws.onclose = () => {
  xterm.writeln("\r\n\x1b[31mDisconnected from terminal server\x1b[0m");
};
```

Unlike the file watcher (`fileWatcher.js`) which had 5-second reconnect logic, the terminal had none.

## Solution

Replaced single-shot WebSocket with a reconnection loop:

```javascript
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000; // 3 seconds
let retryCount = 0;
let intentionalClose = false;

const connect = () => {
  const ws = new WebSocket(wsUrl);
  instance.ws = ws;

  ws.onopen = () => {
    retryCount = 0;
    xterm.writeln("\x1b[32mConnected to terminal server\x1b[0m");
    ws.send(JSON.stringify({ cols: xterm.cols, rows: xterm.rows }));
  };

  ws.onclose = () => {
    if (intentionalClose) return;
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      xterm.writeln(`\r\n\x1b[33mDisconnected. Reconnecting (${retryCount}/${MAX_RETRIES})...\x1b[0m`);
      instance.reconnectTimer = setTimeout(connect, RETRY_DELAY);
    } else {
      xterm.writeln("\r\n\x1b[31mDisconnected from terminal server. Max retries reached.\x1b[0m");
      xterm.writeln(`\x1b[2mServer URL: ${wsUrl}\x1b[0m`);
    }
  };
};

// Prevent reconnection on intentional close (tab close, unmount)
instance.stopReconnect = () => {
  intentionalClose = true;
  clearTimeout(instance.reconnectTimer);
};
```

**Critical**: `stopReconnect()` must be called in ALL cleanup paths:
- Tab removal in `useEffect` cleanup
- Component unmount cleanup
- Close tab button handler (`handleCloseTab`)

## Pattern: WebSocket Reconnection

When adding WebSocket connections in this codebase:
1. Always include reconnection logic with max retries
2. Use `intentionalClose` flag to distinguish deliberate close from errors
3. Call `stopReconnect()` in every cleanup path to prevent orphan timers
4. Show progressive feedback: yellow for retrying, red for final failure
5. Display the URL on failure for debugging

## Related

- [Claude Terminal Workspace Sync](../integration-issues/claude-terminal-workspace-sync.md)
- [File Watcher Editor Reload Integration](../integration-issues/file-watcher-editor-reload-integration.md)
