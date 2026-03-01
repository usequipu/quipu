---
title: "Hidden files and folders not visible in file explorer"
date: "2026-03-01"
category: "ui-bugs"
tags: [file-explorer, dotfiles, dual-runtime, filtering]
component: "FileExplorer"
severity: "high"
symptoms:
  - "Hidden folders like .quipu/, .claude/ not visible in file explorer sidebar"
  - "Hidden files like .gitignore, .env.example not accessible through UI"
  - "FRAME metadata in .quipu/ inaccessible to users"
  - "Search results excluded matches in dotfiles/dotfolders"
root_cause: "Blanket dotfile filter (strings.HasPrefix/startsWith '.') applied at every file system stack level excluded all dotfiles regardless of importance"
resolution: "Replaced blanket dotfile filters with targeted .git-only blocklist in readdir, removed .quipu from search exclusions, updated both Go server and Electron runtimes identically"
---

# Hidden Files and Folders Not Visible in File Explorer

## Problem

The file explorer hid ALL dotfiles and dotfolders (`.gitignore`, `.env.example`, `.quipu/`, `.claude/`, etc.) because of hard-coded blanket filters in 4 locations across the dual-runtime architecture. Users couldn't see or manage important workspace configuration files.

## Root Cause

Hard-coded `strings.HasPrefix(e.Name(), ".")` (Go) and `e.name.startsWith('.')` (Electron) filters were applied at every level of the file system stack, indiscriminately hiding all entries starting with a dot. This failed to distinguish between:

- **User-visible dotfiles** (`.gitignore`, `.env.example`, `.quipu/`, `.claude/`) that should be accessible
- **System directories** (`.git/`) that genuinely need hiding to prevent accidental corruption

The filters existed in 4 independent locations:

| # | File | Location | Filter |
|---|------|----------|--------|
| 1 | `server/main.go` | `handleListFiles` readdir loop | `strings.HasPrefix(e.Name(), ".")` |
| 2 | `server/main.go` | `handleFilesRecursive` walker | 8-line dotfile skip block |
| 3 | `electron/main.cjs` | `read-directory` IPC handler | `.filter(e => !e.name.startsWith('.'))` |
| 4 | `electron/main.cjs` | `list-files-recursive` walker | `if (entry.name.startsWith('.')) continue` |

Additionally, `.quipu` was in the `excludeDirs` set for both search and recursive file listing, preventing it from appearing in search results or quick open.

## Solution

Replaced blanket dotfile filtering with a targeted blocklist that only hides `.git`.

### server/main.go

**1. Added targeted blocklist:**
```go
var hiddenDirs = map[string]bool{".git": true}
```

**2. Readdir handler — replaced blanket filter with blocklist:**
```go
// Before:
if strings.HasPrefix(e.Name(), ".") { continue }

// After:
if hiddenDirs[e.Name()] { continue }
```

**3. Recursive walker — removed blanket dotfile skip entirely:**
The 8-line block checking `strings.HasPrefix(d.Name(), ".")` was deleted. The existing `excludeDirs` check already handles `.git`, `node_modules`, `build`, and `dist`.

**4. Removed `.quipu` from `excludeDirs`:**
```go
// Before:
var excludeDirs = map[string]bool{
    "node_modules": true, ".git": true, ".quipu": true, "build": true, "dist": true,
}

// After:
var excludeDirs = map[string]bool{
    "node_modules": true, ".git": true, "build": true, "dist": true,
}
```

### electron/main.cjs

**1. Added targeted blocklist:**
```javascript
const HIDDEN_DIRS = new Set(['.git']);
```

**2. Readdir IPC — replaced blanket filter with blocklist:**
```javascript
// Before:
.filter(e => !e.name.startsWith('.'))

// After:
.filter(e => !HIDDEN_DIRS.has(e.name))
```

**3. Recursive walker — removed blanket dotfile skip:**
```javascript
// Deleted:
if (entry.name.startsWith('.')) continue;
```

**4. Removed `.quipu` from all exclusion lists:**
- Recursive walk `excludeDirs` Set
- Ripgrep `--glob` exclusions
- Grep `--exclude-dir` exclusions

### electron/preload.cjs

No changes — pass-through bridge only.

## Key Design Decisions

1. **Only `.git` is blocklisted in readdir** — `node_modules` was never filtered in readdir (only in search/recursive), so it remains visible in the explorer as expected.

2. **Two-tier filtering** — `hiddenDirs` (readdir only, just `.git`) vs `excludeDirs` (search/recursive, blocks `node_modules`, `.git`, `build`, `dist`). Different contexts need different filters.

3. **`.quipu` removed from all exclusions** — users need to see and search `.quipu/` (FRAME metadata) and `.claude/` directories.

4. **Dual runtime parity** — identical logic in Go (map) and Electron (Set) ensures consistent behavior across browser and desktop.

## Prevention Strategies

### Keep Dual-Runtime Filters in Sync

The architecture requires changes in up to 4 places for any backend feature. When modifying file filtering:

1. Update `server/main.go` — readdir handler + recursive walker + search functions
2. Update `electron/main.cjs` — readdir IPC + recursive walker + search exclusions
3. Verify `electron/preload.cjs` if parameter signatures change
4. Test both runtimes produce identical results

### Prefer Explicit Blocklists Over Prefix Checks

```go
// Anti-pattern: blanket prefix check (hides too much)
if strings.HasPrefix(name, ".") { skip }

// Better: explicit blocklist (clear intent)
if hiddenDirs[name] { skip }
```

### Adding New Entries to the Blocklist

To hide a new directory from the explorer, add it to `hiddenDirs` (Go) and `HIDDEN_DIRS` (Electron). To exclude from search/recursive listing, add to `excludeDirs` in both runtimes and the ripgrep/grep exclude arrays.

## Testing Checklist

- [ ] `.quipu/` and `.claude/` folders appear in explorer sidebar
- [ ] `.gitignore`, `.env.example`, `.eslintrc` appear in explorer
- [ ] `.git/` folder is NOT shown in explorer
- [ ] `node_modules/` is NOT shown in search/recursive results
- [ ] Search finds matches inside dotfiles (except `.git`)
- [ ] Quick open (Ctrl+P) lists files from `.quipu/` and other dotfolders
- [ ] Both Electron (`npm run start`) and browser (`npm run dev` + Go server) behave identically

## Related

- Plan: `docs/plans/2026-03-01-feat-hidden-files-folders-explorer-plan.md`
- Brainstorm reference: `docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md` (line 101 notes hidden file filtering)
- Architecture: `CLAUDE.md` documents the 4-place change requirement for dual-runtime features
