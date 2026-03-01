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
- **Tailwind CSS v4** for all styling — no co-located CSS files per component
- **shadcn/ui** primitives in `src/components/ui/` (Button, Input, Badge, Collapsible)
- **Phosphor Icons** via `@phosphor-icons/react` — use `Icon` suffix naming (e.g., `FilesIcon`, `XIcon`)
- **`cn()` utility** from `@/lib/utils` for conditional class composition (clsx + tailwind-merge)
- **Path alias** `@/` maps to `./src` in vite.config.js

### Naming
- Component files: PascalCase (`Editor.jsx`, `FileExplorer.jsx`)
- Service/context files: camelCase (`fileSystem.js`, `WorkspaceContext.jsx`)
- Handlers: `handle` prefix (`handleClick`, `handleContextMenu`)
- Booleans: `is` prefix (`isDirty`, `isExpanded`)

### Hooks
- `useCallback` for all event handlers and context operations
- `useRef` for DOM references and mutable values
- `useEffect` with explicit dependency arrays
- No custom hooks besides `useWorkspace()`

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

Key patterns used throughout:
- `group` + `group-hover:` for parent-hover child-visibility (close buttons, file actions)
- `cn()` for conditional styling: `cn("base-classes", isActive && "active-classes")`
- Arbitrary values for responsive: `max-[1400px]:`, `max-[1200px]:`
- `after:` pseudo-elements for resize handles
- `white/[0.06]` opacity for hover states on dark backgrounds

Remaining CSS files (not in Tailwind):
- `src/index.css` — Google Fonts import, global scrollbar, body/root base styles
- `src/styles/theme.css` — Tailwind v4 `@theme` tokens, custom keyframe animations
- `src/styles/prosemirror.css` — TipTap/ProseMirror DOM styles (can't be controlled via Tailwind)

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
- `src/components/TitleBar.jsx` - Window title bar with MenuBar and window controls
- `src/components/FrontmatterProperties.jsx` - YAML frontmatter editor (uses shadcn/ui)
- `src/styles/theme.css` - Tailwind v4 theme tokens and custom animations
- `src/styles/prosemirror.css` - TipTap/ProseMirror editor styles
- `src/lib/utils.js` - `cn()` utility (clsx + tailwind-merge)
- `src/services/fileSystem.js` - Dual-runtime file system adapter
- `server/main.go` - Go HTTP/WebSocket server
- `electron/main.cjs` - Electron main process
- `electron/preload.cjs` - Electron preload (contextBridge)
