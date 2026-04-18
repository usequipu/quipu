# Quipu

A web-based code editor built with React + Vite + Electron + TypeScript, featuring a TipTap rich text editor, xterm.js terminal, and dual runtime support (Electron desktop + browser with Go backend).

## Architecture

### Dual Runtime

Every backend operation must work in **both** runtimes:
- **Electron**: IPC handlers in `electron/main.cjs`, exposed via `electron/preload.cjs` contextBridge
- **Browser**: REST/WebSocket calls to Go server at `localhost:3000` in `server/main.go`

The adapter pattern in `src/services/` selects the implementation at module load:
```typescript
const fs = isElectron() ? electronFS : browserFS;
```

**New backend features** require changes in 4 places:
1. Go server endpoint (`server/main.go`)
2. Electron IPC handler (`electron/main.cjs`)
3. Preload bridge (`electron/preload.cjs`)
4. Service adapter (`src/services/<name>.ts`)

### Service Layer

- `src/services/fileSystem.ts` - file CRUD operations
- `src/services/gitService.ts` - git operations
- `src/services/searchService.ts` - text search + file listing
- `src/services/frameService.ts` - FRAME annotation sidecar files
- `src/services/terminalService.ts` - terminal I/O
- `src/services/storageService.ts` - persistent key-value storage
- `src/services/kernelService.ts` - Jupyter kernel management
- `src/services/fileWatcher.ts` - file change detection
- `src/services/claudeInstaller.ts` - Claude CLI integration

Each service exports a typed interface and a default implementation object.

### State Management

Three focused React contexts composed by `WorkspaceProvider`:

- **`TabContext`** (`src/context/TabContext.tsx`) — Tab state (`openTabs`, `activeTabId`), file operations (`openFile`, `saveFile`, `closeTab`), frontmatter operations, file watcher, conflict resolution, session restore. Uses `useTab()` hook.
- **`FileSystemContext`** (`src/context/FileSystemContext.tsx`) — Workspace state (`workspacePath`, `fileTree`, `expandedFolders`), file CRUD (`createNewFile`, `deleteEntry`, `renameEntry`), workspace management (`selectFolder`, `recentWorkspaces`). Uses `useFileSystem()` hook.
- **`TerminalContext`** (`src/context/TerminalContext.tsx`) — Terminal tabs, xterm operations (`sendToTerminal`, `clearTerminal`, `getTerminalSelection`). Replaces all `window.__quipu*` globals. Uses `useTerminal()` hook.
- **`WorkspaceProvider`** (`src/context/WorkspaceContext.tsx`) — Thin composition wrapper. Nesting: `FileSystemProvider > TabProvider > TerminalProvider > SessionPersistence`.

**No Redux, Zustand, or useReducer.** Each context uses `useState` + `useCallback`.

### Component Organization

```
src/components/
  editor/           # Editor-specific components
    Editor.tsx       # TipTap rich text editor with comment system
    FindBar.tsx      # In-editor find/replace
    FrontmatterProperties.tsx  # YAML frontmatter editor
    extensions/      # TipTap ProseMirror plugins
      BlockDragHandle.ts
      RevealMarkdown.ts
      FindReplace.ts
      WikiLink.ts
      CodeBlockWithLang.tsx
  ui/                # General UI + shadcn primitives
    ActivityBar.tsx, FileExplorer.tsx, TabBar.tsx, Terminal.tsx, ...
    Toast.tsx (sonner), MenuBar.tsx (Radix), QuickOpen.tsx (cmdk), FolderPicker.tsx (Radix Dialog)
    button.tsx, input.tsx, badge.tsx, collapsible.tsx  # shadcn (lowercase)
```

### Extension System

Viewer extensions in `src/extensions/` register with the registry and replace the editor for specific file types:

