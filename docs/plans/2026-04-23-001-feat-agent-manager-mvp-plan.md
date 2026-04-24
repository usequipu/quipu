---
title: Agent Manager MVP — chat viewer, agents/repos panels, context binding, FRAME-aware responses
type: feat
status: active
date: 2026-04-23
---

# Agent Manager MVP — chat viewer, agents/repos panels, context binding, FRAME-aware responses

## Overview

Add an Agent Manager to Quipu: an in-app chat experience that spawns Claude Code CLI sessions as headless subprocesses, driven by two new activity-bar panels (Agents and Repos) and rendered as a new viewer that replaces the editor area when an agent is active.

An "agent" is a saved preset (name, system prompt, bound repos, bound contexts, working directory). Each preset may have **at most one active session** at a time; reopening the preset resumes the running session or spawns a new one.

A "repo" is a git reference (primarily a URL). Repos may be cloned locally on demand. When a preset binds a repo subpath (e.g. `my-repo/docs`), that subpath is **materialized** into `<workspace>/.quipu/contexts/repos/<repo-name>/<subpath>/` on session start, and the agent works against that materialized tree. Future remote-agent work will relax the local-clone requirement.

The agent is FRAME-aware: the user can point at a file path and ask the agent to read that file's FRAME (instructions + annotations) and **respond to FRAME comments**. This requires extending the FRAME schema with threaded responses on annotations and exposing a "reply to FRAME comment" affordance to the agent.

## Problem Frame

Today, Claude Code CLI runs in Quipu's integrated terminal. The terminal model works but is awkward: no preset management, no structured context attachment, no first-class UI for reviewing responses alongside the editor, no concept of multiple "named" agents, and no mechanism to bind external repos as context for a session.

The user wants VSCode's Claude-extension feel — spawn named agents, attach folders/repos as context, chat in a dedicated view — while keeping Quipu's FRAME-centric workflow (the agent can read FRAME annotations at a path and reply to comments that ask it questions). The terminal integration remains for power users; this adds a parallel, richer in-app chat workflow.

Grand vision referenced by the user (contexts-per-folder with custom prompts, generated-context outputs, temporary repo context injection, Kamalu-base as context source, remote agents) is **not** in this plan. This plan ships the MVP skeleton that those future phases will extend.

## Requirements Trace

- **R1.** User can create, edit, delete, and list "agent presets" from a new Agents panel on the activity bar.
- **R2.** User can create, edit, delete, and list "repo references" from a new Repos panel on the activity bar; a repo reference can optionally be cloned to a local path.
- **R3.** Clicking an agent preset opens a chat view that replaces the editor area (via the extension/viewer registry); reopening the same preset resumes its active session if one exists.
- **R4.** A preset can bind one or more repo subpaths; on session start those subpaths are materialized into `<workspace>/.quipu/contexts/repos/<repo-name>/<subpath>/` and passed to the agent as its working context.
- **R5.** The agent runs as a headless Claude Code CLI subprocess; user messages are sent to the subprocess and streamed output is rendered as assistant messages in the chat view.
- **R6.** The agent is FRAME-aware: given a file path, it can read FRAME instructions and annotations at that path.
- **R7.** FRAME annotations support threaded responses; the agent can add a response to a specific FRAME comment, and the user can read/write replies from the existing CommentPanel UI.
- **R8.** Agent presets, sessions, and repo references persist across Quipu restarts.

## Scope Boundaries

**In scope:**
- Agents activity panel (list, create, edit, delete presets).
- Repos activity panel (list, create, edit, delete, clone repo references). **Git-only** — a "repo" is strictly a GitHub/git URL.
- Bases activity panel (list Quipu bases, connect/disconnect). **Different tree from Repos** — Repos and Bases are two separate data models, two separate panels, two separate trees in the preset's context picker. Bases use the existing Quipu-base infrastructure (`src/context/KamaluContext.tsx`, `src/services/kamaluFileSystem.ts` — kept for backward-compat; not renamed in this plan).
- Chat viewer (registered as a viewer extension on a synthetic `tab.type === 'agent'`).
- Preset editor viewer (registered on `tab.type === 'agent-preset'`).
- Agent preset + session data models and on-disk persistence. A preset's context bindings can reference **either** a repo **or** a base.
- Repo reference data model and on-disk persistence, with local-clone support.
- Base reference data model (thin adapter over the existing Quipu-base config) so presets can bind base subpaths the same way they bind repo subpaths.
- Context binding: materialization of repo/base subpaths into `<workspace>/.quipu/contexts/` on session start.
- FRAME schema extension for threaded comment responses, plus UI and service methods.
- Claude Code CLI headless subprocess wrapper (dual runtime: Electron IPC + Go server).
- Minimal FRAME-aware affordance: user can type `/frame <path>` in chat to surface a file's FRAME to the agent, and the agent can call the `reply_to_frame_comment` skill.

**Out of scope (Future Phases):**
- Contexts-per-folder with custom per-context prompts beyond a preset's single system prompt.
- Generated-context storage workflows (agent-produced context writeback to a dedicated `/contexts/notes/` hierarchy with a UI).
- Temporary injection of context into an existing repo working tree (beyond the `.quipu/contexts/` materialization described here).
- Quipu-base feature work beyond what the existing Quipu-base context already supports (e.g. new sync semantics, collaborative editing). The agent manager consumes the Quipu-base API as-is.
- Treating Quipu bases as git-accessible. Earlier mockup ([refs/image copy 5.png](refs/image%20copy%205.png)) shows `kamalu-base` in the Repos panel — **this is not the MVP design**. Per the user: repos are repos (git), bases are bases (Quipu), two different trees.
- Remote agent management (agents that run on servers without a local clone).
- A separate "Context Explorer" panel parallel to the Repos/Bases panels. The preset editor's context picker is the only context-browsing surface for MVP.
- Provider abstraction for non-Claude agents.
- Side-by-side chat + editor layout ("for now no double view").
- Chat-level slash commands beyond `/frame <path>` (including the `@path` attach shortcut visible in mockups).

## Context & Research

### Relevant Code and Patterns

