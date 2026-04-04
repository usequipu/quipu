# Extension Contract

Quipu uses a registry-based extension system for file viewers. Each extension handles one or more file types and lives in its own folder under `src/extensions/<name>/`.

## Directory Structure

```
src/extensions/
  registry.js              # registerExtension(), resolveViewer()
  index.js                 # imports and registers all built-in extensions

  pdf-viewer/
    index.js               # extension descriptor (the contract)
    PdfViewer.jsx           # React component

  notebook/
    index.js
    NotebookViewer.jsx
    NotebookCell.jsx
    CellOutput.jsx
```

## Extension Descriptor

Every extension folder must have an `index.js` that default-exports a descriptor object:

```js
import MyViewer from './MyViewer.jsx';

export default {
  id: 'my-viewer',
  canHandle(tab, activeFile) { return tab?.isPdf; },
  priority: 10,
  component: MyViewer,
};
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Unique identifier for the extension |
| `canHandle` | `(tab, activeFile) => boolean` | yes | Return `true` if this extension should render the tab |
| `priority` | `number` | yes | Higher wins when multiple extensions match. Editor fallback = 0, standard viewers = 10 |
| `component` | `React.ComponentType` | yes | The React component to render |

### Priority Levels

- **0** — Editor (default TipTap fallback, not an extension)
- **5** — Broad matchers (e.g., CodeViewer matches many file types)
- **10** — Standard viewers (PDF, media, notebook, excalidraw, mermaid)
- **100** — Override viewers (e.g., DiffViewer when a diff is active)

## Standard Props

Every viewer component receives the same prop bag:

```js
{
  tab,              // Full tab object (path, name, content, isDirty, scrollPosition, ...)
  activeFile,       // Derived object: { path, name, content, isQuipu }
  onContentChange,  // (newContent: string) => void — call when content is modified
  isActive,         // boolean — whether this tab is currently visible
}
```

Use what you need, ignore the rest.

## Dependency Rules

- Extensions **CAN** import from core: `useWorkspace()`, `useToast()`, services (`fileSystem`, `kernelService`), utilities (`fileTypes`, `cn`)
- Core **CANNOT** import from `src/extensions/<name>/` — only from `src/extensions/registry.js`
- Extensions **SHOULD NOT** import from other extensions

## Adding a New Extension

1. Create `src/extensions/<name>/index.js` with the descriptor
2. Create your viewer component in the same folder
3. Import and register in `src/extensions/index.js`:
   ```js
   import myViewer from './<name>';
   registerExtension(myViewer);
   ```

No changes to `App.jsx` or core code required.

## TipTap Editor Extensions

The flat files in `src/extensions/` (`BlockDragHandle.js`, `FindReplace.js`, `RevealMarkdown.js`, `WikiLink.js`, `CodeBlockWithLang.jsx`) are **TipTap node/mark/plugin extensions**. They extend the rich text editor schema, not the file viewer system. They do not use the registry and follow TipTap's own extension API.
