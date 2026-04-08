---
title: "feat: Jupyter Notebook Live Execution Viewer"
type: feat
status: active
date: 2026-04-03
---

# feat: Jupyter Notebook Live Execution Viewer

## Overview

Add a first-class `.ipynb` viewer to Quipu that renders notebook cells and supports live code execution via a user-selected Python virtual environment. The user picks a `.venv`, Quipu launches `jupyter server` from that environment and proxies it through the existing dual-runtime backend. Cells can be run interactively; outputs stream into the viewer in real time. No Python is bundled — the user's environment drives everything.

## Problem Frame

Quipu already opens many file types (PDF, images, Excalidraw, Mermaid, code) but treats `.ipynb` as raw JSON, rendering it in CodeViewer as unreadable syntax-highlighted text. Data science and research workflows produce notebooks alongside code, and there is no reasonable way to view or run them without leaving the app.

The goal is a viewer that feels native to Quipu's design system, handles the full cell-output lifecycle (static display + live execution), and manages the Jupyter subprocess cleanly without requiring Python or Jupyter to be bundled.

## Requirements Trace

- R1. `.ipynb` files are detected by extension and open in a dedicated viewer, never in CodeViewer or TipTap
- R2. All cell types (code, markdown, raw) are rendered
- R3. Saved outputs from the file are displayed immediately on open (static view)
- R4. User selects a `.venv` path; Quipu validates the `jupyter` binary before accepting it
- R5. Jupyter server is launched from the selected venv and managed for the workspace session
- R6. User can execute individual cells and see outputs stream in real time
- R7. Kernel status (idle / busy / dead) is visible and actionable (interrupt, restart, shutdown)
- R8. Works in both Electron and browser runtimes via the dual-runtime service adapter pattern
- R9. Kernel and Jupyter server are cleanly shut down when the workspace closes or app quits
- R10. ANSI escape codes in stream and traceback outputs are rendered correctly

## Scope Boundaries

- No bundled Python, kernel, or Jupyter installation — user's venv provides everything
- No multi-kernel-spec selection UI in v1 (always use `python3` from the selected venv)
- No notebook editing (cell creation, deletion, reordering) in v1 — read/run only
- No ipywidgets / interactive widget support in v1
- No collaborative / multi-user kernel sharing
- No nbformat version migration — target nbformat 4 (current standard)
- Saving updated outputs back to `.ipynb` is deferred to a follow-up

## Context & Research

### Relevant Code and Patterns

- `src/utils/fileTypes.js` — sole source of truth for file type detection; `getViewerType()` drives all viewer dispatch. `.ipynb` must be registered here before `isCodeFile` (`.ipynb` is JSON and would otherwise match)
- `src/App.jsx` (lines ~722–756) — viewer cascade: `isPdf → isMedia → isExcalidraw → isMermaid → isCodeFile → <Editor>`. New notebook branch goes before `isCodeFile`
- `src/context/WorkspaceContext.jsx` → `openFile()` — builds tab objects; `.ipynb` must get `isNotebook: true` flag and read raw file content (notebook JSON is text, not binary, so `readFile` is safe)
- `src/components/PdfViewer.jsx`, `src/components/CodeViewer.jsx` — viewer component templates; props: `{ filePath, fileName, content, onContentChange }`
- `src/services/terminalService.js` — the exact template for a dual-runtime WebSocket service adapter with reconnection logic
- `server/main.go` → `handleTerminal` (line 523), `runGitCommand` — subprocess + WebSocket proxy patterns to follow
- `electron/main.cjs` → `ptyProcesses` Map, `terminal-create` ipcMain.handle — subprocess lifecycle pattern for Electron
- `src/services/fileSystem.js` — dual-runtime adapter pattern to mirror
- `storageService` — already used for `recentWorkspaces`; use key `'notebookVenvPath'` for venv persistence

### Institutional Learnings

- **Viewer dispatch order is critical**: `.ipynb` is valid JSON; if `isNotebookFile` check is not inserted before `isCodeFile` in `getViewerType()`, notebooks silently open in CodeViewer (see: excalidraw-viewer-file-type-routing.md)
- **All 4 dual-runtime layers are mandatory**: Go server, Electron IPC handler, preload bridge, service adapter. Skipping any layer causes one runtime to silently fail (see: media-viewer-image-video-support.md)
- **WebSocket reconnection is not optional**: Single-shot WebSocket connections permanently disconnect on any hiccup. Must implement `intentionalClose` flag + retry loop + `MAX_RETRIES` from day one (see: terminal-websocket-reconnection.md)
- **CORS middleware on all new Go WebSocket endpoints**: Wrap with `corsMiddleware(...)` unconditionally; include `[::1]` in `isLocalOrigin()` for IPv6/Windows compatibility (see: windows-cors-403-go-server-websocket.md)
- **Kernel venv paths must not be sandbox-restricted**: `isWithinWorkspace` guards must not apply to venv paths — kernels live outside the workspace root

### External References

