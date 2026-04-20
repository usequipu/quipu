---
title: "feat: Add Commit & Push button to Source Control panel"
type: feat
status: active
date: 2026-04-10
---

# feat: Add Commit & Push Button to Source Control Panel

## Overview

Add a single "Commit & Push" button in `SourceControlPanel` that stages all unstaged/untracked files, commits with the message typed in the existing textarea, and pushes to the remote — collapsing a 3-step workflow (Stage All → Commit → Push) into one click.

## Problem Frame

The common "ship my changes" workflow currently requires three separate actions: clicking the `+` icon to stage all, clicking "Commit", then clicking "Push". A combined button eliminates that friction for the standard push-everything-to-remote flow.

## Requirements Trace

- R1. A "Commit & Push" button in `SourceControlPanel` stages all unstaged/untracked files, commits with the current commit message, and pushes to the remote in sequence.
- R2. The button is disabled when the commit message is empty or when there are no changes (staged + unstaged + untracked all empty).
- R3. If any step fails, show an error toast and stop — do not proceed to later steps.
- R4. On full success, clear the commit message, refresh git status, and show a success toast.

## Scope Boundaries

- Non-goal: keyboard shortcut or menu entry (not requested; can be added later).
- Non-goal: new backend endpoints — all required primitives (`stage`, `commit`, `push`) already exist in all 4 runtime layers.
- Non-goal: selective staging — the action always stages everything (all unstaged + untracked).
- Non-goal: push target selection — uses the current tracking branch, same as the existing "Push" button.

## Context & Research

### Relevant Code and Patterns

- `src/components/ui/SourceControlPanel.tsx:62` — The component to modify. Already has `handleStageAll` (lines 190–204), `handleCommit` (229–244), `handlePush` (246–258), and corresponding `isCommitting`/`isPushing` loading state.
- `src/components/ui/SourceControlPanel.tsx:394–401` — Existing "Commit" button — the new button is placed directly below it. Mirrors the same disabled-state and loading-label pattern.
- `src/components/ui/SourceControlPanel.tsx:344` — `hasChanges` derived flag used for display logic; also valid as a guard in the new handler.
- `src/components/ui/Toast.tsx` — `showToast(message, type)` pattern; already imported in `SourceControlPanel` via `useToast()`.
- `src/services/gitService.ts` — `stage(dirPath, files)`, `commit(dirPath, message)`, `push(dirPath)` — all implemented for both Electron and browser runtimes. No changes needed.
- `electron/main.cjs`, `server/main.go`, `electron/preload.cjs` — All four runtime layers already wire `git-stage`, `git-commit`, `git-push`. No changes needed.

### Institutional Learnings

- Hook ordering in this codebase is strict: state declarations first, leaf callbacks second, dependent callbacks third, effects last. The new `handleCommitAndPush` depends on `fetchStatus`/`refreshAll` — place it after `handlePush` in declaration order.

## Key Technical Decisions

- **Sequential in one handler, not composing the existing callbacks**: `handleCommitAndPush` calls `gitService.*` directly rather than invoking `handleStageAll` + `handleCommit` + `handlePush` in sequence, because those callbacks read React state that may not have re-rendered between calls. Direct service calls are synchronous in the async chain and avoid state staleness.
- **Stage step skipped when nothing to stage**: If `unstaged` and `untracked` are both empty (all changes already staged), skip the stage call. This avoids a no-op round-trip.
- **Push failure after successful commit**: If push fails, the commit is preserved locally. The error toast message should say "Committed but push failed: …" so the user knows their commit was not lost.
- **Loading state `isCommittingAndPushing` is separate** from `isCommitting` and `isPushing` so the individual buttons remain independently usable and their labels do not change during a combined operation.

## Open Questions

### Resolved During Planning

- **Do we need new service methods?** No. `gitService.stage`, `.commit`, `.push` cover all steps; the orchestration lives in the handler.
- **Where to place the button?** Directly below the existing "Commit" button in the commit section — consistent position, users scan top-to-bottom and see the more powerful action below the standard one.

### Deferred to Implementation

- **Exact icon for "Commit & Push" button**: `ArrowUpIcon` (already imported) is a reasonable default; the implementer may choose a stacked or combined icon if available in `@phosphor-icons/react`.
- **Button style**: Whether to use the same accent fill as "Commit" or a secondary outlined style. Implementer should pick whichever avoids visual conflict with the primary "Commit" button.

## Implementation Units

- [ ] **Unit 1: Add `handleCommitAndPush` handler and `isCommittingAndPushing` state**

**Goal:** Implement the combined stage-commit-push operation as a `useCallback` in `SourceControlPanel`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None (all service methods and state already exist)

**Files:**
- Modify: `src/components/ui/SourceControlPanel.tsx`

