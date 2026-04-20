---
name: plugin-extension
description: How to build, test, and release a Quipu plugin (viewer extension or sidebar panel)
triggers:
  - creating a new plugin
  - updating an existing plugin
  - releasing a plugin version
  - pdf-plugin, code-plugin, media-plugin, mermaid-plugin, excalidraw-plugin, notebook-plugin
---

# Plugin Extension Pattern

Use this skill when building or updating a Quipu plugin. Plugins are independently distributed ESM bundles that register viewer components, sidebar panels, or commands via the `init(api)` entry point.

## Repo Layout

Plugin sources live in `quipu-plugin-repos/` (sibling to `quipu_simple`):

```
quipu-plugin-repos/
  pdf-plugin/          # github.com/usequipu/pdf-plugin
  code-plugin/
  media-plugin/
  ...
  registry/            # github.com/usequipu/registry — plugins.json index
```

Each plugin repo has:
```
src/
  index.tsx       # exports init(api: PluginApi): void
  PdfViewer.tsx   # the React component (or whatever the viewer is called)
  plugin-types.ts # copy of src/types/plugin-types.d.ts from quipu_simple
manifest.json
vite.config.ts
package.json
```

## Plugin API Surface

```typescript
export function init(api: PluginApi): void {
  // Register a file viewer
  api.register({
    id: 'my-plugin',
    canHandle: (tab) => tab.name.endsWith('.xyz'),
    priority: 10,           // higher wins; built-in editor = 0
    component: MyViewer,    // React component receiving ViewerProps
  });

  // Register a sidebar panel
  api.registerPanel({
    id: 'my-panel',
    label: 'My Panel',
    icon: 'StarIcon',       // Phosphor icon name
    component: MyPanel,
    order: 100,
  });

  // Register a command palette entry
  api.commands.register('my-plugin.doThing', handler, {
    label: 'Do the thing',
    category: 'My Plugin',
  });
}
```

## ViewerProps

Every registered component receives these props from the host:

```typescript
interface ViewerProps {
  tab: Tab;                // the open tab (tab.path, tab.name, tab.isPdf, etc.)
  workspacePath: string;  // absolute path of open workspace
  showToast: (msg: string, type: 'error'|'warning'|'success'|'info') => void;
  onContentChange: (content: string) => void;
  isActive: boolean;
  activeFile: ActiveFile | null;
}
```

## Accessing Host Services

`api.services` exposes file system and git:

```typescript
const fs = api.services.fileSystem;

// Read / write files
const content = await fs.readFile('/abs/path/to/file');
await fs.writeFile('/abs/path/to/file', 'content');
await fs.createFolder('/abs/path/to/dir');

// Get a URL safe for <img src>, fetch(), etc.
const url = fs.getFileUrl('/abs/path/file.pdf'); // returns quipu-file:// in Electron
```

Capture `api.services.fileSystem` in the `init` closure and pass it to your component — do NOT import services directly from the host app (they are not available in the plugin bundle).

## Frame Annotations (Read/Write Sidecar Files)

Plugins that want to store per-file annotations use `.quipu/meta/<relativePath>.frame.json`. Implement this inline using `api.services.fileSystem`:

```typescript
function getFramePath(workspacePath: string, filePath: string) {
  const rel = filePath.startsWith(workspacePath + '/')
    ? filePath.slice(workspacePath.length + 1)
    : filePath;
  return `${workspacePath}/.quipu/meta/${rel}.frame.json`;
}
```

See `pdf-plugin/src/PdfViewer.tsx` → `makeFrameService()` for the full pattern.

## React / ReactDOM

Plugins MUST NOT bundle their own React. Externalize both in `vite.config.ts` and use the shared instance from the host:

```typescript
// vite.config.ts
rollupOptions: {
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
}
```

The host injects proxy blob URLs that forward all hooks to the single host React instance, preventing "Invalid hook call" errors.

## CSS in Plugin Bundles

Vite extracts CSS to a separate file by default — but the plugin loader only loads `index.js`. Inject CSS inline using a Rollup plugin in `vite.config.ts`:

```typescript
{
  name: 'css-inject',
  apply: 'build',
  enforce: 'post',
  generateBundle(_opts, bundle) {
    const cssChunks = Object.values(bundle).filter(
      (c) => c.type === 'asset' && c.fileName.endsWith('.css'),
    );
    const jsEntry = Object.values(bundle).find(
      (c) => c.type === 'chunk' && c.isEntry,
    );
    if (!cssChunks.length || !jsEntry) return;
    const css = cssChunks.map((c) => String(c.source)).join('\n');
    jsEntry.code =
      `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();\n` +
      jsEntry.code;
    for (const c of cssChunks) delete bundle[c.fileName];
  },
},
```

## Releasing a Plugin

1. **Edit source** in `quipu-plugin-repos/<plugin-name>/src/`
2. **Bump version** in `quipu-plugin-repos/<plugin-name>/manifest.json`
3. **Commit, tag, push**:
   ```bash
   cd quipu-plugin-repos/<plugin-name>
   git add -A
   git commit -m "feat: v0.X.Y — description"
   git tag v0.X.Y
   git push origin main --tags
   ```
   The GitHub Actions CI builds and attaches `plugin.zip` (containing `index.js` + `manifest.json`) to the release automatically.

4. **Update the registry** at `quipu-plugin-repos/registry/plugins.json`:
   - Bump `version`
   - Update `downloadUrl` to `https://github.com/usequipu/<plugin>/releases/download/v0.X.Y/plugin.zip`
   - Update `description` and `sizeHint` if needed
   ```bash
   cd quipu-plugin-repos/registry
   git add plugins.json
   git commit -m "chore: bump <plugin> to v0.X.Y"
   git push origin main
   ```

5. **Install locally for testing** (without waiting for CI):
   - Build locally: `npm run build:<plugin>` (if a build script exists in `quipu_simple/package.json`)
   - Copy output to `~/.quipu/plugins/<plugin-name>/index.js`
   - Restart Quipu

## Local Build Script (quipu_simple)

For plugins with a build script registered in `quipu_simple/package.json`:

```bash
npm run build:pdf-plugin   # builds → dist-plugins/pdf-plugin/index.js
cp dist-plugins/pdf-plugin/index.js ~/.quipu/plugins/pdf-plugin/index.js
```

The build config lives at `plugins/<plugin-name>/vite.config.ts`.

## Manifest Schema

```json
{
  "id": "my-plugin",
  "name": "Human Name",
  "version": "0.2.0",
  "description": "One sentence description.",
  "entry": "index.js",
  "quipuVersion": ">=0.14.0",
  "fileTypes": [".xyz"]
}
```

- `id` must match `^[a-z0-9][a-z0-9-]{0,63}$`
- `quipuVersion` is a semver range checked against `VITE_APP_VERSION` at load time
- `fileTypes` is informational (used by Plugin Manager UI); actual routing is in `canHandle()`
