---
title: "Claude Terminal Integration: Workspace Sync Gaps"
date: 2026-03-01
category: integration-issues
tags:
  - claude-integration
  - terminal
  - state-management
  - keyboard-shortcuts
  - dual-runtime
component:
  - App.jsx
  - Terminal.jsx
severity: high
resolution_time: "30 minutes"
problem_type: integration-gap
symptoms:
  - "Browser-mode terminal doesn't start in workspace root directory"
  - "Claude cannot be re-launched after first session (isClaudeRunning stuck true)"
  - "Ctrl+Shift+Enter types 'claude' into Claude prompt instead of shell"
  - "isClaudeRunning persists across workspace changes despite terminal restart"
---

# Claude Terminal Integration: Workspace Sync Gaps

## Problem

Three integration gaps in the Claude Code CLI terminal integration, discovered while completing the plan in `docs/plans/2026-03-01-feat-terminal-frame-agent-comment-integration-plan.md`. The plan was ~95% implemented; these were the remaining defects.

### Symptom 1: Browser-mode terminal ignores workspace path

The Electron runtime correctly passed `cwd` to the PTY process, but the browser-mode WebSocket connection to the Go server didn't include the workspace path. Terminals opened in browser mode would start in the server's default directory instead of the workspace root.

### Symptom 2: isClaudeRunning stuck after first launch

After launching Claude once via `Ctrl+Shift+L`, the `isClaudeRunning` boolean was permanently `true`. All subsequent shortcut presses skipped launching Claude, even after switching workspaces (which restarts the terminal and kills any running Claude).

### Symptom 3: handleSendToTerminal launches nested Claude

`Ctrl+Shift+Enter` (handleSendToTerminal) always wrote `"claude\r"` to the terminal regardless of whether Claude was already running. If Claude was active, this typed "claude" as a prompt to Claude instead of a shell command.

## Root Cause

### 1. Dual-runtime parity gap (Terminal.jsx)

The Electron path passed workspace context:
```javascript
window.electronAPI.createTerminal(workspacePath ? { cwd: workspacePath } : undefined);
```

But the browser-mode WebSocket did not:
```javascript
// Missing workspace path
const ws = new WebSocket(`${WS_URL}/term`);
```

### 2. State lifecycle gap (App.jsx)

`isClaudeRunning` tracked the "start" event but had no mechanism for "end":
```javascript
const [isClaudeRunning, setIsClaudeRunning] = useState(false);
// Set to true on launch...
setIsClaudeRunning(true);
// ...but never set back to false
```

When `workspacePath` changes, Terminal.jsx's `useEffect` (dependency: `[workspacePath]`) runs cleanup and re-initializes, killing any running process. But App.jsx had no corresponding reset.

### 3. Handler coordination gap (App.jsx)

Two handlers both launched Claude but didn't share state:
- `handleSendToClaude` (Ctrl+Shift+L) — checked `isClaudeRunning`
- `handleSendToTerminal` (Ctrl+Shift+Enter) — ignored `isClaudeRunning`

This allowed both to independently launch Claude or send conflicting terminal writes.

## Solution

### Fix 1: Send cwd in WebSocket URL (Terminal.jsx)

```javascript
// Before
const ws = new WebSocket(`${WS_URL}/term`);

// After
const wsUrl = workspacePath
  ? `${WS_URL}/term?cwd=${encodeURIComponent(workspacePath)}`
  : `${WS_URL}/term`;
const ws = new WebSocket(wsUrl);
```

Query parameter is backwards-compatible — servers that don't read `cwd` simply ignore it.

### Fix 2: Reset isClaudeRunning on workspace change (App.jsx)

```javascript
useEffect(() => {
  setIsClaudeRunning(false);
}, [workspacePath]);
```

Mirrors the terminal restart lifecycle: when workspace changes, Terminal.jsx re-initializes (its `useEffect` has `[workspacePath]` dep), so App.jsx resets Claude state in sync.

### Fix 3: Make handleSendToTerminal Claude-aware (App.jsx)

```javascript
// Before — always launches new Claude
terminalRef.current.write("claude\r");
setTimeout(() => {
  terminalRef.current.write(output + "\r");
}, 1000);

// After — checks running state first
if (isClaudeRunning) {
  terminalRef.current.write(output + "\r");
} else {
  terminalRef.current.write("claude\r");
  setIsClaudeRunning(true);
  setTimeout(() => {
    terminalRef.current.write(output + "\r");
  }, 1000);
}
```

Both handlers now share the same `isClaudeRunning` check-before-launch pattern.

## Verification

1. **Browser-mode cwd**: Open DevTools Network tab, verify WebSocket URL contains `?cwd=<encoded-path>`. Run `pwd` in terminal — should show workspace root.
2. **State reset**: Launch Claude in workspace A, switch to workspace B, press `Ctrl+Shift+L` — should launch new Claude (not send prompt to nonexistent session).
3. **Handler coordination**: With Claude running, press `Ctrl+Shift+Enter` — should send content directly without typing "claude" as a prompt.

## Prevention Strategies

### Dual-runtime parity

Every backend-interacting feature must verify parameter parity across runtimes. Use this checklist:
- [ ] List all parameters sent by Electron path
- [ ] Verify browser path sends the same parameters
- [ ] Test feature in both runtimes before merging

### Boolean state lifecycle

Booleans that track external process state should have explicit reset paths:
- Identify all events that end the tracked state (process exit, context change, user action)
- Add `useEffect` cleanup or event listeners for each
- Consider upgrading to a state machine (`'idle' | 'starting' | 'running'`) if the boolean accumulates more transitions

### Handler coordination

When multiple handlers modify the same state:
- Extract shared logic into a single `useCallback`
- Or ensure both handlers check the state before acting
- Document which handlers read/write which state

## Related Documentation

- [Terminal & FRAME Agent Comment Integration Plan](../../plans/2026-03-01-feat-terminal-frame-agent-comment-integration-plan.md) — the original feature plan
- [FRAME System Multi-Component Sync](./frame-system-multi-component-sync.md) — prior integration work on the same feature set
- [useCallback Temporal Dead Zone in useEffect](../runtime-errors/usecallback-temporal-dead-zone-in-useeffect.md) — hook ordering convention used by keyboard shortcut handlers
- [Resizable Panels Library Integration](./resizable-panels-library-integration.md) — panel state model and keyboard shortcut binding patterns