```
src/extensions/
  registry.ts          # registerExtension(), resolveViewer(), getExtensionForTab(), getCommandsForTab()
  index.ts             # Side-effect import — only diff-viewer and database-viewer remain in core
  panelRegistry.ts     # registerPanel(), getRegisteredPanels() — drives ActivityBar
  commandRegistry.ts   # registerCommand(), getRegisteredCommands() — drives QuickOpen
  keybindingRegistry.ts # registerKeybinding(), resolveKeybinding()
  diff-viewer/         # stays in core (tab.type === 'diff')
  database-viewer/     # stays in core permanently
  pdf-viewer/, code-viewer/, notebook/, mermaid-viewer/, media-viewer/, excalidraw-viewer/
                       # source kept for reference; distributed as plugins (see below)
```

Extension descriptors support: `{ id, canHandle, priority, component, commands?, onSave?, onSnapshot? }`

**TipTap plugins** live in `src/components/editor/extensions/` (separate from viewer extensions).

### Plugin System

Heavy viewers are distributed as independently installed plugins from `https://github.com/usequipu/`:

| Plugin repo | File types |
|---|---|
| `pdf-plugin` | `.pdf` |
| `code-plugin` | `.js`, `.ts`, `.py`, `.go`, `.rs`, + 15 more |
| `mermaid-plugin` | `.mmd`, `.mermaid` |
| `excalidraw-plugin` | `.excalidraw` |
| `media-plugin` | images + video |
| `notebook-plugin` | `.ipynb` |
| `diff-plugin` | git diff tabs |

Plugins are loaded at startup from `~/.quipu/plugins/` via `src/services/pluginLoader.ts`. Each plugin exports `init(api: PluginApi)` and bundles its own dependencies. The first-run wizard (`FirstRunWizard.tsx`) and plugin manager panel (`PluginManager.tsx`) handle install/uninstall/update.

### Editor

- **TipTap v3** with StarterKit + Placeholder + custom Comment mark (extends Highlight)
- **Markdown round-trip**: Uses `tiptap-markdown` for both parse and serialize. `.md` files loaded/saved as markdown. `.quipu` files use TipTap JSON.
- **Save formats**:
  - `.quipu` -> `JSON.stringify({ type: "quipu", version: 1, content: editor.getJSON() })`
  - `.md`/`.markdown` -> `editor.storage.markdown.getMarkdown()`
  - Everything else -> `editor.getText()` (plain text)

## Code Conventions

### TypeScript
- **Strict mode** (`strict: true` in tsconfig.json) — all files are `.ts`/`.tsx`
- **Props interfaces** for all components (e.g., `interface EditorProps { ... }`)
- **Typed hooks**: `useState<Type>()`, `useRef<Type>()`, typed `useCallback` parameters
- **Shared types** in `src/types/`: `tab.ts`, `workspace.ts`, `editor.ts`, `extensions.ts`
- **Pragmatic `any`** allowed only for ProseMirror plugin internals in `src/components/editor/extensions/`

### Components
- **Functional components only** - no class components
- **Tailwind CSS v4** for all styling — no co-located CSS files per component
- **shadcn/ui** primitives in `src/components/ui/` (Button, Input, Badge, Collapsible + Radix Menubar, cmdk Command, sonner Toast, Radix Dialog)
- **Phosphor Icons** via `@phosphor-icons/react` — use `Icon` suffix naming (e.g., `FilesIcon`, `XIcon`)
- **`cn()` utility** from `@/lib/utils` for conditional class composition (clsx + tailwind-merge)
- **Path alias** `@/` maps to `./src` in vite.config.ts

### Naming
- Component files: PascalCase (`Editor.tsx`, `FileExplorer.tsx`)
- Service/context files: camelCase (`fileSystem.ts`, `TabContext.tsx`)
- Handlers: `handle` prefix (`handleClick`, `handleContextMenu`)
- Booleans: `is` prefix (`isDirty`, `isExpanded`)

