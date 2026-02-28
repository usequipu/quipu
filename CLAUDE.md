# Quipu Simple

A web-based code editor built with React + Vite + Electron, featuring a TipTap rich text editor, xterm.js terminal, and dual runtime support (Electron desktop + browser with Go backend).

## Architecture

### Dual Runtime

Every backend operation must work in **both** runtimes:
- **Electron**: IPC handlers in `electron/main.cjs`, exposed via `electron/preload.cjs` contextBridge
- **Browser**: REST/WebSocket calls to Go server at `localhost:3000` in `server/main.go`

The adapter pattern in `src/services/` selects the implementation at module load:
```javascript
const fs = isElectron() ? electronFS : browserFS;
```

**New backend features** require changes in 4 places:
1. Go server endpoint (`server/main.go`)
2. Electron IPC handler (`electron/main.cjs`)
3. Preload bridge (`electron/preload.cjs`)
4. Service adapter (`src/services/<name>.js`)

### Service Layer

- `src/services/fileSystem.js` - file CRUD operations
- `src/services/gitService.js` - git operations (planned)
- `src/services/searchService.js` - text search + file listing (planned)

Each service exports a single default object with the same API shape for both runtimes.

### State Management

- **Single context**: `WorkspaceContext` is the sole state provider. No Redux, Zustand, or useReducer.
- **No TypeScript**: Plain JavaScript (.jsx / .js / .css) throughout.

### Editor

- **TipTap v3** with StarterKit + Placeholder + custom Comment mark (extends Highlight)
- **Markdown round-trip**: Uses `tiptap-markdown` for both parse and serialize. `.md` files loaded/saved as markdown. `.quipu` files use TipTap JSON.
- **Save formats**:
  - `.quipu` -> `JSON.stringify({ type: "quipu", version: 1, content: editor.getJSON() })`
  - `.md`/`.markdown` -> `editor.storage.markdown.getMarkdown()`
  - Everything else -> `editor.getText()` (plain text)

## Code Conventions

### Components
- **Functional components only** - no class components
- **Arrow functions** for Editor, Terminal; **named function declarations** for FileExplorer, App
- **One CSS file per component** (co-located): `Component.jsx` + `Component.css`
- **No CSS modules, no CSS-in-JS** - plain CSS with kebab-case class names

### Naming
- Component files: PascalCase (`Editor.jsx`, `FileExplorer.jsx`)
- Service/context files: camelCase (`fileSystem.js`, `WorkspaceContext.jsx`)
- CSS classes: kebab-case (`editor-page-container`, `tree-item-active`)
- Handlers: `handle` prefix (`handleClick`, `handleContextMenu`)
- Booleans: `is` prefix (`isDirty`, `isExpanded`)

### Hooks
- `useCallback` for all event handlers and context operations
- `useRef` for DOM references and mutable values
- `useEffect` with explicit dependency arrays
- No custom hooks besides `useWorkspace()`

### CSS Theme

Two visual zones:
- **Editor area**: Warm tan/paper theme using CSS variables from `index.css`
- **Activity Bar**: Dark VSCode theme (`#252526`)
- **Side panels (Explorer, Search, Source Control)**: Warm theme using CSS variables
- **Terminal**: Dark (`#1e1e1e`)

Key CSS variables (defined in `src/index.css`):
```css
--bg-color: #ede8d0;        /* Warm tan */
--text-color: #3d3d3d;
--accent-color: #a67c52;    /* Terracotta */
--border-color: #d1cbb8;
--terminal-bg: #2b2a27;
```

Use CSS variables instead of hardcoded hex values for any warm-themed components.

### Error Handling
- Use `showToast(message, type)` for all user-facing errors
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

## Development

```bash
npm run dev          # Vite dev server (browser mode, needs Go server)
npm run start        # Vite + Electron concurrently
cd server && go run main.go  # Go backend server
```

## Key Files

- `src/App.jsx` - Root layout, keyboard shortcuts
- `src/context/WorkspaceContext.jsx` - All workspace state + file operations
- `src/components/Editor.jsx` - TipTap editor with comment system
- `src/components/FileExplorer.jsx` - File tree sidebar
- `src/components/Terminal.jsx` - xterm.js terminal
- `src/services/fileSystem.js` - Dual-runtime file system adapter
- `server/main.go` - Go HTTP/WebSocket server
- `electron/main.cjs` - Electron main process
- `electron/preload.cjs` - Electron preload (contextBridge)
