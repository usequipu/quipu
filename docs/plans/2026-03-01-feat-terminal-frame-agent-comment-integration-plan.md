---
title: "feat: Terminal & FRAME Agent Comment Integration"
type: feat
status: active
date: 2026-03-01
---

# feat: Terminal & FRAME Agent Comment Integration

## Overview

Add a per-file metadata system called **FRAME** (Feedback-Referenced Active Modification Envelope) that stores annotations, AI instructions, and conversation history in `.quipu/meta/`, mirroring the workspace folder structure. Integrate this with Claude Code via skills, a slash command, and a hook so Claude automatically has context about each file. Add a keyboard shortcut to invoke Claude from the editor, and fix the terminal to always start in the workspace root.

## Problem Statement / Motivation

Currently there is no way to persist per-file context between Claude sessions. Every time a user asks Claude to review or modify a file, they must re-explain the file's purpose, known issues, and past decisions. The terminal also starts in `$HOME` (Electron) or the Go server's CWD (browser) instead of the workspace root, requiring a manual `cd` every time.

FRAME solves this by giving each source file a sidecar JSON metadata file that Claude automatically reads, creating persistent memory about individual files across sessions.

## Proposed Solution

Four independent but complementary changes:

1. **FRAME file system** — `.quipu/meta/{relative-path}.frame.json` JSON sidecar files
2. **Claude Code integration** — skill (`.claude/skills/frame.md`), slash command (`.claude/commands/frame.md`), and hook in `.claude/settings.json`
3. **Keyboard shortcut** — Ctrl+Shift+L launches Claude in the embedded terminal with current file + FRAME context
4. **Terminal cwd fix** — terminal always starts in `workspacePath`

## Technical Considerations

### FRAME JSON Schema (v1)

```json
{
  "version": 1,
  "type": "frame",
  "id": "uuid-v4",
  "filePath": "src/components/Editor.jsx",
  "createdAt": "2026-03-01T12:00:00Z",
  "updatedAt": "2026-03-01T14:30:00Z",
  "annotations": [
    {
      "id": "uuid-v4",
      "line": 42,
      "text": "Refactor this to use useCallback",
      "type": "review",
      "author": "user",
      "timestamp": "2026-03-01T12:00:00Z"
    }
  ],
  "instructions": "This file handles the TipTap editor setup. Always preserve the comment mark extension when modifying.",
  "history": [
    {
      "id": "uuid-v4",
      "prompt": "Review this file for performance issues",
      "summary": "Found unnecessary re-renders in useEffect...",
      "timestamp": "2026-03-01T13:00:00Z"
    }
  ]
}
```

**Design decisions:**
- `annotations[].line` uses line numbers as approximate anchors — accepted as "good enough" for MVP. Claude re-resolves positions when reading the file.
- `history[]` capped at **20 entries** (FIFO eviction). Full responses stored as `summary` (not raw output) to keep file size under 100KB.
- `annotations[].type` enum: `review`, `todo`, `bug`, `question`, `instruction`
- All timestamps ISO 8601 UTC
- UUIDs on both the FRAME root and each annotation/history entry for stable references

### Architecture — What Changes Where

**Phase 1: Terminal cwd fix** (dual-runtime, 4 files)

| File | Change |
|---|---|
| `server/main.go` ~line 342 | Set `cmd.Dir = workspaceRoot` before `pty.StartWithSize` |
| `electron/main.cjs` ~line 524 | Accept `cwd` option in `terminal-create` IPC handler, use as `pty.spawn` cwd |
| `electron/preload.cjs` | Update `createTerminal` to pass `cwd` argument |
| `src/components/Terminal.jsx` ~line 83 | Accept `workspacePath` prop, pass to `createTerminal(workspacePath)` |

**Phase 2: FRAME service layer** (reuse existing fileSystem.js)

| File | Change |
|---|---|
| `src/services/frameService.js` (NEW) | Thin wrapper around `fileSystem.js` — computes FRAME path from workspace + file path, handles JSON parse/serialize, ensures directory creation via `fs.createFolder`, manages schema validation and history cap |

No new Go endpoints or Electron IPC needed — FRAME files are regular JSON files within the workspace, readable/writable via existing `fileSystem.readFile` / `fileSystem.writeFile`. The `.quipu/` directory is already auto-hidden from file explorer (dot-prefix filtering in both runtimes).

**Phase 3: Claude Code skill + command + hook** (3 new files)

| File | Purpose |
|---|---|
| `.claude/skills/frame.md` (NEW) | Skill that teaches Claude the FRAME format, how to read/write/update FRAMEs, and path conventions |
| `.claude/commands/frame.md` (NEW) | User-invocable `/frame` command — accepts a file path argument, reads or creates the FRAME |
| `.claude/settings.json` (NEW or EDIT) | Hook configuration: `PostToolUse` on `Read` tool — runs a script that checks for a FRAME sidecar and outputs its contents to Claude's context |

**Hook configuration:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/scripts/load-frame.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

The hook script receives the `Read` tool's input (including `file_path`) on stdin as JSON, computes the corresponding FRAME path, and if it exists, outputs the FRAME contents to stdout so they are appended to Claude's context.

| File | Purpose |
|---|---|
| `.claude/scripts/load-frame.sh` (NEW) | Hook script — reads stdin JSON, extracts `file_path`, checks for `.quipu/meta/{relative}.frame.json`, outputs contents if found |

**Phase 4: Keyboard shortcut** (1 file)