### Hooks
- `useCallback` for all event handlers and context operations
- `useRef` for DOM references and mutable values
- `useEffect` with explicit dependency arrays
- **Hook ordering** (critical — prevents TDZ bugs): state first, leaf callbacks second, dependent callbacks third, effects last
- Context hooks: `useTab()`, `useFileSystem()`, `useTerminal()`

### Styling

**Tailwind CSS v4** with `@tailwindcss/vite` plugin. All component styling uses Tailwind utility classes inline.

Theme tokens defined in `src/styles/theme.css` via `@theme` directive:
- **Backgrounds**: `bg-bg-base`, `bg-bg-surface`, `bg-bg-elevated`, `bg-bg-overlay`
- **Text**: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`
- **Accent**: `bg-accent`, `text-accent`, `hover:bg-accent-hover`, `bg-accent-muted`
- **Borders**: `border-border`
- **Editor page**: `bg-page-bg`, `text-page-text`, `border-page-border` (warm cream theme for document area)
- **Git status**: `text-git-modified`, `text-git-added`, `text-git-deleted`, `text-git-renamed`
- **Semantic**: `bg-error`, `bg-warning`, `bg-success`, `bg-info`

Remaining CSS files (not in Tailwind):
- `src/index.css` — Google Fonts import, global scrollbar, body/root base styles
- `src/styles/theme.css` — Tailwind v4 `@theme` tokens, custom keyframe animations
- `src/styles/prosemirror.css` — TipTap/ProseMirror DOM styles (can't be controlled via Tailwind)

### Error Handling
- Use `showToast(message, type)` for all user-facing errors (powered by sonner)
- Never use `console.error` alone for failures the user should know about
- Toast types: `error`, `warning`, `success`, `info`

### Electron-Specific
- CommonJS files use `.cjs` extension (`main.cjs`, `preload.cjs`)
- `-webkit-app-region: drag` on window title bars
- `-webkit-app-region: no-drag` on interactive elements within drag regions

## Security

- Go server MUST sandbox all file operations to the workspace root
- CORS restricted to localhost origins
- Git/search commands use `exec.Command` with argument arrays (never string concatenation)
- Validate all user-supplied paths before passing to shell commands

## Versioning

**Always bump `version` in `package.json` before committing.** Use semver:
- `0.x.0` — new features or significant changes
- `0.x.y` — bug fixes and minor patches

Every commit that ships code must have a corresponding version bump. The git tag must match the version in `package.json`.

## Development

```bash
npm run dev          # Vite dev server (browser mode, needs Go server)
npm run start        # Vite + Electron concurrently
cd server && go run main.go  # Go backend server
npm run test:run     # Run all tests
npx tsc --noEmit     # Type check
```

## Key Files

- `src/App.tsx` - Root layout, keyboard shortcuts
- `src/context/WorkspaceContext.tsx` - Provider composition (FileSystem > Tab > Terminal)
- `src/context/TabContext.tsx` - Tab state, file operations, file watcher, session
- `src/context/FileSystemContext.tsx` - Workspace path, file tree, file CRUD
- `src/context/TerminalContext.tsx` - Terminal tabs, xterm operations
- `src/components/editor/Editor.tsx` - TipTap editor with comment system
- `src/components/ui/FileExplorer.tsx` - File tree sidebar
- `src/components/ui/Terminal.tsx` - xterm.js terminal
- `src/components/ui/TitleBar.tsx` - Window title bar with MenuBar and window controls
- `src/components/editor/FrontmatterProperties.tsx` - YAML frontmatter editor
- `src/extensions/registry.ts` - Extension registry with descriptor dispatch
- `src/styles/theme.css` - Tailwind v4 theme tokens and custom animations
- `src/styles/prosemirror.css` - TipTap/ProseMirror editor styles
- `src/lib/utils.ts` - `cn()` utility (clsx + tailwind-merge)
- `src/services/fileSystem.ts` - Dual-runtime file system adapter
- `server/main.go` - Go HTTP/WebSocket server
- `electron/main.cjs` - Electron main process
- `electron/preload.cjs` - Electron preload (contextBridge)
