---
title: "Windows 403 Forbidden on Go Server and Test Suite Setup Fixes"
date: 2026-03-07
category: runtime-error
severity: high
component:
  - server/main.go
  - vitest.config.js
  - src/test/__mocks__/excalidraw.jsx
  - src/components/Terminal.test.jsx
tags:
  - cors
  - websocket
  - windows
  - path-sandboxing
  - ipv6
  - vitest
  - testing
  - infinite-loop
  - mocking
related_issues:
  - "PR #37: feat: add test suite + fix Windows 403 server errors"
  - "PR #36: Terminal WebSocket reconnection fix"
related_docs:
  - docs/solutions/integration-issues/terminal-websocket-reconnection.md
  - docs/solutions/build-errors/electron-cross-platform-native-modules-wsl.md
  - docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md
  - docs/plans/2026-03-06-feat-comprehensive-test-suite-plan.md
time_to_resolve: ~2h
---

# Windows 403 Forbidden on Go Server + Test Suite Fixes

## Problem Symptom

On the Windows built version, the Go server returned **HTTP 403 Forbidden** for both:
- WebSocket connections: `ws://127.0.0.1:3000/term` failed during handshake
- REST API calls: `/files?path=C%3A%5CUsers%5CIago` returned 403 with "path outside workspace"

The terminal showed "WebSocket error" followed by "Disconnected from terminal server" and the file explorer showed "Failed to read directory: Forbidden".

Additionally, the new test suite had:
- ExcalidrawViewer tests hanging indefinitely (infinite render loop)
- Terminal reconnection tests failing (off-by-one in retry loop)

## Investigation Steps

1. Read `server/main.go` — identified `isLocalOrigin()` origin checking and `isWithinWorkspace()` path validation
2. Traced the 403 sources: WebSocket upgrader's `CheckOrigin` for `/term`, and `isWithinWorkspace` for `/files`
3. Discovered workspace auto-detection race: first `/files` request sets `workspaceRoot`, then folder picker browsing parent directories gets blocked
4. Found `/term` and `/watch` endpoints were NOT wrapped with `corsMiddleware` — missing CORS preflight handling
5. For tests: traced ExcalidrawViewer hang to mock component calling `excalidrawAPI()` on every render, triggering setState infinite loop

## Root Cause

### Go Server 403 (Primary)

**Path sandboxing too restrictive**: The `workspaceRoot` was auto-detected from the first `/files` request. If a workspace-specific request arrived first (e.g., `C:\Users\Iago\project`), then subsequent requests to browse parent directories (e.g., `C:\Users\Iago` for the folder picker) were blocked by `isWithinWorkspace()` returning false.

**WebSocket endpoints missing CORS middleware**: The `/term` and `/watch` handlers were registered directly without `corsMiddleware`, so browser preflight `OPTIONS` requests before WebSocket upgrade got no CORS headers.

**Incomplete origin allowlist**: IPv6 loopback `[::1]` was missing from `isLocalOrigin()`.

### Test Suite (Secondary)

**ExcalidrawViewer infinite loop**: The mock Excalidraw component called `excalidrawAPI()` during render. The parent component had `excalidrawAPI={(api) => setExcalidrawAPI(api)}`, so each render triggered setState, causing another render — infinite loop.

**Terminal test off-by-one**: The test loop called `onclose()` MAX_RETRIES times but didn't advance timers between iterations. Each `onclose` schedules `setTimeout(connect, RETRY_DELAY)` — without advancing timers, `connect()` never runs and the retry counter never reaches the "Max retries reached" branch.

## Solution

### Fix 1: Relaxed Path Sandboxing

Added a `workspaceExplicit` flag that's only true when `-workspace` is passed on the command line. When auto-detected, sandboxing is permissive:

```go
var workspaceExplicit bool

func isWithinWorkspace(absPath string) bool {
    if !workspaceExplicit {
        return true // No explicit sandbox — allow any path
    }
    if workspaceRoot == "" {
        return false
    }
    resolved, err := filepath.Abs(absPath)
    if err != nil {
        return false
    }
    rel, err := filepath.Rel(workspaceRoot, resolved)
    if err != nil {
        return false
    }
    if strings.HasPrefix(rel, "..") {
        return false
    }
    return true
}
```

