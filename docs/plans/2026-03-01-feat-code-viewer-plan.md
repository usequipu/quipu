# Plan: Code Viewer for JSON and Code Files

## Context
All files currently load into TipTap as plain text paragraphs with no syntax highlighting. Code files (JSON, JS, CSS, Python, etc.) should use a dedicated syntax-highlighted viewer instead of TipTap.

## Dependencies
```bash
npm install highlight.js
```

## Files to Create
- `src/utils/fileTypes.js` - File type detection utility
- `src/components/CodeViewer.jsx` - Syntax-highlighted code viewer

## Files to Modify
- `src/App.jsx` - Conditional rendering based on file type

## Implementation

### src/utils/fileTypes.js

```jsx
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less',
  '.html', '.xml', '.py', '.go', '.rs', '.java', '.c', '.cpp',
  '.h', '.hpp', '.sh', '.bash', '.zsh', '.yaml', '.yml', '.toml',
  '.sql', '.rb', '.php', '.swift', '.kt', '.lua', '.r',
  '.dockerfile', '.makefile', '.gitignore', '.env', '.cjs', '.mjs',
]);

const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.mp4', '.webm', '.ogg', '.mov',
]);

const EXT_TO_LANG = {
  '.js': 'javascript', '.jsx': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.json': 'json', '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'xml', '.xml': 'xml', '.svg': 'xml',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini',
  '.sql': 'sql', '.rb': 'ruby', '.php': 'php',
};

export function getFileExtension(fileName) {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.substring(lastDot).toLowerCase() : '';
}

export function isCodeFile(fileName) {
  return CODE_EXTENSIONS.has(getFileExtension(fileName));
}

export function isMediaFile(fileName) {
  return MEDIA_EXTENSIONS.has(getFileExtension(fileName));
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

### src/components/CodeViewer.jsx

```jsx
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import { getLanguage } from '@/utils/fileTypes';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('python', python);
hljs.registerLanguage('go', go);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('java', java);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);

const CodeViewer = ({ content, fileName }) => {
  const language = getLanguage(fileName);

  const highlighted = useMemo(() => {
    if (!content) return '';
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value;
    }
    return hljs.highlightAuto(content).value;
  }, [content, language]);

  const lineCount = useMemo(() => {
    return (content || '').split('\n').length;
  }, [content]);

  return (
    <div className={cn(
      "flex-1 flex justify-center items-start overflow-y-auto relative",
      "py-8 px-16",
      "max-[1400px]:justify-start max-[1400px]:pl-12",
      "max-[1200px]:overflow-x-auto max-[1200px]:p-8",
      "max-[1150px]:py-6 max-[1150px]:px-4",
    )}>
      <div className={cn(
        "w-[816px] min-h-[400px] bg-page-bg rounded border border-page-border",
        "shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.06)]",
        "relative shrink-0 overflow-hidden",
        "max-[1150px]:w-full max-[1150px]:max-w-[816px]",
      )}>
        <div className="flex overflow-x-auto">
          <div className="shrink-0 py-4 pr-2 pl-4 text-right select-none">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="font-mono text-xs leading-6 text-text-tertiary opacity-50">
                {i + 1}
              </div>
            ))}
          </div>
          <pre className="flex-1 py-4 pr-4 pl-2 font-mono text-sm leading-6 overflow-x-auto m-0 bg-transparent">
            <code
              className="hljs"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </pre>
        </div>
      </div>
    </div>
  );
};

export default CodeViewer;
```

### src/App.jsx Changes

Add imports:
```jsx
import CodeViewer from './components/CodeViewer';
import { isCodeFile } from './utils/fileTypes';
```

Replace the conditional rendering section:
```jsx
{activeFile ? (
  isCodeFile(activeFile.name) && !activeFile.isQuipu ? (
    <CodeViewer content={activeFile.content} fileName={activeFile.name} />
  ) : (
    <Editor ... />
  )
) : (
  ...empty state...
)}
```

### CSS - Add highlight.js theme support

In `src/styles/prosemirror.css` (or create a new import), add minimal highlight.js styles that use existing theme tokens. Or import a built-in theme:
```css
@import 'highlight.js/styles/github.css';
```

For dark mode, conditionally apply dark styles via CSS nesting or a separate import.

## Verification
- Open a `.json` file - should show syntax-highlighted JSON with line numbers
- Open a `.js` or `.jsx` file - syntax-highlighted JavaScript
- Open a `.py`, `.go`, `.css` file - correct language highlighting
- Open a `.md` file - should still use TipTap editor (not code viewer)
- Open a `.quipu` file - should still use TipTap editor