- [Jupyter Server REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html) — kernel lifecycle, sessions, interrupt/restart endpoints
- [Jupyter Messaging Protocol 5.x](https://jupyter-client.readthedocs.io/en/stable/messaging.html) — message envelope, execute_request/reply, IOPub message types
- [Jupyter Server WebSocket Protocols](https://jupyter-server.readthedocs.io/en/latest/developers/websocket-protocols.html) — token auth via `?token=` query param for WebSocket upgrades
- [Security in Jupyter Server](https://jupyter-server.readthedocs.io/en/latest/operators/security.html) — token auth, localhost-only binding, never disable auth

## Key Technical Decisions

- **Jupyter Server (not raw kernel)**: Launch `jupyter server --no-browser` rather than `jupyter kernel`. This gives a REST API and WebSocket kernel channels out of the box. The Go server proxies them — no ZMQ implementation needed. Rejected: raw kernel approach requires a ZMQ-over-WebSocket bridge in Go, which is complex and fragile.

- **Go proxy for browser; direct WebSocket for Electron**: In browser mode, the React frontend talks to the Go proxy. In Electron mode, the Go server is not co-started (Electron uses IPC, not HTTP), so the renderer cannot reach a Go proxy WebSocket. Instead, in Electron mode: (a) the main process obtains the Jupyter token, (b) exposes it transiently via a one-time `kernelGetChannelUrl(kernelId)` IPC that returns the full `ws://127.0.0.1:{port}/api/kernels/{id}/channels?token=TOKEN` URL, (c) the renderer opens the WebSocket directly to Jupyter. The token is never persisted in the renderer; it is used only to open the WebSocket connection. This is the same approach used by VS Code for Jupyter. REST calls in Electron still go via `kernelProxyRest` IPC (main.cjs makes the HTTP call server-side). Rejected: running a Go proxy in Electron just for WebSocket relaying adds unjustified complexity.

- **One Jupyter server per workspace**: A single `jupyter server` process is started when the first notebook is run and kept alive for the workspace session. Multiple open notebooks share the same server; each gets its own kernel via the Sessions API. Rejected: per-notebook servers multiply port and process overhead.

- **Sessions API over bare kernels**: Use `POST /api/sessions` to link each kernel to a notebook file path. This allows reconnecting to an existing kernel when a tab is closed and reopened. Rejected: bare kernels (`POST /api/kernels`) appear as "unnamed" in any Jupyter UI and cannot be reconnected by path.

- **Custom thin WebSocket client, not `@jupyterlab/services`**: Go proxies the Jupyter WebSocket, so the frontend only needs to speak Go's simplified proxy protocol (plain text JSON frames). `@jupyterlab/services` assumes direct Jupyter Server access and brings significant dependency overhead with React 19 peer-dep risks. The protocol surface over the proxy is ~200–300 lines of straightforward code.

- **ANSI rendering via `ansi-to-react`**: Stream outputs and tracebacks contain ANSI escape codes. `ansi-to-react` converts them to React elements without `dangerouslySetInnerHTML`. Rejected: `ansi-html` (unmaintained, XSS vulnerability), rolling our own (unnecessary).

- **DOMPurify for `text/html` outputs**: Notebook `display_data` can contain arbitrary HTML. Sanitize before `dangerouslySetInnerHTML`. Required regardless of local-only execution origin.

- **Lazy kernel start**: Do not auto-start a kernel on file open — many users open notebooks to read them. Start kernel on first "Run" action or explicit "Start Kernel" button.

- **Process isolation with SIGPGID**: Spawn `jupyter server` in its own process group (`Setpgid: true` on Linux/macOS) so that all child kernel processes are killed as a group on workspace close. Kill with `SIGTERM` to the process group, then `SIGKILL` after 3 seconds.

- **Random token via environment variable**: Generate a 32-byte hex token in Go/Node; pass via `JUPYTER_TOKEN` env var rather than CLI flag (avoids exposure in `ps aux`). Use `--ip=127.0.0.1` and `--ServerApp.allow_remote_access=False`. Do not pass `--ServerApp.allow_origin=*` — the Go proxy sets `Origin: http://127.0.0.1:{port}` on its upstream WebSocket dial, which Jupyter accepts by default. Avoiding `allow_origin=*` keeps Jupyter's CORS protection intact.

- **Port via `--port=0` + `jpserver-{pid}.json`**: Pass `--port=0` to let the OS assign a free port, then read the actual port from `jpserver-{pid}.json` in a controlled `JUPYTER_RUNTIME_DIR`. This eliminates port collision risk entirely — no need to pick a port up front or implement collision detection. The `jpserver-{pid}.json` file contains the port, token, and base_url after startup. Polling for this file (max 30 seconds) is more robust than parsing stdout log lines whose format varies across Jupyter versions. This is a resolved decision, not deferred.

## Open Questions

### Resolved During Planning

- **How to detect Jupyter server readiness**: Poll `jpserver-{pid}.json` in a controlled `JUPYTER_RUNTIME_DIR`, not stdout parsing (see: Key Technical Decisions)
- **How to handle Windows binary path**: `{venvPath}\Scripts\jupyter.exe` on Windows, `{venvPath}/bin/jupyter` on Linux/macOS — validate both before accepting a venv
- **Does CORS middleware cover venv-launched Go endpoints**: Yes — all new Go handlers must be wrapped with `corsMiddleware()` per institutional learning

### Deferred to Implementation

- Exact version of `ansi-to-react` that works with React 19 without peer dep warnings (test at install time; fallback: `fancy-ansi`)
- Whether DOMPurify needs to be added or an alternative sanitizer is already in the bundle (check at implementation time; if absent, add `dompurify`)
- Whether `marked` is already transitively installed by a TipTap dependency (check before adding; if absent, add it)
- Whether nbformat 3 notebooks (using `worksheets[0].cells` structure) are common enough in user environments to warrant a conversion shim, or whether a clear "nbformat 3 not supported — please convert with `jupyter nbconvert`" error toast is sufficient

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
File open (.ipynb)
  ↓
fileTypes.isNotebookFile() → getViewerType() = "notebook"
  ↓
WorkspaceContext.openFile() → tab { isNotebook: true, content: rawJsonString }
  ↓
App.jsx viewer cascade → <NotebookViewer filePath content />
  ↓
NotebookViewer parses content → renders cells statically (saved outputs)


User clicks "Run Cell" (first time)
  ↓
NotebookViewer → kernelService.startServer({ venvPath })
  ↓
  [Electron]                          [Browser]
  main.cjs: spawn jupyter server      Go server: exec.Command jupyter server
  poll jpserver-{pid}.json             poll jpserver-{pid}.json
  return { port, token } via IPC       return { port, token } via HTTP
  ↓
kernelService.createSession({ path, kernelName })
  ↓
Go proxy: POST /api/jupyter/sessions → Jupyter REST (with Authorization token)
  ↓
kernelService.connectKernelWS({ kernelId })
  ↓
NotebookViewer opens WebSocket to Go proxy /ws/jupyter/kernels/{id}/channels
Go proxy dials ws://127.0.0.1:{port}/api/kernels/{id}/channels?token=TOKEN
Go copies frames bidirectionally (text frames, JSON protocol)
  ↓
NotebookViewer sends execute_request → Go forwards → Jupyter kernel
Kernel emits: status(busy) → stream → execute_result → status(idle) on IOPub
Go forwards each frame → NotebookViewer updates cell outputs in React state


Workspace close / app quit
  ↓
kernelService.shutdownAll()
  ↓
DELETE /api/jupyter/sessions/{id} for each open session (Go → Jupyter)
Kill jupyter server process group (SIGTERM → 3s → SIGKILL)
```

**Jupyter Messaging Protocol envelope (text JSON frames over WebSocket):**

```
{
  channel: "shell" | "iopub" | "stdin" | "control",
  header: { msg_id, session, username, date, msg_type, version: "5.3" },
  parent_header: { ... },   // echoes the triggering request's header
  metadata: {},
  content: { ... }          // message-type-specific payload
}
```

**MIME priority for display_data / execute_result outputs (highest to lowest):**

```
text/html (sanitized) → image/png → image/svg+xml → image/jpeg →
application/json → text/markdown → text/latex → text/plain
```

## Implementation Units

- [ ] **Unit 1: File Type Detection and Viewer Routing**

**Goal:** Register `.ipynb` as a known file type so it opens in a dedicated viewer rather than CodeViewer.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `src/utils/fileTypes.js`
- Modify: `src/context/WorkspaceContext.jsx`
- Modify: `src/App.jsx`
- Test: `src/__tests__/fileTypes.test.js`

**Approach:**
- Add `isNotebookFile(fileName)` to `fileTypes.js` that checks `.ipynb` extension
- Insert `isNotebookFile` check in `getViewerType()` **before** the `isCodeFile` check (`.ipynb` is JSON and would otherwise match `isCodeFile`)
- Update `isQuipuOpenable` to return `true` for `.ipynb`
- In `WorkspaceContext.openFile()`: add `isNotebook: true` to the tab object; read file content normally via `fs.readFile` (notebooks are text/JSON, not binary)
- In `App.jsx` viewer cascade: add `isNotebookFile(activeFile.name) → <NotebookViewer .../>` before the `isCodeFile` check; import `isNotebookFile` from fileTypes
- In the `Ctrl+S` handler and `handleMenuAction` save path: detect `isNotebook` and skip TipTap save (notebook viewer manages its own save, deferred to follow-up)

**Patterns to follow:**
- How `isMermaidFile` and `isExcalidrawFile` are added to `fileTypes.js`
- How `isPdf`/`isMedia` flags are set in `openFile()` and used in `App.jsx`

**Test scenarios:**
- Happy path: `isNotebookFile('analysis.ipynb')` returns `true`
- Happy path: `isNotebookFile('script.py')` returns `false`
- Edge case: `isNotebookFile('ANALYSIS.IPYNB')` — decide and document case sensitivity behavior
- Happy path: `getViewerType({ name: 'data.ipynb' })` returns `'notebook'`
- Correctness: `getViewerType({ name: 'data.json' })` does NOT return `'notebook'` (regression guard for JSON files)
- Happy path: `isQuipuOpenable({ name: 'notebook.ipynb' })` returns `true`

**Verification:**
- Opening any `.ipynb` file mounts `NotebookViewer` (can be a stub at this stage), not CodeViewer or TipTap
- All other file types continue to open in their correct viewers

---

- [ ] **Unit 2: Static Notebook Renderer**

**Goal:** Parse the `.ipynb` JSON and render all cell types (code, markdown, raw) with their saved outputs, before any kernel is connected.

**Requirements:** R2, R3, R10

**Dependencies:** Unit 1

**Files:**
- Create: `src/components/NotebookViewer.jsx`
- Create: `src/components/notebook/NotebookCell.jsx`
- Create: `src/components/notebook/CellOutput.jsx`
- Test: `src/__tests__/notebookViewer.test.js`

**Approach:**
- `NotebookViewer` receives `{ filePath, fileName, content }` — `content` is the raw JSON string
- Parse `content` with `JSON.parse()` on mount; handle parse errors gracefully with an error toast and raw JSON fallback display
- Render each item in `notebook.cells` based on `cell_type`:
  - `markdown`: render `source` (joined string array) with a markdown library — confirm at implementation time whether `marked` is already transitively installed, otherwise add it
  - `code`: render `source` with Monaco Editor in read-only mode (Monaco is already in the bundle), followed by the `outputs` array
  - `raw`: render `source` in a plain `<pre>`
- CellOutput renders each entry in `outputs` by `output_type`:
  - `stream`: join `text` array, pass through `ansi-to-react` in a `<pre>`
  - `display_data` / `execute_result`: MIME priority picker (see High-Level Technical Design). Sanitize `text/html` with DOMPurify before `dangerouslySetInnerHTML`
  - `error`: join `traceback` with newlines, pass through `ansi-to-react`
- Execution count gutter: show `[{execution_count}]` for code cells with saved outputs; show `[ ]` if null/undefined
- All styling via Tailwind utility classes; use theme tokens (`bg-bg-surface`, `border-border`, etc.)
- No edit interactions in v1 — cells are read-only

**Execution note:** Build and test static rendering completely before wiring any kernel. This lets reviewers verify the reading path independently.

**Patterns to follow:**
- `PdfViewer.jsx` and `CodeViewer.jsx` for component structure and prop contract
- `useCallback` for any event handlers; `useRef` for DOM elements; `useEffect` with explicit deps
- `showToast` for user-visible errors

**Test scenarios:**
- Happy path: notebook with a markdown cell renders `source` as HTML (not raw markdown)
- Happy path: notebook with a code cell renders `source` in a code block
- Happy path: `stream` output (stdout) renders text without ANSI artifacts
- Happy path: `display_data` with `image/png` renders an `<img>` with base64 data URI
- Happy path: `execute_result` with `text/html` renders sanitized HTML
- Happy path: `error` output renders traceback with ANSI colors
- Edge case: cell with `execution_count: null` shows `[ ]` in the gutter
- Edge case: `display_data` with multiple MIME types picks the highest-priority renderable type
- Edge case: empty notebook (`cells: []`) renders without crash
- Error path: `content` is invalid JSON — shows error toast, does not crash
- Error path: `text/html` output with a `<script>` tag — DOMPurify removes it
- Edge case: cell with saved `text/plain` output >100 KB is truncated with a "Output truncated (showing first 100 KB)" notice
- Error path: notebook has `nbformat: 3` (using `worksheets[0].cells`) — shows "nbformat 3 not supported" error toast instead of crashing or rendering nothing

**Verification:**
- Open a real `.ipynb` file (e.g., from a data science project) and verify all cell types and output types render correctly
- No raw JSON visible; markdown is rendered as HTML; code has syntax highlighting

---

- [ ] **Unit 3: venv Selection and Kernel Service Adapter**

**Goal:** Let the user select a `.venv` path, validate it, persist it, and expose a uniform kernel service API for both runtimes.

**Requirements:** R4, R8

**Dependencies:** Unit 1 (for UI scaffolding); Units 4 and 5 (for integration verification — browser and Electron backends must exist to test non-mock paths)

**Files:**
- Create: `src/services/kernelService.js`
- Modify: `src/components/NotebookViewer.jsx` (add venv selector UI)
- Test: `src/__tests__/kernelService.test.js`

**Approach:**
- `kernelService.js` follows the exact dual-runtime adapter pattern of `terminalService.js`:
  - `browserKernelService`: calls Go HTTP endpoints (`/api/jupyter/...`) via `fetch`
  - `electronKernelService`: calls IPC via `window.electronAPI.kernel*`
  - Export: `const kernelService = isElectron() ? electronKernelService : browserKernelService`
- Exported API: `{ startServer(venvPath), stopServer(), createSession(notebookPath), closeSession(sessionId), getKernelspecs(), onKernelOutput(sessionId, callback), removeKernelOutputListener(sessionId), interruptKernel(sessionId), restartKernel(sessionId), executeCell(sessionId, code, msgId) }`
- venv path persistence: use `storageService.get('notebookVenvPath')` / `storageService.set('notebookVenvPath', path)` — loads the last-used venv automatically
- venv validation happens server-side (Unit 4/5); the service calls a validation endpoint and surfaces errors as rejected Promises
- In `NotebookViewer.jsx`: add a toolbar "Select Environment" button that opens a directory picker (reuse the existing workspace folder picker pattern). Show the selected venv path and a status indicator (valid / invalid / not set). Only show "Run" controls when a venv is selected and validated.

**Patterns to follow:**
- `src/services/terminalService.js` — dual-runtime adapter with WebSocket management
- `storageService` usage in `WorkspaceContext.jsx`
- `isElectron()` from `src/config.js`

**Test scenarios:**
- Happy path: `isElectron()` returns `false` → service uses `fetch`-based browser implementation
- Happy path: `isElectron()` returns `true` → service uses `electronAPI.*` calls
- Happy path: venv path stored via `storageService.set` and retrieved correctly on next mount
- Edge case: no venv path set → `getVenvPath()` returns `null` → UI shows "Select Environment" prompt
- Error path: `startServer` rejects with a clear message when venv path has no `jupyter` binary

**Verification:**
- Service adapter switches runtimes correctly based on `isElectron()`
- Selecting a venv persists across tab close/reopen

---

- [ ] **Unit 4: Go Server — Jupyter Process Management and Proxy**

**Goal:** Launch `jupyter server` from the selected venv, manage its lifecycle, proxy its REST API, and proxy the kernel WebSocket channel.

**Requirements:** R5, R8, R9

**Dependencies:** Unit 3

**Files:**
- Modify: `server/main.go`

**Approach:**

*Process management:*
- New Go state: `jupyterServer` struct tracking `cmd *exec.Cmd`, `port int`, `token string`, `runtimeDir string`, `pid int`
- `POST /api/jupyter/start`: accepts `{ venvPath, workspaceRoot }` JSON body. Validate `venvPath` is an absolute path and that `{venvPath}/bin/jupyter` (Linux/macOS) or `{venvPath}\Scripts\jupyter.exe` (Windows) exists via `os.Stat`. Generate a 32-byte hex token via `crypto/rand`. Spawn `exec.Command(jupyterBin, "server", "--no-browser", "--ip=127.0.0.1", "--ServerApp.allow_remote_access=False", "--ServerApp.root_dir=...", "--ServerApp.allow_origin=*")` with `JUPYTER_TOKEN=token` and `JUPYTER_RUNTIME_DIR=tempDir` in env. Spawn in its own process group (`cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}` on Unix). Poll for `jpserver-{pid}.json` in `tempDir`, up to 30 seconds.
- `DELETE /api/jupyter/stop`: send SIGTERM to process group, wait 3 seconds, then SIGKILL if still running. Remove `jupyterServer` state.
- `GET /api/jupyter/validate`: accepts `{ venvPath }`, checks that the jupyter binary exists and is executable. Returns `{ valid: bool, error?: string }`.
- **Singleton + mutex**: Protect `jupyterServer` state with a `sync.Mutex`. On `POST /api/jupyter/start`, if a start is already in progress, wait for it to complete and return the same result (do not spawn a second process). If already running, return the existing state immediately. Track three states: `stopped`, `starting`, `running`.
- Register the workspace cleanup hook to call stop when the workspace is closed

*REST proxy:*
- `POST /api/jupyter/sessions` → `POST http://127.0.0.1:{port}/api/sessions` with `Authorization: token` header
- `DELETE /api/jupyter/sessions/{id}` → `DELETE http://127.0.0.1:{port}/api/sessions/{id}` with auth header
- `POST /api/jupyter/kernels/{id}/interrupt` → forward with auth
- `POST /api/jupyter/kernels/{id}/restart` → forward with auth
- `GET /api/jupyter/kernelspecs` → forward with auth (returns available kernel specs)

*WebSocket proxy:*
- `GET /ws/jupyter/kernels/{id}/channels` — upgrade client connection, dial `ws://127.0.0.1:{port}/api/kernels/{id}/channels?token=TOKEN` with `Origin: http://127.0.0.1:{port}` header (required to pass Jupyter's CORS check). Copy text frames bidirectionally in two goroutines. Implement the same reconnection-aware cleanup as `handleTerminal`.

*Security:*
- All new HTTP handlers wrapped with `corsMiddleware(...)`
- venv path validated with `filepath.Abs` + `os.Stat` — never passed to shell as a string
- The Jupyter token is never sent to the frontend; only Go holds it
- `isWithinWorkspace` sandbox must NOT apply to venv path validation (venv lives outside workspace)

**Patterns to follow:**
- `handleTerminal` for WebSocket bidirectional proxy with goroutines
- `runGitCommand` for `exec.Command` with argument arrays
- `corsMiddleware(handleX)` registration pattern
- `isLocalOrigin()` for WebSocket origin checking

**Test scenarios:**
- Happy path: `POST /api/jupyter/start` with a valid venv launches jupyter server and returns `{ status: "started" }`
- Happy path: `GET /api/jupyter/validate` with valid venv returns `{ valid: true }`
- Error path: `GET /api/jupyter/validate` with a venv missing jupyter returns `{ valid: false, error: "jupyter not found at ..." }`
- Error path: `POST /api/jupyter/start` when jupyter server fails to start within 30 seconds returns 500 with a descriptive error
- Security: `POST /api/jupyter/start` with a path traversal in `venvPath` (e.g., `../../etc`) — rejected before exec
- Integration: `POST /api/jupyter/sessions` is proxied with the `Authorization: token` header added
- Integration: WebSocket proxy at `/ws/jupyter/kernels/{id}/channels` forwards text frames bidirectionally

**Verification:**
- `jupyter server` process appears in process list after `POST /api/jupyter/start`
- REST proxy returns valid responses from the Jupyter server
- WebSocket proxy successfully carries `execute_request` and delivers `stream` / `execute_result` frames
- Jupyter server process is killed on `DELETE /api/jupyter/stop`

---

- [ ] **Unit 5: Electron — Jupyter Process Management IPC**

**Goal:** Implement the Electron-side subprocess management for `jupyter server`, mirroring Unit 4's API via IPC.

**Requirements:** R5, R8, R9

**Dependencies:** Unit 3

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`

**Approach:**

*`electron/main.cjs`:*
- Maintain `jupyterServer` state object (parallel to Go's state): `{ process, port, token, runtimeDir }`
- `ipcMain.handle('jupyter-validate', async (event, { venvPath }) => ...)` — stat the jupyter binary, return `{ valid, error? }`
- `ipcMain.handle('jupyter-start', async (event, { venvPath, workspaceRoot }) => ...)` — same validation as Unit 4, generate token via Node `crypto.randomBytes(32).toString('hex')`, spawn via `child_process.spawn()` with `JUPYTER_TOKEN` and `JUPYTER_RUNTIME_DIR` env vars, poll `jpserver-{pid}.json`, return `{ port, status }`
- `ipcMain.handle('jupyter-stop', async () => ...)` — kill the process and cleanup
- `ipcMain.handle('jupyter-proxy-rest', async (event, { method, path, body }) => ...)` — make HTTP calls to the local Jupyter server with `Authorization: token` header using Node's `http` module. This proxies REST calls (sessions, interrupt, restart, kernelspecs) for the Electron runtime.
- Listen on `app.on('before-quit')` and `app.on('window-all-closed')` to call jupyter-stop
- Binary path resolution: `path.join(venvPath, process.platform === 'win32' ? 'Scripts/jupyter.exe' : 'bin/jupyter')`

*`electron/preload.cjs`:*
- Expose in `contextBridge.exposeInMainWorld('electronAPI', { ... })`:
  - `kernelValidate: (venvPath) => ipcRenderer.invoke('jupyter-validate', { venvPath })`
  - `kernelStart: (venvPath, workspaceRoot) => ipcRenderer.invoke('jupyter-start', { venvPath, workspaceRoot })`
  - `kernelStop: () => ipcRenderer.invoke('jupyter-stop')`
  - `kernelProxyRest: (method, path, body) => ipcRenderer.invoke('jupyter-proxy-rest', { method, path, body })`

*WebSocket in Electron — resolved decision:* The Go server is not co-started in Electron mode (Electron uses IPC, not HTTP). The renderer cannot reach a Go WebSocket proxy. Instead: add `kernelGetChannelUrl: (kernelId) => ipcRenderer.invoke('jupyter-get-channel-url', { kernelId })` to the preload bridge. In `main.cjs`, `jupyter-get-channel-url` returns `ws://127.0.0.1:{port}/api/kernels/{kernelId}/channels?token=${token}`. The renderer uses this URL to open the WebSocket directly to Jupyter. The token is used only to open the connection and is not stored. REST calls still go via `kernelProxyRest` IPC.

**Patterns to follow:**
- `ptyProcesses` Map and `terminal-create` handler in `main.cjs`
- `execFile` from `child_process` for external command calls
- `contextBridge` entries in `preload.cjs`

**Test scenarios:**
- Happy path: `jupyter-validate` IPC with valid venv returns `{ valid: true }`
- Error path: `jupyter-validate` with missing jupyter binary returns `{ valid: false, error: "..." }`
- Happy path: `jupyter-start` spawns process, polls runtime dir, returns port
- Happy path: `jupyter-stop` kills the process and clears state
- Edge case: calling `jupyter-start` when already running returns existing state rather than spawning a second process
- Integration: `app.on('before-quit')` triggers `jupyter-stop` so no orphaned processes remain after app quit

**Verification:**
- Electron runtime can start, use, and stop a Jupyter server via IPC without touching the Go layer for subprocess management
- No orphaned `jupyter server` processes after Electron app quits

---

- [ ] **Unit 6: Live Cell Execution**

**Goal:** Wire the frontend to the kernel WebSocket and implement the full cell execution lifecycle: run cell → stream outputs → show completion state.

**Requirements:** R6, R7, R10

**Dependencies:** Units 2, 3, 4, 5

**Files:**
- Modify: `src/components/NotebookViewer.jsx`
- Modify: `src/components/notebook/NotebookCell.jsx`
- Modify: `src/components/notebook/CellOutput.jsx`
- Modify: `src/services/kernelService.js`

**Approach:**

*WebSocket kernel connection:*
- On first "Run" action: call `kernelService.startServer()` — the service adapter serializes concurrent calls (stores an in-flight Promise; concurrent callers await the same Promise rather than racing). After server is up, call `kernelService.createSession(notebookPath)`.
- In browser mode: open WebSocket to `ws://{SERVER_URL}/ws/jupyter/kernels/{kernelId}/channels` (Go proxy)
- In Electron mode: call `kernelService.getChannelUrl(kernelId)` → IPC `jupyter-get-channel-url` → receive the full `ws://127.0.0.1:{port}/api/kernels/{id}/channels?token=TOKEN` URL → open WebSocket directly to Jupyter
- Implement reconnection following `Terminal.jsx`'s pattern: `intentionalClose` flag, `MAX_RETRIES = 3`, `RETRY_DELAY = 2000ms`, progressive status feedback
- Store kernel WebSocket in a `useRef` within `NotebookViewer`
- Track kernel status in component state: `kernelStatus: 'idle' | 'busy' | 'starting' | 'dead' | 'disconnected'`

*Message handling:*
- On every incoming WebSocket text frame: `JSON.parse` → route by `channel` and `header.msg_type`
- `iopub` + `status` → update `kernelStatus` from `content.execution_state` **regardless of `parent_header.msg_id`** — kernel-level status (startup, restart idle) arrives with an empty or unrecognized `parent_header` and must still update the indicator
- `iopub` + `stream` / `display_data` / `execute_result` / `error` → append to the output array for the cell matching `parent_header.msg_id`; if no matching cell is found (e.g., post-restart stale message), discard silently without throwing
- `shell` + `execute_reply` → if `msg_id` still in queue, update `execution_count` and clear `[*]`; if no longer in queue (e.g., kernel restarted mid-execution), discard silently

*Cell execution state:*
- Per-cell state: `executionStatus: 'idle' | 'queued' | 'running' | 'done' | 'error'`
- Live outputs replace saved outputs during and after execution (not appended to saved outputs)
- Execution count: show `[*]` while `running`, `[{n}]` after `execute_reply` received

*Execution queue:*
- Local queue in `NotebookViewer` state — if multiple "Run" clicks occur, queue them; send next `execute_request` only after `execute_reply` for the current cell
- Generate a `msg_id` (UUID or timestamp-based) per execute request; use `parent_header.msg_id` to correlate responses to cells

*Kernel controls:*
- "Run cell" button on each code cell (Shift+Enter shortcut)
- "Run all" in the notebook toolbar
- "Interrupt" button (visible when kernel is busy) → `kernelService.interruptKernel(sessionId)`
- "Restart kernel" in toolbar → `kernelService.restartKernel(sessionId)` → clear all cell outputs and reset execution counts
- "Shutdown kernel" → `kernelService.closeSession(sessionId)` + `kernelService.stopServer()`
- Kernel status indicator dot in the toolbar: green (idle), orange (busy), red (dead), grey (disconnected)

*Cleanup:*
- On tab close or component unmount: close the WebSocket with `intentionalClose = true`, call `kernelService.closeSession(sessionId)` (do not stop the server — other notebooks may still use it)
- On workspace close: `kernelService.stopServer()` which triggers Unit 4/5 cleanup

**Patterns to follow:**
- `Terminal.jsx` WebSocket management with `intentionalClose` and retry logic
- `useCallback` for all handlers, `useRef` for the WebSocket connection
- `showToast` for kernel start errors, kernel death notifications

**Test scenarios:**
- Happy path: running a cell that `print('hello')` produces a `stream` output with `"hello\n"` text
- Happy path: `execute_result` with `text/plain: "42"` updates the cell's execution count and displays the result
- Happy path: kernel `status` message with `execution_state: "busy"` updates the toolbar indicator to orange
- Happy path: `status: idle` after `execute_reply` → cell shows `[3]`, status dot turns green
- Edge case: two cells queued — second cell shows `[*]` (queued) and does not send `execute_request` until first cell's `execute_reply` is received
- Error path: kernel sends `error` message → traceback rendered with ANSI colors, cell left border turns red
- Error path: WebSocket closes unexpectedly → retry up to `MAX_RETRIES`, then show "Kernel disconnected" toast with reconnect button
- Integration: interrupt during execution → `POST interrupt` → cell receives partial output + `KeyboardInterrupt` error output, kernel returns to idle
- Integration: restart kernel → all cell execution counts reset to `[ ]`, all live outputs cleared, kernel status cycles through `restarting → idle`
- Integration: `parent_header.msg_id` correctly routes IOPub outputs to the cell that triggered them (not to the wrong cell)
- Edge case: `status` IOPub message with an empty `parent_header` (kernel startup) still updates the kernel status indicator
- Edge case: `execute_reply` arrives for a `msg_id` no longer in the queue (post-restart) — handled silently without error or stuck `[*]` state
- Edge case: two concurrent `startServer()` calls — only one Jupyter process spawns; second caller awaits the first

**Verification:**
- Can open a notebook, select a venv, run a cell, and see streaming output appear in real time
- `plt.show()` (matplotlib) renders an `image/png` output inline
- Kernel status indicator accurately reflects idle/busy/dead states
- No orphaned processes or WebSocket connections after tab close

---

## System-Wide Impact

- **Interaction graph:** The new `/api/jupyter/*` Go endpoints and `/ws/jupyter/kernels/*` WebSocket route are new surfaces; no existing handlers are modified. `workspaceExplicit` path sandboxing must explicitly exclude venv paths.
- **Error propagation:** Kernel errors (death, timeout) surface as toasts in `NotebookViewer`. Jupyter server startup failure surfaces as a toast with a clear install instruction (`pip install jupyter-server`). Go proxy errors return structured JSON `{ error: string }` responses.
- **State lifecycle risks:** A `jupyter server` process must not be left running after app quit. The `app.on('before-quit')` hook in Electron and Go server shutdown handler must reliably call stop. Use process groups (`Setpgid`) to prevent orphaned kernel sub-processes.
- **API surface parity:** All kernel operations (validate, start, stop, createSession, closeSession, interrupt, restart) must be present in both the Go HTTP layer and the Electron IPC layer. Missing any layer silently fails one runtime.
- **Integration coverage:** Unit tests alone won't prove the full execution flow — at least one manual test with a real `.ipynb` file against a real Jupyter installation is required before shipping.
- **Unchanged invariants:** All existing viewers (PDF, media, code, Excalidraw, Mermaid, TipTap) are unaffected. `fileSystem.js` operations are unaffected — notebooks are read via the existing `readFile` path. No changes to the TipTap editor, Terminal, or Git services.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `jupyter server` not installed in selected venv | Validate binary before accepting venv; show clear toast: "jupyter not found — run `pip install jupyter-server` in your venv" |
| Jupyter Server startup takes >30 seconds on slow machines | Poll for 45 seconds with a visible "Starting Jupyter..." progress state in the UI; let user cancel |
| `ansi-to-react` peer dep conflict with React 19 | Test at `npm install` time; fallback: `fancy-ansi` or strip ANSI codes with a simple regex |
| DOMPurify not in bundle | Check at implementation time; alternatives: `xss` npm package, or disable `text/html` rendering in v1 |
| Jupyter WebSocket closes spuriously on Windows | Follow the existing CORS + reconnection institutional learnings; test on Windows during implementation |
| Large notebook outputs (>1 MB) cause UI freeze | Add output truncation: cap stream outputs at ~50 KB per cell, show "Output truncated" notice |
| Go proxy `Origin` header rejected by Jupyter Server | Set `Origin: http://127.0.0.1:{port}` on the upstream WebSocket dial (Jupyter accepts same-host origins by default). Do not use `allow_origin=*` — it weakens CORS protection unnecessarily |
| Multiple notebooks competing for the same Jupyter server port | One server per workspace session; track as singleton with `sync.Mutex` in Go state |
| App killed hard (SIGKILL) leaves orphaned jupyter server | Document this as a known limitation; add process group kill in addition to child PID kill |

## Documentation / Operational Notes

- Users need `jupyter-server` installed in their venv: `pip install jupyter-server`
- The selected `.venv` path is persisted per-machine in `storageService` — users set it once
- Jupyter server port is chosen dynamically; it is internal (Go proxy) and never exposed directly to the user
- The Jupyter token is ephemeral (regenerated each start) and never visible to the user

## Sources & References

- Related code: `src/services/terminalService.js`, `server/main.go:handleTerminal`, `electron/main.cjs:terminal-create`
- External docs: [Jupyter Server REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html)
- External docs: [Jupyter Messaging Protocol](https://jupyter-client.readthedocs.io/en/stable/messaging.html)
- External docs: [Jupyter Server Security](https://jupyter-server.readthedocs.io/en/latest/operators/security.html)
- Institutional learnings: `docs/solutions/feature-implementations/excalidraw-viewer-file-type-routing.md`
- Institutional learnings: `docs/solutions/integration-issues/terminal-websocket-reconnection.md`
- Institutional learnings: `docs/solutions/runtime-errors/windows-cors-403-go-server-websocket.md`