### Fix 2: Expanded Origin Allowlist + Logging

```go
func isLocalOrigin(origin string) bool {
    if origin == "" || origin == "null" || origin == "file://" {
        return true
    }
    for _, prefix := range []string{
        "http://localhost", "http://127.0.0.1", "http://[::1]",
        "https://localhost", "https://127.0.0.1", "https://[::1]",
    } {
        if strings.HasPrefix(origin, prefix) {
            return true
        }
    }
    return false
}

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool {
        origin := r.Header.Get("Origin")
        ok := isLocalOrigin(origin)
        if !ok {
            log.Printf("WebSocket origin rejected: %q", origin)
        }
        return ok
    },
}
```

### Fix 3: WebSocket Endpoints Wrapped with CORS Middleware

```go
http.HandleFunc("/watch", corsMiddleware(handleWatch))
http.HandleFunc("/term", corsMiddleware(handleTerminal))
http.HandleFunc("/health", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("ok"))
}))
```

### Fix 4: Alias-Based Excalidraw Mock

In `vitest.config.js`, the `@excalidraw/excalidraw` import is redirected to a lightweight mock at resolution time:

```js
resolve: {
  alias: [
    { find: '@excalidraw/excalidraw/index.css', replacement: './src/test/__mocks__/empty.js' },
    { find: '@excalidraw/excalidraw', replacement: './src/test/__mocks__/excalidraw.jsx' },
    { find: '@', replacement: './src' },
  ],
},
```

The mock does NOT call `excalidrawAPI` during render, breaking the infinite loop:

```jsx
export const Excalidraw = ({ initialData, onChange, theme, excalidrawAPI, UIOptions }) => {
  window.__excalidrawProps = { initialData, onChange, theme, excalidrawAPI, UIOptions };
  return <div data-testid="excalidraw-mock" data-theme={theme}>Excalidraw</div>;
};
```

### Fix 5: Terminal Test Reconnection Loop

Each iteration must advance timers to let `connect()` run before the next `onclose()`:

```js
for (let i = 0; i < MAX_RETRIES; i++) {
  mockInstance.ws.onclose();
  vi.advanceTimersByTime(RETRY_DELAY);
}
// One more close after all retries exhausted triggers "Max retries reached"
mockInstance.ws.onclose();
```

## Prevention Strategies

### Go Server CORS & Sandboxing

1. **Never auto-detect security boundaries from runtime data.** The workspace root should be an explicit configuration input, not inferred from the first request
2. **Apply middleware uniformly.** WebSocket endpoints must pass through the same CORS middleware as REST endpoints — use a top-level middleware chain
3. **Enumerate all loopback representations.** Any localhost allowlist must include `127.0.0.1`, `localhost`, `[::1]`, and empty/null origins
4. **Log rejected origins.** Silent 403s on WebSocket upgrades are extremely hard to debug without server-side logging

### Test Mocking

1. **Mocks must be inert by default.** A mock component should never call prop callbacks during render — expose imperative handles or test-callable functions instead
2. **Use alias-based mocking for heavy packages.** Vitest `resolve.alias` intercepts imports at resolution time, avoiding per-test `vi.mock()` boilerplate and preventing the real package from loading
3. **CSS alias must come first.** Vite alias matching uses first-match semantics — `@excalidraw/excalidraw/index.css` must precede `@excalidraw/excalidraw`
4. **Model the state machine, not just the count.** When testing retry logic, explicitly advance timers between retries and account for the final "exhaustion" event

### Recommended Test Cases

- Start Go server with `--workspace /tmp/testdir`, request a path outside it, assert 403
- Send CORS preflight `OPTIONS` to `/term` with various origins, assert proper headers
- Verify mock component render count is stable (not growing) after initial render
- Test retry logic with exactly MAX_RETRIES+1 close events to trigger exhaustion