- **Panel registration:** [src/extensions/panelRegistry.ts](src/extensions/panelRegistry.ts) — `registerPanel({ id, label, icon, component, order, badge })`. Existing panels live at orders 0–2 (Explorer, Search, Source Control); plugin panels at 99+. New core panels slot in at 10–19.
- **ActivityBar behavior:** [src/components/ui/ActivityBar.tsx](src/components/ui/ActivityBar.tsx) — clicking a panel toggles the sidebar; switching panels swaps the component in place. No main-area changes; chat-view takeover happens via the tab/viewer system.
- **Viewer extension pattern:** [src/extensions/diff-viewer/index.ts](src/extensions/diff-viewer/index.ts) uses `registerExtension({ id, canHandle: tab => tab.type === 'diff', priority: 90, component: DiffViewer })`. The chat view follows the identical pattern with `tab.type === 'agent'`.
- **Tab shape:** [src/types/tab.ts](src/types/tab.ts) `Tab.type?: string` already supports virtual/synthetic tabs. Agent tabs use `type: 'agent'`, `path: 'agent://<presetId>'`, `name: preset.name`, and ignore file-related fields.
- **Service dual-runtime pattern:** [src/services/fileSystem.ts](src/services/fileSystem.ts) selects `electronFS` vs `browserFS` at module load. New services (agentRuntime, repoService, contextBinder) follow the same adapter pattern.
- **Electron IPC + preload bridge:** [electron/main.cjs](electron/main.cjs) + [electron/preload.cjs](electron/preload.cjs) with the typed surface declared in [src/types/electron-api.d.ts](src/types/electron-api.d.ts).
- **Go server HTTP/WebSocket parity:** [server/main.go](server/main.go) — for browser mode, subprocess management uses the existing terminal WebSocket pattern.
- **FRAME schema:** [src/services/frameService.ts](src/services/frameService.ts) — `FrameAnnotation` currently has no `responses` field; this plan adds it.
- **Existing Claude CLI integration:** [src/services/claudeInstaller.ts](src/services/claudeInstaller.ts) installs the FRAME skill, command template, and load-frame hook into `.claude/` per workspace. The agent-manager subprocess inherits these hooks automatically — the agent already knows how to read FRAMEs because the installer wired `PostToolUse` on `Read`.
- **Terminal subprocess as reference architecture:** [src/services/terminalService.ts](src/services/terminalService.ts) and its Electron/Go counterparts are the closest analog for lifecycle management; `agentRuntime` mirrors their spawn/stream/kill contract but streams JSON message events rather than raw TTY bytes.
- **Context composition:** [src/context/WorkspaceContext.tsx](src/context/WorkspaceContext.tsx) nests FileSystem > Tab > Terminal. AgentContext and RepoContext nest **inside** TabContext (so they can open agent tabs) and **before** TerminalContext is unaffected.

### Institutional Learnings

- `docs/plans/2026-03-01-feat-claude-integration-terminal-frame-plan.md` established the Claude-via-terminal + FRAME-envelope pattern. The agent manager reuses the same envelope (FRAME annotations) but swaps the UI surface from terminal to chat.
- `docs/plans/2026-04-15-001-feat-plugin-architecture-plan.md` extracted heavy viewers into plugins. The chat viewer stays in core for MVP because it couples tightly to Electron IPC for subprocess management; revisit as a plugin candidate post-MVP.
- `docs/plans/2026-04-02-003-feat-kamalu-knowledge-platform-plan.md` introduces the "base" concept and is in-flight but not a prerequisite. MVP deliberately keeps local filesystem repos only.

### External References

- Claude Code CLI headless/non-interactive flags and session resumption semantics need to be confirmed at execution time (see Deferred Questions). The plan's structure is agnostic to whether resumption is via `--resume <session-id>`, replaying message history, or persistent stdio — the `agentRuntime` boundary isolates the choice.

### Visual Mockups

Six mockup images shipped at [refs/](refs/) are the ground-truth design reference for this plan. They resolve several previously deferred design questions. Key details captured from the mockups:

- **Chat view** ([refs/image.png](refs/image.png)): Opens as a tab with a dot indicator. Header shows preset avatar, name, `agent://<presetId>` subtitle, running status, and action buttons (Transcript, Edit preset, overflow menu). A **context chip row** sits directly under the header (`CONTEXT N ▸ materialized → .quipu/contexts/`). User messages that use `/frame <path>` expand inline showing FRAME instructions and each annotation as its own card (`expanded • N annotations`). Input placeholder reads *"Message FRAME Responder, or /frame <path> to attach a FRAME..."*. Input chips: **Attach**, **@path**, **/frame**. Input footer shows shortcut hints (`↩ send · ⇧↩ newline · / commands · @ paths`) and a model selector with token count (`3,214 / 200k tokens`). During streaming, input is replaced by *"Agent is responding... press to interrupt"*.
- **Resume banner** ([refs/image copy 6.png](refs/image%20copy%206.png)): When a preset has a persisted transcript but no running subprocess, the chat area shows a centered banner: *"Session persisted across restart. Subprocess is not running. Resume to replay the transcript and continue, or clear to start fresh."* with `Clear` and `▶ Resume session` buttons.
- **Preset editor** ([refs/image copy 3.png](refs/image%20copy%203.png), [refs/image copy 4.png](refs/image%20copy%204.png)): Opens as its own tab (`FRAME Responder — pre...` with edit-dot indicator), **not** a modal dialog. Layout has numbered sections:
  - **01 Identity** — Name, Working directory dropdown (default: "Current workspace — babbage/"), with a resolved-path preview line: *"Resolves to ~/projects/babbage/.quipu/contexts/repos/quipu/docs/ at session start."*
  - **02 System prompt** — Textarea labeled *"Passed to `claude --append-system-prompt` on startSession"*. Hint: *"The FRAME skill is already installed at `.claude/skills/frame/` — you don't need to re-describe FRAME conventions here."*
  - **03 Context bindings** — One card per binding. Each card has REPO PATH (e.g. `quipu/docs`, `kamalu-base/bases/research`) plus a DOCUMENTATION textarea (prose telling the agent *why this context matters*). Below the bindings, a **file-tree picker with tri-state checkboxes** (filter input, `2 cloned · 2 not cloned` count, repo rows like `quipu` labeled `r_quipu`). Footer notes: *"Materialization is idempotent — rebinds wipe and recopy"* and *"Ignores .git/, node_modules/"*.
  - **04 Runtime** — Model dropdown (`claude-sonnet-4.5 (default)`), Session resume dropdown (`Show Resume banner (default)` implies other options like auto-resume / always-fresh).
  - Top-right actions: `Delete preset`, `Cancel`, `Save preset`. Back-arrow returns to the chat tab.
- **Repos panel** ([refs/image copy 5.png](refs/image%20copy%205.png)): Header `REPOS` with `+` (add) and refresh buttons. Each repo row shows name, clone URL, branch, size, last-sync timestamp, and a clone-state badge: `Cloned` (green), `Cloning · NN%` (orange, with progress bar), `Not cloned` (gray with inline `Clone locally` button). Footer note: *"Stored at `~/.quipu/repos/`. Clone any repo to use it as context in an agent preset."* **Folder-grouping override (per user direction, 2026-04-23):** repos are displayed in user-defined folder groups (e.g. `personal/`, `work/`, `experiments/`) rather than a single flat list — same shape as bookmark folders. Each repo is a leaf under a folder, with its metadata badges unchanged. Folders are created/renamed/deleted by the user and persist with the repo references. The list-style mockup is superseded by this grouping preference; repos are NOT expanded into their file trees in the panel.
- **Agents panel** ([refs/image.png](refs/image.png), [refs/image copy 3.png](refs/image%20copy%203.png)): Header `AGENTS` with `+` and overflow buttons. Two sections: `RUNNING · N` (agents with live session, green dot, tinted background) and `PRESETS` (inactive agents with last-active timestamp: `2h ago`, `yesterday`, `3d ago`). Activity-bar icon shows a badge with the running count (`1`).
- **Editor view with agent replies in CommentPanel** ([refs/image copy 2.png](refs/image%20copy%202.png)): When viewing a markdown file, the FRAME CommentPanel on the right shows annotations with the agent's threaded replies nested underneath each one. This is where Unit 1's UI work is visible.
- **Activity bar ordering** (all images): File Explorer, Search, Source Control, **Agents** (with badge), **Repos**. Settings gear at the bottom.

