---
name: git-service
description: Pattern for using and extending the git integration service for source control operations
triggers:
  - git integration
  - source control
  - git status
  - git commit
  - git push
  - git pull
  - git diff
  - stage files
  - unstage files
  - branch switching
  - gitService
  - SourceControlPanel
---

# Git Service Pattern

Use this skill when working with or extending git integration in Quipu.

## Service API

`src/services/gitService.js` follows the [dual-runtime-service](dual-runtime-service.md) adapter pattern.

```javascript
import gitService from '../services/gitService';

// All methods take workspacePath as first argument
const workspacePath = useWorkspace().workspacePath;

// Status
const { staged, unstaged, untracked } = await gitService.status(workspacePath);
// staged:    [{ path: 'file.js', status: 'M' }]   // M=modified, A=added, D=deleted, R=renamed
// unstaged:  [{ path: 'file.js', status: 'M' }]
// untracked: ['newfile.js']

// Diff (raw diff text)
const diffText = await gitService.diff(workspacePath, 'file.js', false);  // staged=false
const stagedDiff = await gitService.diff(workspacePath, 'file.js', true); // staged=true

// Stage / Unstage
await gitService.stage(workspacePath, ['file1.js', 'file2.js']);
await gitService.unstage(workspacePath, ['file1.js']);

// Commit
const { output } = await gitService.commit(workspacePath, 'commit message');

// Push / Pull
const { output } = await gitService.push(workspacePath);
const { output } = await gitService.pull(workspacePath);

// Branches
const { branches, current } = await gitService.branches(workspacePath);
// branches: ['main', 'feat/foo']
// current: 'main'

// Checkout
await gitService.checkout(workspacePath, 'feat/foo');

// Log
const { entries } = await gitService.log(workspacePath);
// entries: [{ hash: 'abc1234', message: 'commit message' }]
```

## Backend Endpoints

### Go Server (`server/main.go`)

| Endpoint | Method | Body/Params | Returns |
|---|---|---|---|
| `/git/status` | GET | - | `{ staged, unstaged, untracked }` |
| `/git/diff` | GET | `?file=&staged=` | Raw diff text |
| `/git/stage` | POST | `{ files: [...] }` | `{ success: true }` |
| `/git/unstage` | POST | `{ files: [...] }` | `{ success: true }` |
| `/git/commit` | POST | `{ message: "..." }` | `{ output: "..." }` |
| `/git/push` | POST | - | `{ output: "..." }` |
| `/git/pull` | POST | - | `{ output: "..." }` |
| `/git/branches` | GET | - | `{ branches, current }` |
| `/git/checkout` | POST | `{ branch: "..." }` | `{ success: true }` |
| `/git/log` | GET | - | `{ entries: [{hash, message}] }` |

All git endpoints use `workspaceRoot` as the working directory. All commands use `exec.CommandContext` with 30-second timeout.

### Git Helper

```go
func runGitCommand(args ...string) (string, string, error) {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    cmd := exec.CommandContext(ctx, "git", args...)
    cmd.Dir = workspaceRoot
    // returns stdout, stderr, error
}
```

## UI Component

### SourceControlPanel (`src/components/SourceControlPanel.jsx`)

Side panel with sections:
- **Branch indicator**: Current branch + dropdown to switch
- **Commit section**: Textarea (Ctrl+Enter to commit) + commit button
- **Staged changes**: File list with A/M/D/R status badges, unstage buttons
- **Unstaged changes**: File list with status badges, stage buttons
- **Untracked files**: File list with stage buttons
- **Push/Pull buttons**: With loading states
- **Recent commits**: Collapsible section showing last 20 commits

Polls git status every 5 seconds while panel is visible. Refreshes immediately after stage/unstage/commit/push/pull.

## Status Codes

| Code | Meaning | Color |
|---|---|---|
| M | Modified | Orange (`var(--accent-color)`) |
| A | Added | Green (`#0dbc79`) |
| D | Deleted | Red (`#cd3131`) |
| R | Renamed | Blue (`#2472c8`) |
| C | Copied | Blue (`#2472c8`) |
| U | Unmerged | Purple (`#bc3fbc`) |
| ? | Untracked | Gray |

## Security

- File paths in `/git/stage` and `/git/unstage` are validated with `isWithinWorkspace()`
- Diff file paths are validated before passing to git
- All git commands use `exec.Command` with argument arrays (never string concatenation)
- 30-second timeout prevents hung operations on network issues

## Extending Git

To add new git operations (e.g., `git stash`, `git branch -d`):

1. Add Go handler using `runGitCommand()` helper
2. Register endpoint in `main()` with `corsMiddleware`
3. Add Electron IPC handler using `execFile` with argument arrays
4. Add preload bridge method
5. Add method to `gitService.js` (both implementations)
6. Add UI in SourceControlPanel if needed
