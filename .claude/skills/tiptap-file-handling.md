---
name: tiptap-file-handling
description: Pattern for loading and saving files through TipTap editor with correct format handling
triggers:
  - file save logic
  - file load logic
  - tiptap content
  - markdown serialization
  - quipu format
---

# TipTap File Handling Pattern

Use this skill when working with file loading/saving through the TipTap editor.

## File Format Matrix

| Extension | Load Strategy | Save Strategy | Content Type |
|---|---|---|---|
| `.quipu` | `editor.commands.setContent(parsedJSON.content)` | `JSON.stringify({ type: "quipu", version: 1, content: editor.getJSON() })` | TipTap JSON |
| `.md`, `.markdown` | `editor.commands.setContent(rawText)` (tiptap-markdown parses) | `editor.storage.markdown.getMarkdown()` | Markdown text |
| Everything else | Split into paragraph nodes | `editor.getText()` | Plain text |

## Load Path (Editor.jsx)

```jsx
useEffect(() => {
    if (!editor || !activeFile) return;
    if (loadedFileRef.current === activeFile.path) return;
    loadedFileRef.current = activeFile.path;

    if (activeFile.isQuipu && typeof activeFile.content === 'object') {
        editor.commands.setContent(activeFile.content);
    } else {
        const text = typeof activeFile.content === 'string' ? activeFile.content : '';
        const isMarkdown = activeFile.name.endsWith('.md') || activeFile.name.endsWith('.markdown');

        if (isMarkdown) {
            // tiptap-markdown handles parsing directly
            editor.commands.setContent(text);
        } else {
            // Plain text -> paragraph nodes
            const paragraphs = text.split('\n').map(line => ({
                type: 'paragraph',
                content: line ? [{ type: 'text', text: line }] : [],
            }));
            editor.commands.setContent({
                type: 'doc',
                content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
            });
        }
    }
}, [editor, activeFile]);
```

## Save Path (WorkspaceContext.jsx)

```jsx
const saveFile = useCallback(async (editorInstance) => {
    if (!activeFile || !editorInstance) return;

    let content;
    if (activeFile.isQuipu || activeFile.name.endsWith('.quipu')) {
        content = JSON.stringify({
            type: 'quipu',
            version: 1,
            content: editorInstance.getJSON(),
            metadata: { savedAt: new Date().toISOString() },
        }, null, 2);
    } else if (activeFile.name.endsWith('.md') || activeFile.name.endsWith('.markdown')) {
        content = editorInstance.storage.markdown.getMarkdown();
    } else {
        content = editorInstance.getText();
    }

    try {
        await fs.writeFile(activeFile.path, content);
        setIsDirty(false);
    } catch (err) {
        showToast(`Failed to save ${activeFile.name}: ${err.message}`, 'error');
    }
}, [activeFile]);
```

## TipTap Extensions Required

```jsx
import { Markdown } from 'tiptap-markdown';

const editor = useEditor({
    extensions: [
        StarterKit,
        Placeholder.configure({ placeholder: 'Start writing...' }),
        Markdown.configure({
            html: false,
            tightLists: true,
            bulletListMarker: '-',
            transformPastedText: true,
            transformCopiedText: true,
        }),
        // Comment mark (extends Highlight) - stripped in markdown output
    ],
});
```

## Custom Comment Mark

The comment mark extends Highlight. In markdown output, comments are stripped (they are editor-only annotations):

```jsx
addStorage() {
    return {
        markdown: {
            serialize: { open: '', close: '' },
            parse: { /* no-op */ }
        }
    };
},
```

## Known Limitations

- TipTap StarterKit does not include tables or task list nodes. Markdown with these features will lose them on load.
- Comments on `.md` files are ephemeral - they exist only while the file is open and are stripped on save.
- Undo/redo history resets when loading new content via `setContent()`.