## Key Technical Decisions

- **Agent = preset + at-most-one-session.** Presets are the saved config (durable); sessions are the running subprocess + conversation state (ephemeral but persisted for resume). Clicking a preset with a live session reattaches; with a dead session, spawns fresh.
- **Agent viewer is a registered extension, not an overlay.** Matching the diff-viewer pattern keeps chat inside the existing tab system: closable, reopenable, survives session persistence, honors TabBar affordances. No modal/portal gymnastics.
- **Preset editor is also a registered viewer extension on `tab.type === 'agent-preset'`.** Mockups show the editor rendered as a full-editor tab with numbered sections, a back-arrow to the chat, and top-right `Delete preset / Cancel / Save preset` actions — not a Radix Dialog. Two viewer extensions ship together: `agent-chat` and `agent-preset-editor`.
- **Repos and Bases are two different trees.** Repos are strictly git references (GitHub URLs, local clone path); Bases are Quipu bases consumed through the existing Quipu-base context and service. They live in separate panels, separate storage (`~/.quipu/repos/` vs. wherever the Quipu-base config lives today), and separate roots inside the context picker. A preset's bindings list can include either kind; the binding discriminator is `source: 'repo' | 'base'`.
- **Repos:** Git reference; cloning is optional but required for MVP bindings. The data model keeps `localClonePath` nullable to leave room for remote-agent work.
- **Bases:** Thin adapter over the existing Quipu-base infrastructure. The Agent Manager does not re-implement base discovery, auth, or sync — it consumes whatever the Quipu-base context exposes and materializes selected subpaths through the same `contextBinder`.
- **Context binding = materialization under `<workspace>/.quipu/contexts/`.** "Written context" is taken literally: copy (or hardlink where supported) repo subpaths into the workspace so the agent's working dir is a real tree it can read/edit without touching the source repo. Cleanup on session end is explicit; stale bindings are pruned on next bind.
- **Each context binding carries prose documentation.** The mockup's `DOCUMENTATION` field per binding is not decoration — it is concatenated into the effective system prompt so the agent knows *why each context was attached*. The binding data model is `{ repoId, subpath, documentation }`, not a bare path string.
- **Context bindings are picked via a tri-state file tree, not a string list.** The preset editor renders the repo trees for bound repos with checkbox selection; tri-state (unchecked, partial, checked) folds subtree state. The data model still serializes as a list of `{ repoId, subpath }` at the deepest fully-checked level; partial selections expand into per-child entries.
- **Claude Code CLI, wrapped per-session.** One subprocess per active agent session. The subprocess is spawned with `--add-dir <materialized-context-path>` for each bound subpath, `--cwd` set to the preset's working-directory choice (default: the workspace), `--append-system-prompt` for the preset's system prompt (confirmed by mockup), and `--model` for the preset's chosen model. Headless streaming mode is confirmed in pre-implementation Research R1.
- **Model is per-preset, not global.** The preset editor exposes a model dropdown (default `claude-sonnet-4.5`). The runtime passes `--model` on spawn.
- **Session resume behavior is per-preset.** The preset editor exposes a dropdown with at least `Show Resume banner (default)`; auto-resume and always-fresh are plausible future values. The Resume banner itself (described in Unit 9) is the MVP user-facing mechanism.
- **FRAME-reply tool is a Claude Code skill, not a runtime slash command.** Resolved from the previously deferred question: the mockup shows the system prompt referencing `the reply_to_frame_comment tool`. `claudeInstaller.ts` installs a `reply_to_frame_comment` skill/command under `.claude/skills/` that the subprocess exposes to the agent. The tool's implementation writes through `frameService.addResponse`.
- **FRAME responses are structured, not free-form markdown.** Adding `responses: FrameAnnotationResponse[]` to `FrameAnnotation` gives us typed replies (author, body, createdAt), which is what the CommentPanel and the `reply_to_frame_comment` tool both need. Storing as markdown inside `text` would prevent programmatic reply.
- **Agent storage lives under `~/.quipu/agents/` (global), repo storage under `~/.quipu/repos/` (global).** Presets and repo references are user-global so the same agents work across workspaces. Materialized context is per-workspace under `.quipu/contexts/`. The Repos panel footer surfaces this path explicitly.
- **AgentContext and RepoContext are new React contexts composed into WorkspaceProvider.** Follows the existing three-context pattern (Tab, FileSystem, Terminal). No Redux/Zustand.
- **Chat view opens via the existing Tab lifecycle.** `AgentsPanel` calls `openAgentTab(presetId)` which adds a tab with `type: 'agent'`; the chat's `Edit preset` action opens a sibling tab with `type: 'agent-preset'`. Both resolved via the extension registry. No new editor-area plumbing.

## Open Questions

### Resolved During Planning

- **Backend choice:** Claude Code CLI as headless subprocess (vs direct Anthropic SDK or a provider abstraction). Keeps parity with existing terminal flow, reuses the FRAME-hook setup, avoids a second agent loop.
- **Agent lifecycle:** Preset + at-most-one-active-session per preset.
- **Repo shape:** Git reference, optional local clone. Cloning required for MVP bindings; remote-only deferred. Kamalu bases are addressable via `.git` URL (no special case in the data model).
- **FRAME responses:** In scope as threaded responses on annotations (not a flat string, not a separate plan dependency).
- **Chat layout:** Replace the editor area as a registered viewer (not overlay, not mode toggle).
- **Preset editor surface:** A second registered viewer extension on `tab.type === 'agent-preset'`, not a modal dialog.
- **System prompt injection:** `claude --append-system-prompt "<preset prompt>"` (confirmed by mockup).
- **FRAME-reply tool delivery:** `reply_to_frame_comment` as a Claude Code skill installed by `claudeInstaller.ts` (confirmed by mockup — see Unit 1b).
- **Per-binding documentation prose:** Each binding has a `documentation` field that is concatenated into the effective system prompt at session start.

### Deferred to Implementation

- Exact Claude Code CLI invocation for streaming (e.g. `--output-format stream-json`, `--output-format json`, or raw stdio). Pre-implementation Research R1 will pick the mode; `agentRuntime` parses the chosen format.
- Exact session-resumption mechanism (`--resume <session-id>`, stored transcript replay via `--append-system-prompt` plus messages, or a mix). Pre-implementation Research R1 decides.
- Whether context materialization uses copy or hardlink/reflink. Hardlinks fail across filesystems and on Windows; plain copy is slow for large trees. Default to copy; add hardlink opportunistically per-platform.
- Full set of Session resume dropdown values (MVP mockup only shows `Show Resume banner (default)`). Additional values like `Auto-resume on open` and `Always start fresh` can be added post-MVP once the Resume banner UX is proven.
- `@path` input shortcut in the chat input (visible in mockup). MVP: include `/frame <path>` for certain; `@path` attachment of arbitrary files can slip to a follow-up if the Unit 8 scope balloons.
- Windows behavior for `--add-dir`, `--cwd`, and path normalization in `.quipu/contexts/`.

## Pre-Implementation Research

Before starting the implementation units, one research task must complete. Its output is a short memo committed to `docs/research/2026-04-23-anthropic-agent-prompts.md` that subsequent units (especially Unit 5 and Unit 8) will reference.