| File | Change |
|---|---|
| `src/App.jsx` ~line 109 | Add `Ctrl+Shift+L` handler: (1) guard `activeFile` null check, (2) auto-save if dirty, (3) expand terminal if collapsed, (4) check if Claude is already running (track via React state), (5) if not running launch `claude`, (6) send file path + FRAME summary as prompt context |

**Claude detection strategy (MVP):** Track a boolean `isClaudeRunning` in App state. Set to `true` when the shortcut types `claude\r`. Set to `false` when terminal is reset/cleared. If Claude is already running, send the context directly as a prompt instead of launching a new instance.

### Files to exclude `.quipu/` from

| File | Location | Change |
|---|---|---|
| `server/main.go` | `excludeDirs` set ~line 423 | Add `".quipu"` |
| `electron/main.cjs` | `excludeDirs` in `read-directory-recursive` | Add `".quipu"` |

This prevents FRAME files from appearing in search results and QuickOpen.

### `.gitignore` recommendation

```
# FRAME metadata (per-developer AI context)
.quipu/meta/
```

Keep `.quipu/` itself trackable for potential future shared config, but ignore `meta/` since it contains per-developer conversation history.

## System-Wide Impact

- **Interaction graph**: Keyboard shortcut → `handleSendToClaude()` → Terminal.write → Claude CLI → Claude reads file → `PostToolUse` hook fires → `load-frame.sh` → FRAME JSON loaded into context
- **Error propagation**: FRAME read/write failures should show toast notifications (`showToast(message, 'error')`), never silently fail. Hook script failures are logged by Claude Code but don't block the Read operation.
- **State lifecycle risks**: FRAME files orphan when source files are renamed/deleted. Acceptable for MVP — add cleanup command later.
- **API surface parity**: Both Electron and browser runtimes already support `readFile`/`writeFile`/`createFolder` which is all FRAME needs. No new endpoints.

## Acceptance Criteria

### Phase 1: Terminal cwd fix
- [x] Terminal starts in workspace root in Electron runtime (`electron/main.cjs`)
- [x] Terminal starts in workspace root in browser runtime (`server/main.go`)
- [x] `Terminal.jsx` passes `workspacePath` to terminal creation
- [x] Preload bridge updated to accept `cwd` argument

### Phase 2: FRAME service
- [x] `src/services/frameService.js` created with: `getFramePath(workspacePath, filePath)`, `readFrame(workspacePath, filePath)`, `writeFrame(workspacePath, filePath, frame)`, `createFrame(workspacePath, filePath)`
- [x] Automatically creates `.quipu/meta/` directory tree when writing a FRAME
- [x] JSON parse errors handled gracefully (returns null + toast)
- [x] History capped at 20 entries with FIFO eviction
- [x] `.quipu` added to `excludeDirs` in both runtimes
- [x] `.quipu/meta/` added to `.gitignore`

### Phase 3: Claude Code integration
- [x] `.claude/skills/frame.md` — documents FRAME format, path conventions, read/write instructions
- [x] `.claude/commands/frame.md` — `/frame [filepath]` command that reads or creates a FRAME
- [x] `.claude/scripts/load-frame.sh` — hook script that loads FRAME on file read
- [x] `.claude/settings.json` — `PostToolUse` hook on `Read` tool configured
- [x] Hook correctly outputs FRAME contents when file has a sidecar, silently skips when not

### Phase 4: Keyboard shortcut
- [x] `Ctrl+Shift+L` bound in `App.jsx`
- [x] Guards: no-op if no active file, shows toast if terminal disconnected
- [x] Auto-saves dirty file before sending to Claude
- [x] Expands terminal panel if collapsed
- [x] Detects if Claude is already running — sends prompt directly vs launches new instance
- [x] Sends file path and FRAME summary (if exists) as context
- [x] File path included in the prompt so Claude knows which file is being discussed

## Success Metrics

- Terminal always starts in workspace root (zero manual `cd` needed)
- FRAME files are created, read, and updated without errors across both runtimes
- Claude automatically receives FRAME context when reading files with existing FRAMEs
- User can invoke Claude from any open file with a single keyboard shortcut
- FRAME files are invisible in file explorer, search, and QuickOpen

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| Claude detection in terminal is fragile (MVP approach) | Track state locally; improve with terminal output parsing in v2 |
| Line-based annotations go stale after edits | Accept for MVP; future: content-hash anchoring |
| FRAME orphaning on file rename/delete | Defer cleanup to future iteration; orphaned files are harmless |
| Hook script may not have workspace path | Script reads `cwd` from stdin JSON and resolves relative paths |
| 1s setTimeout for Claude startup is fragile | Improve by watching terminal output for Claude's ready prompt |

## Sources & References

### Internal References
- Keyboard shortcut pattern: [App.jsx:64-120](src/App.jsx#L64-L120)
- Existing `handleSendToTerminal`: [App.jsx:122-158](src/App.jsx#L122-L158)
- Terminal component: [Terminal.jsx](src/components/Terminal.jsx)
- Electron terminal creation: [electron/main.cjs:524](electron/main.cjs#L524) (`cwd: process.env.HOME`)
- Go terminal handler: [server/main.go:328-397](server/main.go#L328-L397) (no `cmd.Dir` set)
- Go excludeDirs: [server/main.go:423](server/main.go#L423)
- WorkspaceContext file paths: [WorkspaceContext.jsx](src/context/WorkspaceContext.jsx)
- Existing skills format: [.claude/skills/](/.claude/skills/)

### External References
- Claude Code skills documentation: https://code.claude.com/docs/en/skills
- Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide
- Agent Skills standard: https://agentskills.io
