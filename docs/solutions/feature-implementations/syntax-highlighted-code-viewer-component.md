---
title: "Add Syntax-Highlighted Code Viewer for Code Files"
date: 2026-03-01
category: feature-implementation
tags:
  - code-highlighting
  - syntax-highlighting
  - file-viewer
  - highlight.js
  - react-component
  - conditional-rendering
  - file-type-detection
components:
  - src/components/CodeViewer.jsx
  - src/utils/fileTypes.js
  - src/App.jsx
  - src/styles/prosemirror.css
symptoms:
  - All code files (.js, .json, .py, .go, etc.) opened in TipTap editor as plain text
  - No syntax highlighting for code files
  - Suboptimal viewing experience for code vs editable documents
root_cause: App did not distinguish between editable documents (.md, .quipu) and code files, routing all file types through TipTap with no specialized viewer.
solution_summary: Implemented conditional file viewer selection using a centralized file type utility, routing code files to a new highlight.js-powered CodeViewer component while preserving TipTap for markdown and quipu formats.
related_files:
  - src/components/CodeViewer.jsx
  - src/utils/fileTypes.js
  - src/App.jsx
  - src/styles/prosemirror.css
  - package.json
---

# Syntax-Highlighted Code Viewer Component

## Problem

All files opened in the TipTap editor displayed as plain text with no syntax highlighting. Code files (JavaScript, Python, Go, etc.) appeared without any visual distinction of language tokens, operators, or structure, making them difficult to read within the application.

## Root Cause

The application lacked:
1. File type detection logic to distinguish code files from editable documents
2. A dedicated code viewer component with syntax highlighting
3. Conditional rendering logic to route different file types to appropriate viewers

All files defaulted to the TipTap rich text editor regardless of extension or content type.

## Solution

### Step 1: Install dependency

```bash
npm install highlight.js
```

Uses `highlight.js/lib/core` (not the full bundle) with only required languages registered explicitly, keeping bundle size minimal.

### Step 2: File type detection utility — `src/utils/fileTypes.js`

Centralized registry for file type classification. Single source of truth used by both `App.jsx` routing and `CodeViewer.jsx` language detection.

```javascript
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less',
  '.html', '.xml', '.py', '.go', '.rs', '.java', '.c', '.cpp',
  '.h', '.hpp', '.sh', '.bash', '.zsh', '.yaml', '.yml', '.toml',
  '.sql', '.rb', '.php', '.swift', '.kt', '.lua', '.r',
  '.dockerfile', '.makefile', '.gitignore', '.env', '.cjs', '.mjs',
]);

const EXT_TO_LANG = {
  '.js': 'javascript', '.jsx': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.json': 'json', '.css': 'css',
  '.html': 'xml', '.xml': 'xml', '.svg': 'xml',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini',
  '.sql': 'sql', '.rb': 'ruby', '.php': 'php',
};

export function isCodeFile(fileName) {
  return CODE_EXTENSIONS.has(getFileExtension(fileName));
}

export function getLanguage(fileName) {
  return EXT_TO_LANG[getFileExtension(fileName)] || null;
}

export function getViewerType(tab) {
  if (!tab) return null;
  if (tab.isDiff) return 'diff';
  if (tab.isMedia) return 'media';
  if (tab.isQuipu) return 'editor';
  if (tab.name.endsWith('.md') || tab.name.endsWith('.markdown')) return 'editor';
  if (isCodeFile(tab.name)) return 'code';
  if (isMediaFile(tab.name)) return 'media';
  return 'editor';
}
```

### Step 3: CodeViewer component — `src/components/CodeViewer.jsx`

Registers 16 languages at module load. Uses `useMemo` to avoid re-highlighting on unrelated renders. Mirrors the Editor's 816px page-centered layout with responsive breakpoints for visual consistency.

```jsx
import hljs from 'highlight.js/lib/core';
// ... language imports ...
import { getLanguage } from '@/utils/fileTypes';

// Register languages once at module load
hljs.registerLanguage('javascript', javascript);
// ... 15 more languages ...

const CodeViewer = ({ content, fileName }) => {
  const language = getLanguage(fileName);

  const highlighted = useMemo(() => {
    if (!content) return '';
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value;
    }
    return hljs.highlightAuto(content).value; // fallback for unknown types
  }, [content, language]);

  const lineCount = useMemo(() => (content || '').split('\n').length, [content]);

  return (
    <div className="flex-1 flex justify-center items-start overflow-y-auto py-8 px-16 ...">
      <div className="w-[816px] bg-page-bg rounded border border-page-border ...">
        <div className="flex overflow-x-auto">
          {/* Line numbers column */}
          <div className="shrink-0 py-4 pr-2 pl-4 text-right select-none">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="font-mono text-xs leading-6 text-text-tertiary opacity-50">
                {i + 1}
              </div>
            ))}
          </div>
          {/* Code column */}
          <pre className="flex-1 py-4 pr-4 pl-2 font-mono text-sm leading-6 m-0 bg-transparent">
            <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
          </pre>
        </div>
      </div>
    </div>
  );
};
```