- [ ] **R1: Study Anthropic's official plugin/extension prompts and agent patterns**

**Goal:** Understand how Anthropic's official Claude Code VSCode extension, the Claude Code SDK, and the Claude Code CLI structure their system prompts, tool descriptions, message protocols, and agent loops — so our `agentRuntime`, our chat view, and our "reply to FRAME comment" affordance align with patterns users will already recognize, and so we do not re-invent conventions the official tooling has already established.

**What to collect:**
- The default system prompt shape used by Claude Code (headless mode, interactive mode, plugin/extension flows).
- The tool schema conventions (name, description prose style, parameter naming) that official tooling uses, so our FRAME-response tool follows the same shape.
- The message stream format emitted by Claude Code's headless modes (`-p`, `--output-format`, SDK message events) including tool-use and result framing.
- Session resumption semantics and flags (`--resume`, `--session-id`, or equivalent), including what state is durable and what is rebuilt on replay.
- How the official VSCode extension presents agent turns (streaming tokens vs message-level batching, tool-call UI, stop/approval gates) — so our `ChatView` shapes its event handling similarly.
- Any patterns for injecting workspace/additional directories (`--add-dir`, `--cwd`) and how system prompts typically reference them.
- Conventions for custom skills and slash commands (via `.claude/skills/` and `.claude/commands/`) — we already install the FRAME skill there via `claudeInstaller.ts`; confirm whether the "reply to FRAME comment" affordance is better delivered as a new skill/command installed by the installer, or as a runtime-side slash command handled in our chat view.

**Sources to consult (in priority order):**
- Official Anthropic docs for Claude Code CLI headless mode and the Claude Code SDK.
- The Claude Code repository on GitHub (prompts, message protocol, SDK types).
- The official Claude Code VSCode/JetBrains extension source where available, for agent-turn presentation patterns.
- Existing in-repo precedent: `src/services/claudeInstaller.ts` already writes skill/command/hook templates — its structure reveals what Claude Code expects.

**Deliverable:**
- A concise research memo at `docs/research/2026-04-23-anthropic-agent-prompts.md` with:
  - A **Conventions we will adopt** section (bullet list of decisions that feed Units 5 and 8).
  - A **Conventions we will deviate from and why** section (if any).
  - Concrete snippets of the message stream format and any flag combinations chosen for headless streaming.
  - A decision on "reply to FRAME comment" delivery (skill/command vs runtime slash command) with rationale.

**Verification:**
- The memo exists and is linked from the Sources & References section of this plan.
- Unit 5 (`agentRuntime`) references the memo's chosen flags and message format.
- Unit 8 (`ChatView`) references the memo's message-event conventions.
- Key Technical Decisions for deferred items ("Exact Claude Code CLI invocation", "reply to FRAME comment surface") either collapse into resolved decisions post-research or are re-stated as deferred with the reason sharpened.

**This unit is a gate for Unit 5 and Unit 8.** Units 1, 2, 3, 4 may proceed in parallel with research since they do not depend on the agent runtime or chat stream format.

## Implementation Units

- [ ] **Unit 1: Extend FRAME schema with threaded comment responses**

**Goal:** Add structured, threaded replies to FRAME annotations and expose read/write surfaces via `frameService`, so any caller (the CommentPanel, the agent) can add or read responses.

**Requirements:** R7

**Dependencies:** None — foundational.

**Files:**
- Modify: `src/services/frameService.ts`
- Modify: `src/types/editor.ts` (if `FrameAnnotation` is re-exported; otherwise skip)
- Modify: `src/components/editor/CommentPanel.tsx` (or the actual comment rendering component; confirm at implementation)
- Modify: `electron/main.cjs` (frame read/write already handled, but confirm `responses` field survives round-trip)
- Modify: `server/main.go` (same)
- Test: `src/services/__tests__/frameService.test.ts` (add if missing; otherwise extend)

**Approach:**
- Extend `FrameAnnotation` with `responses?: FrameAnnotationResponse[]` where `FrameAnnotationResponse = { id: string; author: string; body: string; createdAt: string }`. Optional field preserves backward-compat with existing `.frame` files.
- Add `addResponse(workspacePath, filePath, annotationId, { body, author }): Promise<Frame>` and `removeResponse(workspacePath, filePath, annotationId, responseId): Promise<Frame | null>` to `FrameService`.
- In the comment UI, render responses as a nested list under each annotation with an inline reply composer. Submit calls `addResponse`.
- No migration step needed — treat missing `responses` as `[]` on read.

**Patterns to follow:**
- Shape and write-through pattern from existing `addAnnotation` / `removeAnnotation` in `src/services/frameService.ts`.
- UI collapsible pattern from the existing FRAME annotation list in `CommentPanel`.

**Test scenarios:**
- Happy path: adding a response to an annotation persists it under `annotations[i].responses` and returns the updated Frame.
- Happy path: removing a response by id leaves other responses intact and returns the updated Frame.
- Edge case: adding a response to an annotation that has no `responses` field (legacy file) initializes the array and persists.
- Edge case: adding a response to a non-existent annotation id returns the Frame unchanged or throws a typed error — specify which and assert consistently.
- Edge case: `removeResponse` with unknown response id is a no-op (returns Frame unchanged, does not throw).
- Integration: writing via Electron IPC and reading back from disk produces a Frame with the response present (round-trip).

**Verification:**
- Legacy `.frame` files without `responses` load unchanged and gain responses only when written to.
- CommentPanel shows a reply composer under each annotation and displays all responses chronologically, matching the layout in [refs/image copy 2.png](refs/image%20copy%202.png) (responses nested directly below the annotation they belong to).
- `frameService.addResponse` is the single write path; no other code writes to `annotations[i].responses`.

---

- [ ] **Unit 1b: `reply_to_frame_comment` Claude Code skill installed by `claudeInstaller`**