**Approach:**
- Add `const [isCommittingAndPushing, setIsCommittingAndPushing] = useState<boolean>(false)` alongside `isCommitting`/`isPushing` (lines 77–79).
- Add `handleCommitAndPush` useCallback after `handlePush` in declaration order:
  - Guard: return early if `!workspacePath` or `!commitMessage.trim()` or no changes.
  - Set `isCommittingAndPushing(true)`.
  - If `unstaged.length > 0 || untracked.length > 0`: call `gitService.stage(workspacePath, [...unstaged.map(f => f.path), ...untracked])`; on error, show toast and return.
  - Call `gitService.commit(workspacePath, commitMessage.trim())`; on error, show toast and return.
  - Call `gitService.push(workspacePath)`; on error, show toast "Committed but push failed: …" (note commit was saved) and fall through to refresh.
  - On completion: `setCommitMessage('')`, `refreshAll()`, show success toast "Committed and pushed".
  - Always: `setIsCommittingAndPushing(false)` in `finally`.
- Dependencies in the `useCallback` dep array: `workspacePath`, `commitMessage`, `unstaged`, `untracked`, `refreshAll`, `showToast`.

**Patterns to follow:**
- `handleCommit` (lines 229–244) and `handlePush` (246–258) for the loading state, try/catch, toast, and `finally` pattern.
- `handleStageAll` (190–204) for the files-array construction.

**Test scenarios:**
- Happy path: unstaged and untracked files exist, message filled → stage called with all file paths, commit called with message, push called → commitMessage cleared, refreshAll called, success toast shown.
- Happy path: all changes already staged (unstaged + untracked empty) → stage step skipped, commit + push proceed normally.
- Error path: `gitService.stage` throws → error toast shown, commit and push NOT called, `isCommittingAndPushing` reset to false.
- Error path: `gitService.commit` throws → error toast shown, push NOT called.
- Error path: `gitService.push` throws after successful commit → "Committed but push failed" toast shown, `refreshAll` still called so the new commit appears in the log.
- Edge case: commit message is empty → function returns early, no service calls made.
- Edge case: no changes at all → function returns early (guarded by `hasChanges` check).

**Verification:**
- TypeScript compiles with no errors (`npx tsc --noEmit`).
- Unit tests for the handler logic pass.
- Manual: open a workspace with changes, type a commit message, click "Commit & Push" → status clears, log shows new commit, remote receives the push.

---

- [ ] **Unit 2: Add "Commit & Push" button to the SourceControlPanel UI**

**Goal:** Render the new button below the existing "Commit" button with correct disabled state and loading label.

**Requirements:** R1, R2

**Dependencies:** Unit 1 complete

**Files:**
- Modify: `src/components/ui/SourceControlPanel.tsx`

**Approach:**
- Add a new `<button>` immediately after the closing tag of the existing "Commit" button (line 401).
- Label: "Commit & Push" when idle; "Pushing…" when `isCommittingAndPushing`.
- Disabled when: `!commitMessage.trim() || !hasChanges || isCommittingAndPushing || isCommitting || isPushing`.
- Update `isCommitDisabled` or introduce a parallel `isCommitAndPushDisabled` derived constant just above the return.
- Style: match the existing outlined secondary button style (same as Pull/Push buttons at lines 406–421) to visually distinguish it from the accent-filled "Commit" primary action.
- Optional: add a small `ArrowUpIcon` inline to signal the push step.

**Patterns to follow:**
- Existing "Commit" button (lines 394–401) for disabled state, cursor-not-allowed, opacity-40.
- Pull/Push button row (lines 405–422) for the outlined secondary style.

**Test scenarios:**
- Happy path: message filled, changes exist → button is enabled.
- Edge case: message empty → button disabled (opacity-40, cursor-not-allowed).
- Edge case: `isCommitting` is true (commit in progress) → "Commit & Push" button also disabled.
- Edge case: `isPushing` is true → "Commit & Push" button also disabled.
- Edge case: `isCommittingAndPushing` is true → "Commit & Push" shows "Pushing…", button disabled.

**Verification:**
- Button renders correctly in all 3 states: enabled, disabled, loading.
- Clicking the button when disabled does nothing.
- Visual: button is visually distinct from the accent "Commit" button above it.

## System-Wide Impact

- **Interaction graph:** Change is entirely local to `SourceControlPanel`. No callbacks, observers, or middleware involved. `gitService` methods are unchanged.
- **Error propagation:** Each step in `handleCommitAndPush` is guarded independently. Push failure shows a distinct message so the user knows their commit was not lost.
- **State lifecycle risks:** If `isCommittingAndPushing` gets stuck `true` due to an uncaught exception, the buttons remain permanently disabled. The `finally` block prevents this.
- **API surface parity:** Not applicable — this is a UI convenience wrapping existing service calls.
- **Unchanged invariants:** The individual "Commit", "Push", and "Pull" buttons are unaffected and continue to work independently.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Push fails after commit succeeds, leaving local commit unsynced | Toast message distinguishes "committed but push failed" so user can retry the push separately |
| Concurrent operations — user clicks "Commit" then immediately "Commit & Push" | `isCommittingAndPushing` disabled guard covers this; also `isCommitting` disables the new button |
| `refreshAll` called after push failure may be slow on large repos | Already the accepted pattern for all other git operations in this component |

## Sources & References

- Related code: `src/components/ui/SourceControlPanel.tsx`
- Related code: `src/services/gitService.ts`
- Related code: `electron/main.cjs` (git IPC handlers)
- Related code: `server/main.go` (git REST endpoints)