### Step 4: Conditional rendering in `src/App.jsx`

```jsx
import CodeViewer from './components/CodeViewer';
import { isCodeFile } from './utils/fileTypes';

// In render:
{activeFile ? (
  isCodeFile(activeFile.name) && !activeFile.isQuipu ? (
    <CodeViewer content={activeFile.content} fileName={activeFile.name} />
  ) : (
    <Editor ... />
  )
) : (
  <div>...empty state...</div>
)}
```

The condition `isCodeFile(activeFile.name) && !activeFile.isQuipu` ensures `.quipu` files always use the Editor even if their extension would otherwise match.

### Step 5: CSS theme import — `src/styles/prosemirror.css`

```css
@import 'highlight.js/styles/github.css';

/* ProseMirror / TipTap editor styles */
```

Added as the first line so highlight.js token classes (`.hljs-string`, `.hljs-keyword`, etc.) are available globally without Tailwind interference.

## Key Design Decisions

**highlight.js core, not full bundle** — The full highlight.js (~90KB) includes 200+ languages. Core imports only 16 registered languages, reducing bundle size significantly. Add new languages by importing from `highlight.js/lib/languages/` and calling `hljs.registerLanguage()`.

**Component mirrors Editor layout** — CodeViewer uses the same 816px container, responsive breakpoints (`max-[1400px]:`, `max-[1200px]:`, `max-[1150px]:`), and theme tokens (`bg-page-bg`, `border-page-border`) as the Editor. Consistent visual presentation between viewing and editing modes.

**`.md` and `.quipu` always use Editor** — Markdown files need frontmatter editing and formatting features. Quipu files need rich text capabilities. The `!activeFile.isQuipu` guard in App.jsx is a belt-and-suspenders check on top of the `getViewerType()` logic in fileTypes.js.

**`dangerouslySetInnerHTML` is safe here** — highlight.js output is generated internally from file content; it is not user-supplied HTML. No sanitization needed for this use case.

## Prevention / Best Practices

### Adding a new language

1. Add extension to `CODE_EXTENSIONS` in `src/utils/fileTypes.js`
2. Add `'.ext': 'languageName'` entry to `EXT_TO_LANG`
3. Import language module in `CodeViewer.jsx`: `import lang from 'highlight.js/lib/languages/lang'`
4. Register: `hljs.registerLanguage('lang', lang)`

The language name in `EXT_TO_LANG` must match the name passed to `hljs.registerLanguage()` exactly.

### Never inline extension checks

Always use `isCodeFile()` and `getLanguage()` from `fileTypes.js`. Never hardcode `.endsWith('.js')` checks in components — this creates inconsistency when you forget to update all locations.

## Potential Issues

| Issue | Risk | Prevention |
|-------|------|-----------|
| Language registration mismatch | File renders with wrong highlighting | Keep EXT_TO_LANG and registerLanguage() names in sync |
| Bundle size growth | Adding many languages increases JS bundle | Only register commonly needed languages; lazy-load rare ones |
| Theme CSS import order | Breaking dark/tinted theme highlighting | Keep `@import 'highlight.js/styles/github.css'` as first line in prosemirror.css |
| Large file performance | Files >10MB can freeze UI during highlighting | Add file size check; disable highlighting above threshold |
| Horizontal scroll misalignment | Long lines misalign line numbers | Both containers use `overflow-x: auto`; maintain this on layout changes |

## Future Enhancements

1. **Extensionless file detection** — Check shebang (`#!/bin/bash`) or filename patterns (Dockerfile, Makefile) for language detection without extension
2. **Copy-to-clipboard button** — Floating button in top-right corner using `navigator.clipboard.writeText(content)`
3. **Syntax theme customization** — Dynamically import highlight.js CSS theme based on app's light/dark/tinted setting

## Related Documentation

- `docs/solutions/feature-implementations/inline-git-diff-viewer-source-control.md` — Diff viewer with syntax highlighting via `@git-diff-view/react`
- `docs/solutions/ui-bugs/search-highlight-sigmoid-fade-animation.md` — Search result highlighting with CSS animations
- `docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md` — Editor mode toggle (richtext vs markdown)
- `docs/plans/2026-03-01-feat-code-viewer-plan.md` — Original implementation plan