**Goal:** Extend `claudeInstaller.ts` to install a `reply_to_frame_comment` skill/command template into `.claude/skills/` (or `.claude/commands/`, per Research R1's decision) so that subprocesses spawned by `agentRuntime` expose a tool the agent can call to post structured responses to FRAME annotations.

**Requirements:** R6, R7

**Dependencies:** Unit 1 (FRAME responses API), Pre-Implementation Research R1 (final decision on skill vs command delivery shape).

**Files:**
- Modify: `src/services/claudeInstaller.ts` (add template + installation step)
- Create: template file(s) under the installer's existing template layout (mirror the pattern used for the FRAME skill)
- Modify: `electron/main.cjs` (if the installer writes via IPC — confirm)
- Modify: `server/main.go` (parity)

**Approach:**
- The tool name is `reply_to_frame_comment` (confirmed by mockup system-prompt copy). Parameters at minimum: `filePath`, `annotationId`, `body`. Implementation calls `frameService.addResponse` via the same IPC surface `claudeInstaller` uses today for its FRAME-hook shell script.
- Installation is idempotent: on install, upsert the skill/command template; existing workspaces gain the tool on next `claudeInstaller.install(workspacePath)` call.
- The preset's system-prompt hint ("The FRAME skill is already installed at `.claude/skills/frame/`") is implicitly extended — the preset editor copy references both the FRAME skill and `reply_to_frame_comment` being available by default.

**Patterns to follow:**
- Existing `claudeInstaller.ts` installs FRAME skill, command, and hook — mirror its structure (template constant, write-through, settings.json patch if needed).

**Test scenarios:**
- Happy path: after running the installer on a fresh workspace, the `reply_to_frame_comment` skill file exists at the expected path with correct content.
- Happy path: calling the tool (simulated) invokes `frameService.addResponse` with the passed arguments and the response is persisted in the target `.frame` file.
- Edge case: installer run twice on the same workspace leaves exactly one skill template (idempotent upsert, not append).
- Edge case: tool call with an unknown `annotationId` returns a typed error from the skill (matches `frameService` behavior under the same condition from Unit 1).
- Security: the skill cannot write to file paths outside the workspace (delegate to `frameService`'s existing path-sandboxing guarantees; call this out in the skill implementation).

**Verification:**
- Agent subprocesses can call `reply_to_frame_comment` out of the box with no additional setup.
- Tool call surface matches Research R1's conventions (parameter naming, description prose style).
- Posted responses appear in the file's CommentPanel (cross-verification with Unit 1's UI).

---

- [ ] **Unit 2: Agent preset + session data model and storage service**

**Goal:** Define the types and persistence layer for agent presets and their at-most-one-active sessions, with user-global storage under `~/.quipu/agents/`.

**Requirements:** R1, R3, R8

**Dependencies:** None.

**Files:**
- Create: `src/types/agent.ts`
- Create: `src/services/agentStorage.ts`
- Modify: `src/types/electron-api.d.ts` (typed IPC surface for read/write of `~/.quipu/agents/`)
- Modify: `electron/main.cjs` (IPC handlers for listing/reading/writing agent presets and session transcripts)
- Modify: `electron/preload.cjs` (expose bridge)
- Modify: `server/main.go` (browser-mode endpoints under `/api/agents` for parity)

**Approach:**
- `AgentPreset = { id, name, systemPrompt, boundRepoBindings: AgentRepoBinding[], createdAt, updatedAt }`.
- `AgentRepoBinding = { repoId: string; subpaths: string[] }` — a preset lists which repos and which subpaths within them to materialize on session start.
- `AgentSession = { presetId, sessionId, transcript: AgentMessage[], startedAt, lastActivityAt, claudeSessionToken?: string }`. `claudeSessionToken` is an opaque value the runtime hands back for CLI resumption (implementer-defined).
- `AgentMessage = { id, role: 'user' | 'assistant' | 'system' | 'tool', body, createdAt }`.
- Storage layout: `~/.quipu/agents/presets.json` (array), `~/.quipu/agents/sessions/<presetId>.json` (one session per preset).
- `agentStorage` service exposes CRUD: `listPresets`, `getPreset`, `upsertPreset`, `deletePreset`, `getSession`, `appendMessage`, `clearSession`.

**Patterns to follow:**
- Dual-runtime adapter pattern from `src/services/fileSystem.ts`.
- Persistence conventions from existing user-global config (check where `claudeInstaller` or `pluginLoader` store their state and mirror the conventions).

**Test scenarios:**
- Happy path: `upsertPreset` on a new id appends to `presets.json`; on existing id replaces in place.
- Happy path: `appendMessage` creates the session file if missing and appends atomically.
- Edge case: concurrent `appendMessage` calls must not lose messages (specify the locking/append strategy in the implementation; test with rapid sequential calls that simulate interleaving).
- Error path: corrupt `presets.json` on read — service surfaces a typed error and does not silently wipe the file.
- Error path: `deletePreset` for an unknown id returns false/no-op rather than throwing.
- Integration: Electron-side writes are visible to a browser-side read (only required if both runtimes share `~/.quipu/agents/`; document the assumption either way).

**Verification:**
- Presets round-trip across app restart.
- Session transcript survives app restart even when the subprocess does not.
- No other code reads/writes `~/.quipu/agents/` except through `agentStorage`.

---

- [ ] **Unit 3: Repo reference data model and service (with optional local clone)**

**Goal:** Define types and persistence for repo references, with an optional `git clone` operation that drops a clone into `~/.quipu/repos/<name>/`.

**Requirements:** R2, R8

**Dependencies:** None.

**Files:**
- Create: `src/types/repo.ts`
- Create: `src/services/repoService.ts`
- Modify: `src/types/electron-api.d.ts`
- Modify: `electron/main.cjs` (IPC for list/read/write repos plus a `cloneRepo` handler wrapping `git clone`)
- Modify: `electron/preload.cjs`
- Modify: `server/main.go` (`/api/repos` parity + clone endpoint)

**Approach:**
- `RepoReference = { id, name, url, localClonePath?: string, defaultSubpaths?: string[], createdAt, updatedAt }`. No clone means the reference is informational only (used to reserve the slot for future remote-agent work).
- Storage: `~/.quipu/repos/repos.json`.
- `cloneRepo(refId, targetPath?)` shells out to `git clone <url> <targetPath>` via `exec.Command` with an argument array (never string concatenation) and sets `localClonePath` on success. Default `targetPath` is `~/.quipu/repos/<sanitized-name>/`.
- Repo name sanitization: lowercase, kebab-case, strip non-alphanumerics. Collisions suffix `-2`, `-3`, etc.

**Patterns to follow:**
- `git` command argument-array safety from existing `src/services/gitService.ts` and `server/main.go`.

**Test scenarios:**
- Happy path: adding a repo reference with a URL and no clone persists the reference.
- Happy path: `cloneRepo` on a valid URL clones into `~/.quipu/repos/<name>/` and updates `localClonePath`.
- Edge case: adding a repo whose sanitized name collides with an existing clone directory picks a non-colliding path (suffix strategy) without overwriting.
- Error path: `cloneRepo` with an invalid URL reports the git error verbatim and does not set `localClonePath`.
- Error path: deleting a repo with a live clone does not delete the clone on disk — only the reference (call this out to prevent data loss; user must explicitly clean up the filesystem).
- Security: a repo URL containing shell metacharacters cannot escape into the shell (argument-array enforcement).

**Verification:**
- Repo references round-trip across restart.
- Cloned repos land in predictable paths and are discoverable via `localClonePath`.
- `git clone` is never invoked via string concatenation.

---

- [ ] **Unit 4: Context binder — materialize bound repo subpaths per session**

**Goal:** On agent session start, materialize each `AgentRepoBinding` into `<workspace>/.quipu/contexts/repos/<repo-name>/<subpath>/` so the agent operates against a real working tree. Cleanup on session end.

**Requirements:** R4

**Dependencies:** Unit 3 (repo references + `localClonePath`).

**Files:**
- Create: `src/services/contextBinder.ts`
- Modify: `electron/main.cjs` (IPC for copy/link operations)
- Modify: `electron/preload.cjs`
- Modify: `server/main.go` (parity)

**Approach:**
- `bindContexts(sessionId, bindings, workspacePath): Promise<string[]>` returns the list of materialized absolute paths.
- For each binding, copy `<localClonePath>/<subpath>` recursively into `<workspace>/.quipu/contexts/repos/<repo-name>/<subpath>/`.
- Existing context directory for the same session is wiped before rebind (idempotent).
- `unbindContexts(sessionId, workspacePath)` removes the session's context subtree on explicit request (session end, preset deletion).
- Ignore common VCS noise (`.git/`, `node_modules/`, etc.) via a minimal default ignore list — document the list at the top of the file and keep it short.
- Symlinks/hardlinks are an optimization; MVP uses plain recursive copy for cross-platform reliability (see Deferred Questions).

**Patterns to follow:**
- File I/O via the dual-runtime adapter from `src/services/fileSystem.ts`, extended as needed for recursive copy.

**Test scenarios:**
- Happy path: binding a single subpath creates the expected tree under `.quipu/contexts/repos/<name>/<subpath>/` with the correct file contents.
- Happy path: rebinding the same session wipes and re-materializes (changes in the source appear; stale files in the target disappear).
- Edge case: binding an empty subpath (`""`) materializes the whole repo clone root.
- Edge case: binding a subpath that does not exist in the clone produces a typed error; other bindings for the session are not partially materialized (transactional behavior — specify in the implementation).
- Error path: insufficient disk space mid-copy — cleanup attempts to remove the partial tree and surfaces the error.
- Security: a subpath containing `..` or absolute-path escape segments is rejected (must not materialize outside `.quipu/contexts/`).
- Integration: binding, then reading a file through the agent subprocess (with the materialized path as its working dir), returns the expected content.

**Verification:**
- Materialization is deterministic: same bindings + same source tree => byte-identical target tree.
- No materialization ever writes outside `<workspace>/.quipu/contexts/`.
- `.git/` and `node_modules/` are excluded by default.

---

- [ ] **Unit 5: Claude Code CLI subprocess runtime (`agentRuntime`)**

**Goal:** Spawn, stream, and terminate Claude Code CLI subprocesses per agent session; emit structured message events into the chat view; persist the transcript via `agentStorage`.

**Requirements:** R3, R5, R6

**Dependencies:** Unit 2 (agentStorage), Unit 4 (contextBinder), Pre-Implementation Research R1 (for the chosen headless streaming mode, message event format, and session-resumption flags).

**Files:**
- Create: `src/services/agentRuntime.ts`
- Modify: `src/types/electron-api.d.ts`
- Modify: `electron/main.cjs` (spawn/kill handlers, stdout/stderr streaming via IPC events)
- Modify: `electron/preload.cjs` (expose subscribe/send/kill)
- Modify: `server/main.go` (WebSocket for browser-mode streaming, mirroring terminal WebSocket infra)
- Modify: `package.json` — version bump on commit.

**Execution note:** Start with a thin happy-path integration before wiring streaming UI. Confirm Claude CLI flags empirically (see Deferred Questions) before hardening the interface.

**Approach:**
- `agentRuntime` exposes: `startSession(preset, boundContextPaths): SessionHandle`, `sendMessage(sessionHandle, body): void`, `onMessage(sessionHandle, listener): Unsubscribe`, `endSession(sessionHandle): void`.
- On `startSession`, spawn `claude` with `--add-dir` arguments for the workspace root plus every materialized context path, plus a `--cwd` set to the first context path (or workspace if no bindings). System prompt injected via the CLI's supported mechanism (confirm at implementation).
- Streaming protocol is runtime-internal: parse stdout into discrete `AgentMessage` events (role, body chunks, tool calls). The chat view consumes only these events, not raw stdout.
- Every message (user and assistant) is also persisted via `agentStorage.appendMessage` as it arrives.
- Session token (for CLI resumption) is captured from CLI output if the chosen headless mode supports it; stored in `AgentSession.claudeSessionToken`.

**Patterns to follow:**
- Process lifecycle from `src/services/terminalService.ts` + its Electron counterparts.
- WebSocket pattern from the existing terminal WebSocket for browser runtime.

**Test scenarios:**
- Happy path: sending a one-line user message streams an assistant response; `onMessage` fires with incremental chunks and a final completion event.
- Happy path: `endSession` kills the subprocess and no further events fire.
- Edge case: `sendMessage` before `startSession` completed is queued or rejected — specify and test which.
- Edge case: subprocess crash mid-response surfaces a typed "session terminated" event; chat view can render it distinctly.
- Error path: `claude` binary missing on PATH — `startSession` rejects with a clear message pointing to `claudeInstaller` setup, not a cryptic spawn error.
- Error path: stdout produces malformed output — runtime emits a diagnostic event instead of crashing.
- Integration: a message that causes Claude to read a file in the materialized context tree returns content matching the materialized tree.

**Verification:**
- Each session owns exactly one subprocess; no orphaned processes after `endSession`.
- Transcript persisted via `agentStorage` matches what the chat view received.
- Subprocess inherits the workspace's `.claude/` hooks (FRAME hook applies automatically).

---

- [ ] **Unit 6: AgentContext + RepoContext providers, composed into WorkspaceProvider**

**Goal:** React context layer for agent presets/sessions and repo references, wiring `agentStorage`/`repoService`/`agentRuntime`/`contextBinder` into hook APIs consumed by panels and the chat view.

**Requirements:** R1, R2, R3, R4, R8

**Dependencies:** Units 2, 3, 4, 5.

**Files:**
- Create: `src/context/AgentContext.tsx`
- Create: `src/context/RepoContext.tsx`
- Modify: `src/context/WorkspaceContext.tsx` (compose new providers inside `TabProvider`, before `TerminalProvider`)

**Approach:**
- `AgentContext` exposes: `presets`, `activeSessionIds`, `upsertPreset`, `deletePreset`, `startSession(presetId)`, `sendMessage(presetId, body)`, `endSession(presetId)`, `getTranscript(presetId)`. Internally it resolves bindings, calls `contextBinder.bindContexts`, then `agentRuntime.startSession`.
- `RepoContext` exposes: `repos`, `addRepo`, `updateRepo`, `deleteRepo`, `cloneRepo`.
- Hooks: `useAgent()`, `useRepo()`.
- `useState` + `useCallback` per project convention — no useReducer/Zustand/Redux.
- Hook ordering per project rule: state → leaf callbacks → dependent callbacks → effects.

**Patterns to follow:**
- [src/context/TabContext.tsx](src/context/TabContext.tsx), [src/context/FileSystemContext.tsx](src/context/FileSystemContext.tsx), [src/context/TerminalContext.tsx](src/context/TerminalContext.tsx) — shape, hook export, memoization.
- [src/context/WorkspaceContext.tsx](src/context/WorkspaceContext.tsx) for provider nesting.

**Test scenarios:**
- Happy path: `upsertPreset` updates `presets` without re-rendering unrelated consumers (memoization check).
- Happy path: `startSession` materializes contexts, spawns subprocess, and registers the session id in `activeSessionIds`.
- Happy path: `startSession` called while a session is already active for that preset reattaches rather than spawning a second subprocess.
- Edge case: `sendMessage` for a preset without an active session auto-starts the session.
- Error path: `startSession` with bindings referencing a deleted repo surfaces a typed error; the session is not left in an inconsistent "half-started" state.
- Error path: `deletePreset` while a session is active terminates the session first.
- Integration: wiring a full `WorkspaceProvider` tree, a consumer component can render presets from `useAgent()` without any manual context mocks.

**Verification:**
- Nesting order `FileSystemProvider > TabProvider > (AgentProvider > RepoProvider >) TerminalProvider > SessionPersistence` is preserved.
- No context re-renders cascade into the editor tree when only agent state changes.

---

- [ ] **Unit 7: Agents and Repos activity-bar panels**

**Goal:** Register two new core panels, `agents` and `repos`, on the activity bar. The Agents panel lists presets (create/edit/delete + open-as-chat). The Repos panel lists repo references (add/edit/delete + clone).

**Requirements:** R1, R2

**Dependencies:** Unit 6.

**Files:**
- Create: `src/components/ui/AgentsPanel.tsx`
- Create: `src/components/ui/AgentPresetEditor.tsx`
- Create: `src/components/ui/ReposPanel.tsx`
- Create: `src/components/ui/RepoEditor.tsx`
- Modify: `src/extensions/panelRegistry.ts` (`registerPanel` calls for `agents` at order 10, `repos` at order 11)

**Approach:**
- `AgentsPanel` shows a list; each row has name, running-session indicator, and a click-to-open that calls `openAgentTab(presetId)` on `useTab()` (adds a tab with `type: 'agent'`, `path: 'agent://<presetId>'`).
- `AgentPresetEditor` is a modal (Radix Dialog, matching existing patterns such as `FolderPicker.tsx`) with fields: name, systemPrompt, bindings (list of `{ repoId, subpaths }`). Picks repos from `useRepo().repos`.
- `ReposPanel` shows repo references; each row has name, URL, clone status (clone button when not cloned). `RepoEditor` modal handles add/edit.
- Both panels are styled with Tailwind tokens (`bg-bg-surface`, `text-text-primary`, `border-border`).
- Phosphor icons: `RobotIcon` for agents, `GitBranchIcon` for repos.

**Patterns to follow:**
- Panel implementations in [src/components/ui/FileExplorer.tsx](src/components/ui/FileExplorer.tsx) and the existing Source Control panel for list + row conventions.
- Dialog/modal pattern from [src/components/ui/FolderPicker.tsx](src/components/ui/FolderPicker.tsx).

**Test scenarios:**
- Happy path: Agents panel renders a list of presets; clicking "New" opens the editor; submitting creates a preset and the list updates.
- Happy path: Clicking a preset opens a chat tab (verify via `useTab()` state or via rendered tab count).
- Happy path: Repos panel's "Clone" button triggers `cloneRepo` and updates the row to show the local path.
- Edge case: empty states for both panels render instructive copy, not a blank area.
- Edge case: deleting a repo that is referenced by an active preset prompts the user and cascades (or blocks — specify in implementation; test the chosen behavior).
- Error path: cloning a private repo without credentials surfaces the git error inline in the row.

**Verification:**
- Both panels appear in the ActivityBar with correct icons at orders 10 and 11.
- Clicking the same panel again collapses the sidebar per existing ActivityBar behavior.
- All edits persist across restart.

---

- [ ] **Unit 8: Chat viewer extension (`tab.type === 'agent'`)**

**Goal:** Register a viewer extension that renders `ChatView` when the active tab has `type: 'agent'`, replacing the editor area exactly the way `DiffViewer` does for `type: 'diff'`.

**Requirements:** R3, R5, R6

**Dependencies:** Units 1, 6, 7, Pre-Implementation Research R1 (for message-event conventions, tool-call rendering, and the chosen delivery surface for the "reply to FRAME comment" affordance).

**Files:**
- Create: `src/extensions/agent-chat/index.ts`
- Create: `src/extensions/agent-chat/ChatView.tsx`
- Create: `src/extensions/agent-chat/MessageList.tsx`
- Create: `src/extensions/agent-chat/MessageInput.tsx`
- Modify: `src/extensions/index.ts` (side-effect import of `./agent-chat`)
- Modify: `src/types/tab.ts` (document `type: 'agent'` alongside `type: 'diff'`; no struct change needed)

**Approach:**
- `registerExtension({ id: 'agent-chat', canHandle: tab => tab.type === 'agent', priority: 90, component: ChatView })`.
- `ChatView` reads the `presetId` from `tab.path` (format: `agent://<presetId>`), calls `useAgent().getTranscript(presetId)` for rendering, and subscribes to new messages via context.
- `MessageList` renders `AgentMessage[]` with role-based styling (user vs assistant vs tool). Autoscrolls on new message if the user is at the bottom; stays put otherwise.
- `MessageInput` is a multiline textarea (Enter to send, Shift+Enter for newline) with a send button. Submit calls `useAgent().sendMessage(presetId, body)`.
- Special user input forms:
  - A user line starting with `/frame <path>` is pre-expanded: before sending, the chat reads that file's FRAME via `frameService.readFrame` and prepends a structured context block to the outgoing message. The user sees both their original command and the expansion in the transcript.
- The agent's "reply to FRAME comment" surface (see Deferred Questions) lands on top of `frameService.addResponse` (from Unit 1).

**Patterns to follow:**
- [src/extensions/diff-viewer/index.ts](src/extensions/diff-viewer/index.ts) and [src/extensions/diff-viewer/DiffViewer.tsx](src/extensions/diff-viewer/DiffViewer.tsx) for the registration + layout shape.
- Tailwind theme tokens for backgrounds, text, borders.

**Test scenarios:**
- Happy path: opening an agent tab renders an empty chat with the preset name in the header.
- Happy path: sending a user message appends a user bubble and streams an assistant bubble.
- Happy path: `/frame <path>` expands into a FRAME context block before sending; the expansion is visible in the user-message bubble.
- Edge case: opening the same agent in two tabs (if allowed) shows the same transcript live in both (both subscribe to the same session).
- Edge case: the preset is deleted while the chat tab is open — the tab shows an empty/error state rather than crashing.
- Error path: `/frame <path>` for a file without a FRAME shows an inline notice ("no FRAME at this path") and does not send an empty context block.
- Integration: agent uses the FRAME-response tool; a reply appears on the FRAME annotation in the target file's CommentPanel (cross-layer verification — mocks alone would not prove this).

**Verification:**
- The editor area is fully replaced by `ChatView` when an agent tab is active; switching to a file tab restores the editor.
- No regressions in `diff-viewer`, `database-viewer`, or file tabs.
- TabBar behavior (close, reorder, switch) works identically for agent tabs.

---

- [ ] **Unit 9: Session persistence and resume UX**

**Goal:** Persist the agent session transcript across app restarts (subprocess does not auto-resurrect); when the user reopens a preset, offer "Resume" which spawns a fresh subprocess with prior transcript replayed.

**Requirements:** R3, R8

**Dependencies:** Units 2, 5, 6, 8.

**Files:**
- Modify: `src/context/AgentContext.tsx`
- Modify: `src/extensions/agent-chat/ChatView.tsx`
- Modify: `src/services/agentRuntime.ts` (accept an initial-history parameter on `startSession`)

**Approach:**
- On app start, `AgentContext` reads all existing sessions from `agentStorage` but does NOT spawn subprocesses.
- When the user opens an agent tab, `ChatView` shows the persisted transcript. If there is no running session for the preset, a "Resume session" action button is visible above the input. Clicking it calls `startSession` with `initialHistory: getTranscript(presetId)`.
- `agentRuntime.startSession` accepts `initialHistory` and replays it into the CLI via the supported mechanism (confirm at implementation — likely `--resume <token>` if we captured one, else message replay).
- "Clear session" action discards the transcript and ends any running session.

**Test scenarios:**
- Happy path: closing and reopening the app preserves the transcript for a preset with a prior session.
- Happy path: clicking "Resume" spawns a subprocess and the next user message is answered in-context.
- Edge case: "Resume" with an empty transcript behaves identically to `startSession` fresh.
- Edge case: "Clear session" followed by "Resume" starts a fresh subprocess with an empty transcript.
- Error path: resume with an expired `claudeSessionToken` falls back to message-replay without surfacing a scary error.

**Verification:**
- No subprocess is spawned on app start, only on explicit "Resume" or on first user message.
- Transcripts are never silently lost.

---

- [ ] **Unit 10: Version bump and smoke test**

**Goal:** Bump `package.json` to the next minor version (new feature) and run a manual smoke test across the MVP flow.

**Requirements:** None directly — project convention (see CLAUDE.md).

**Dependencies:** All prior units.

**Files:**
- Modify: `package.json`

**Approach:**
- Bump minor per CLAUDE.md (`0.x.0` for new features).
- Manual smoke test script (document in PR description):
  1. Create a repo reference pointing at a local project; clone it.
  2. Create an agent preset binding that repo's `/docs` subpath.
  3. Open the preset — confirm the chat view replaces the editor.
  4. Send "list the files under docs" — confirm the agent responds with the materialized tree.
  5. Send "/frame src/App.tsx then respond to any question comments in the FRAME" — confirm replies appear in `CommentPanel` for that file.
  6. Restart the app — confirm the transcript is preserved and "Resume" is available.

**Test expectation:** none — manual smoke verification only; no new automated tests in this unit (prior units cover the behavior individually).

**Verification:**
- Version bump committed.
- Smoke test passes end-to-end on the primary developer's machine.

## System-Wide Impact

- **Interaction graph:** New panels register on `panelRegistry` and appear on the ActivityBar alongside Explorer/Search/Source Control. New viewer extension registers on `registry` alongside diff-viewer/database-viewer. New contexts nest inside `TabProvider` within `WorkspaceProvider`. The existing terminal Claude flow is unaffected.
- **Error propagation:** `agentRuntime` errors surface as typed session events into `AgentContext`, rendered in the chat view as distinct error bubbles (never silent). `repoService` clone errors surface inline in the Repos panel row. `contextBinder` errors block session start with a user-facing toast.
- **State lifecycle risks:** Orphaned subprocesses if `endSession` is skipped on app quit — register a cleanup in the Electron main-process quit handler. Stale `.quipu/contexts/` directories if the app crashes mid-session — `bindContexts` is idempotent (wipes before write), so next session recovers.
- **API surface parity:** Every backend operation (preset CRUD, repo CRUD + clone, session spawn/send/kill, context bind/unbind, FRAME response add/remove) has four touchpoints: Go server, Electron IPC, preload bridge, TS service adapter. This is the project's dual-runtime rule.
- **Integration coverage:** The FRAME round-trip through the agent (user asks agent to reply to comment → agent calls FRAME tool → response persists → user sees it in CommentPanel) crosses subprocess, IPC, filesystem, and React-context layers. Unit 8 test scenarios include an integration test for this specific path.
- **Unchanged invariants:**
  - The existing terminal + Claude CLI + FRAME-hook workflow continues to work unchanged.
  - The existing `FrameAnnotation` shape is additive only (new optional `responses` field); legacy `.frame` files load unchanged.
  - Existing panel orders (Explorer=0, Search=1, SourceControl=2) and extension priorities (diff-viewer=90) are unchanged.
  - TabBar, terminal panel, and SessionPersistence behavior are unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Claude Code CLI headless/streaming flags differ from assumptions, blocking Unit 5 | Keep `agentRuntime` the only abstraction boundary. Prototype Unit 5 against the CLI empirically before finalizing the interface; any flag change stays behind the service. |
| Context materialization is slow for large repos | Default to copy with a default ignore list (`.git/`, `node_modules/`, etc.). Document expected sizes; add hardlink optimization later if needed. |
| Orphaned subprocess / context directories after app crash | Cleanup hooks on Electron `quit` event + idempotent `bindContexts` that wipes before write. |
| FRAME schema extension breaks older `.frame` files | `responses` field is optional; readers treat missing as `[]`; no migration required. |
| `git clone` with user-supplied URLs is an injection vector | Use `exec.Command` with argument arrays (never string concatenation), per existing `gitService` and server conventions. |
| Windows path handling in `.quipu/contexts/` and `--add-dir` | Unit 4 tests include a Windows-style path normalization case; defer complex edge cases to Future Considerations. |
| User deletes a repo that a preset binds | Unit 6 surfaces a typed error at `startSession`; Unit 7 Repos panel either prompts before delete or cascades — pick one at implementation and document. |
| User expects the grand vision (generated-context, temp repo injection, context explorer) to work after MVP ships | Scope Boundaries make the cut explicit; PR description should reiterate. |

## Documentation / Operational Notes

- Update [CLAUDE.md](CLAUDE.md) Architecture section to list `AgentContext` and `RepoContext` alongside the existing three contexts, and to note `agentRuntime`, `repoService`, `contextBinder`, `agentStorage` as new services under the "Service Layer" list.
- Update CLAUDE.md "Key Files" section to reference new panels, viewer, and contexts.
- Ensure the `.claude/` setup from `claudeInstaller` is run or verified before first session start (agent relies on the FRAME hook being installed). If not installed, Unit 5 surfaces a clear onboarding error pointing at the installer.
- No new external services, no environment variable changes, no CI changes in this plan.

## Sources & References

- Related plans:
  - [docs/plans/2026-03-01-feat-claude-integration-terminal-frame-plan.md](docs/plans/2026-03-01-feat-claude-integration-terminal-frame-plan.md) (terminal + FRAME, the parallel integration this plan complements)
  - [docs/plans/2026-04-02-003-feat-kamalu-knowledge-platform-plan.md](docs/plans/2026-04-02-003-feat-kamalu-knowledge-platform-plan.md) (in-flight; future phase that extends "repos as contexts" to Kamalu bases)
  - [docs/plans/2026-04-15-001-feat-plugin-architecture-plan.md](docs/plans/2026-04-15-001-feat-plugin-architecture-plan.md) (panel + viewer extension patterns)
  - [docs/plans/2026-04-09-001-feat-frame-anchor-stability-plan.md](docs/plans/2026-04-09-001-feat-frame-anchor-stability-plan.md) (FRAME background)
- Related code: `src/extensions/panelRegistry.ts`, `src/extensions/registry.ts`, `src/extensions/diff-viewer/`, `src/services/frameService.ts`, `src/services/claudeInstaller.ts`, `src/services/terminalService.ts`, `src/context/TabContext.tsx`, `src/context/WorkspaceContext.tsx`, `src/types/tab.ts`.
- Pre-implementation research memo (to be produced by R1): `docs/research/2026-04-23-anthropic-agent-prompts.md`.
