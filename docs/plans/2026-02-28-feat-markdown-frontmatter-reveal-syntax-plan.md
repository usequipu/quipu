---
title: "Notion-style Frontmatter Properties & Typora-style Reveal Raw Markdown"
type: feat
status: active
date: 2026-02-28
---

# Notion-style Frontmatter Properties & Typora-style Reveal Raw Markdown

## Overview

Two complementary editor UX improvements that make Quipu Simple's markdown editing experience richer and more intuitive:

- **Feature A**: A Notion-style collapsible properties panel for YAML frontmatter, rendered above the editor page
- **Feature B**: Typora-style cursor-aware reveal of raw markdown syntax — when the cursor enters any formatted element, the underlying markdown characters become visible

Both features are editor-only (frontend). No Go server or Electron IPC changes are needed.

## Problem Statement / Motivation

**Frontmatter**: Markdown files commonly include YAML frontmatter (`---` delimited blocks) for metadata (title, date, tags, etc.). Currently, `tiptap-markdown` uses `markdown-it` which parses `---` as `<hr>` elements, destroying frontmatter on load. Users working with Hugo, Jekyll, Obsidian, or any static site generator need frontmatter preserved and editable.

**Reveal syntax**: In a WYSIWYG markdown editor, users lose sight of the underlying syntax. Typora solved this elegantly — when your cursor enters a formatted element, the raw markdown is revealed (e.g., `**bold**` shows asterisks). This gives users confidence about what syntax is being used and makes the editor feel transparent rather than opaque.

## Proposed Solution

### Feature A: Frontmatter Properties View

**Approach: External to TipTap.** Strip frontmatter from the raw markdown _before_ passing content to `editor.commands.setContent()`. Parse the YAML with `js-yaml`. Store the parsed object in the tab's state. Render a collapsible React component above `<EditorContent>`. Re-serialize and prepend on save.

This approach is chosen over a custom TipTap node because:
- Frontmatter is metadata _about_ the document, not document content
- A React component gives full control over the Notion-style property UI
- Tab snapshots (`tiptapJSON`) naturally exclude frontmatter, so we add a dedicated `frontmatter` field to the tab object
- Simpler implementation — no `ReactNodeViewRenderer` needed for this feature

**Approach details:**

```
┌──────────────────────────────────────────────┐
│  ▼ Properties (3)              [collapse btn] │
│  ─────────────────────────────────────────── │
│  title     │  My Blog Post                   │
│  date      │  2026-02-28                     │
│  tags      │  [react] [editor] [+]           │
│  [+ Add property]                            │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│                                              │
│  Document content starts here...             │
│                                              │
└──────────────────────────────────────────────┘
```

### Feature B: Reveal Raw Markdown on Cursor

**Approach: ProseMirror decorations plugin.** Add a TipTap extension with `addProseMirrorPlugins()` that:
1. Tracks the cursor position via `state.selection`
2. Identifies which node/mark the cursor is inside
3. Adds inline decorations that inject the raw markdown syntax characters (e.g., `**` around bold text, `## ` before headings)
4. Removes decorations when the cursor leaves

This approach is chosen over custom NodeViews because:
- Decorations are lightweight — no React component per formatted node
- They don't replace TipTap's rendering, just augment it
- Better performance for large documents with many formatted elements
- The raw syntax is **read-only decoration** (not editable inline markdown) — this is dramatically simpler and avoids the complexity of full Typora-style inline editing

**Visual behavior:**

```
Normal state:          Cursor inside:
─────────────          ──────────────
My Heading             ## My Heading|

Some **bold** text     Some **bold**| text

`code` here            `code`| here

> quoted text          > quoted| text
```

The syntax characters appear in a muted style (e.g., `text-accent/50` in Tailwind terms) so they're visible but clearly decorative. Block-level elements (headings) retain their rendered size/style — the `##` prefix appears but the heading doesn't collapse to body text.

## Technical Considerations

### Architecture

- **No backend changes**: Both features are purely frontend. YAML parsing happens in the browser via `js-yaml`. No new Go endpoints or Electron IPC handlers needed.
- **First custom TipTap extension**: The reveal-syntax plugin will be the first use of `addProseMirrorPlugins()` in the codebase (the Comment mark only uses `addAttributes` and `addOptions`).
- **Tab state expansion**: The tab object in WorkspaceContext gains two new fields: `frontmatter` (parsed YAML object or null) and `frontmatterRaw` (original string, for round-trip fidelity).
- **No new custom hooks**: Per CLAUDE.md, no custom hooks beyond `useWorkspace()`. Frontmatter state management goes in WorkspaceContext.

### Styling: Tailwind v4 + shadcn/ui

The project has migrated to **Tailwind CSS v4** with a warm matte industrial theme and **shadcn/ui** (new-york style, JSX, no TypeScript). All new components should follow this approach:

- **Tailwind utility classes** for all layout, spacing, colors, typography
- **Theme tokens** defined in `src/styles/theme.css` via `@theme` directive (e.g., `bg-bg-surface`, `text-text-primary`, `border-border`, `text-accent`, `bg-page-bg`, `text-page-text`)
- **`cn()` utility** from `@/lib/utils` for conditional class composition
- **shadcn/ui components** for interactive elements (Collapsible, Input, Badge, Button) — installed via `npx shadcn@latest add <component>` into `src/components/ui/`
- **Phosphor icons** (`@phosphor-icons/react`) for all icons — weight switching for active/inactive states
- **No new `.css` files** for React components — all styling via Tailwind classes
- **Exception**: ProseMirror decoration elements are created via `document.createElement()` (DOM API), so they cannot use Tailwind utility classes inline. For these, we define thin `@layer components` classes in `src/styles/theme.css` using `@apply`.

**Reference implementation**: [ActivityBar.jsx](src/components/ActivityBar.jsx) demonstrates the full pattern (Tailwind classes + `cn()` + Phosphor icons + theme tokens).

### Performance

- **Frontmatter parsing**: `js-yaml` parses typical frontmatter (< 1KB) in < 1ms. No concern.
- **Decoration updates**: The reveal plugin recalculates decorations on every `selectionUpdate`. For a document with 500 formatted nodes, iterating to find the active node is O(n) but n is small (ProseMirror doc tree nodes at the cursor position, not all nodes). The plugin only needs to check the node/marks at `state.selection.$from`.
- **Debouncing**: Not needed — ProseMirror's decoration diffing is efficient. Only the entering/leaving nodes re-render.

### Security

- YAML parsing with `js-yaml` uses `safeLoad` (default) which prevents arbitrary code execution from malicious YAML.
- No user-supplied paths or shell commands involved — purely in-browser processing.

## System-Wide Impact

- **Interaction graph**: Opening a file → `openFile()` in WorkspaceContext now also strips/parses frontmatter → Editor receives content minus frontmatter → FrontmatterProperties component receives parsed YAML. Saving → `saveFile()` reads frontmatter from tab state, serializes YAML, prepends to `getMarkdown()` output.
- **Error propagation**: Malformed YAML → `js-yaml` throws → caught in `openFile()` → fallback: store raw frontmatter string, show toast warning, render raw text in properties section as readonly.
- **State lifecycle risks**: Frontmatter edits happen outside TipTap's undo history. Ctrl+Z won't undo frontmatter changes. This is a known V1 limitation. Tab switching preserves frontmatter via the expanded tab object.
- **API surface parity**: `saveFile()` is the only function that needs awareness of frontmatter. No other APIs expose file content.

## Acceptance Criteria

### Feature A: Frontmatter Properties

- [x] Opening a `.md` file with valid YAML frontmatter displays a properties panel above the editor page
- [x] Frontmatter `---` delimiters are NOT rendered as `<hr>` in the editor
- [x] Properties display as key-value fields matching the YAML structure
- [x] String, number, boolean (toggle), and flat array (tag chips) value types are supported
- [x] Nested objects display as readonly YAML text
- [x] Users can edit property values inline
- [x] Users can add new properties via an "Add property" button
- [x] Users can remove properties via a delete icon per row
- [x] The properties section can be collapsed/expanded via a toggle
- [x] Default state is expanded on first open
- [x] Collapsed/expanded state persists across tab switches
- [x] Editing a frontmatter property marks the tab as dirty (dot indicator)
- [x] Saving a file with frontmatter produces valid YAML between `---` delimiters prepended to the markdown body
- [x] Opening a file without frontmatter shows no properties section
- [x] Malformed YAML shows a toast warning and renders raw text as readonly in the properties area
- [x] Empty frontmatter (`---\n---`) shows the properties section with "No properties" and an "Add property" button
- [x] Tab switching preserves unsaved frontmatter edits
- [x] Files with frontmatter-only (no body) work correctly — properties show, editor is empty
- [x] `{ emitUpdate: false }` is used on all programmatic `setContent` calls (per existing pattern)
- [x] Properties section uses Tailwind utility classes with theme tokens (`bg-bg-surface`, `border-border`, `text-text-primary`, etc.)
- [x] Uses shadcn/ui `Collapsible` component for expand/collapse behavior
- [x] Uses shadcn/ui `Input` for property value editing
- [x] Uses shadcn/ui `Badge` for array/tag values
- [x] Uses shadcn/ui `Button` for add/remove actions
- [x] Uses `cn()` utility from `@/lib/utils` for conditional class composition
- [x] No separate `.css` file — all styling via Tailwind classes

### Feature B: Reveal Raw Markdown

- [x] Placing the cursor inside **bold** text reveals `**` markers around the text
- [x] Placing the cursor inside *italic* text reveals `*` markers
- [x] Placing the cursor inside a heading reveals `#`/`##`/`###` etc. prefix
- [x] Placing the cursor inside `inline code` reveals backtick markers
- [x] Placing the cursor inside a fenced code block reveals ` ``` ` delimiters
- [x] Placing the cursor inside a blockquote reveals `> ` prefix
- [x] Placing the cursor inside a link reveals `[text](url)` syntax
- [x] Placing the cursor inside a list item reveals `-` or `1.` prefix
- [ ] Placing the cursor on a horizontal rule reveals `---`
- [x] Placing the cursor inside strikethrough reveals `~~` markers
- [x] Moving the cursor out of a formatted element hides the raw syntax
- [x] Syntax markers are styled with muted accent color (Tailwind `text-accent/50` via CSS class on ProseMirror decoration elements)
- [x] Block-level elements (headings) retain their rendered size — only the prefix is added
- [x] The feature only activates for markdown files (`isMarkdown: true`), not `.quipu` or plain text files
- [x] Arrow key navigation through formatted content reveals/hides smoothly
- [x] No visible layout shift when headings gain/lose their `##` prefix
- [x] The feature coexists with the existing bubble menu (both can be active)
- [x] For nested formatting (bold inside heading), only the innermost mark reveals its syntax; the heading prefix always shows when cursor is anywhere inside the heading
- [x] Performance is acceptable with 100+ formatted elements in a document (no visible lag)

## Dependencies & Risks

### Dependencies

- **New npm dependency**: `js-yaml` (~30KB gzipped) for YAML parse/serialize
- **TipTap API stability**: Uses `addProseMirrorPlugins()` which is a stable TipTap API
- **ProseMirror decorations**: Core ProseMirror concept, well-documented and stable

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| YAML round-trip fidelity loss (comments stripped, key order changed) | High | Medium | Document as known V1 limitation; use `js-yaml`'s `dump()` with `sortKeys: false` |
| ProseMirror decorations approach doesn't work cleanly for all node types | Medium | High | Spike with bold + heading first before committing to all types |
| Layout shifts when heading prefix appears/disappears | Medium | Medium | Keep heading at rendered size, only add prefix as inline decoration |
| Frontmatter undo not integrated with TipTap undo | High | Low | Known V1 limitation; document and plan unified undo for V2 |
| `tiptap-markdown` serializer conflicts with decoration nodes | Low | High | Decorations don't modify the document model, only the view — should be safe |

## Implementation Phases

### Phase 1: Frontmatter Properties View

**Files to modify:**

| File | Changes |
|------|---------|
| `src/context/WorkspaceContext.jsx` | Add `frontmatter`, `frontmatterRaw`, `frontmatterCollapsed` to tab object. Modify `openFile()` to strip/parse frontmatter. Modify `saveFile()` to prepend YAML. Extend `snapshotTab()`. Add `updateFrontmatter()`, `addFrontmatterProperty()`, `removeFrontmatterProperty()`, `toggleFrontmatterCollapsed()` callbacks. |
| `src/components/Editor.jsx` | Strip frontmatter from content before `setContent()`. Pass `activeTab.frontmatter` and callbacks to new `FrontmatterProperties` component. Render `FrontmatterProperties` above `EditorContent`. |
| `src/components/FrontmatterProperties.jsx` | **New file.** Collapsible properties panel using shadcn/ui components (Collapsible, Input, Badge, Button) with Tailwind utility classes. No separate CSS file. |
| `src/components/ui/collapsible.jsx` | **New file (auto-generated).** shadcn/ui Collapsible component via `npx shadcn@latest add collapsible`. |
| `src/components/ui/input.jsx` | **New file (auto-generated).** shadcn/ui Input component via `npx shadcn@latest add input`. |
| `src/components/ui/badge.jsx` | **New file (auto-generated).** shadcn/ui Badge component via `npx shadcn@latest add badge`. |
| `src/components/ui/button.jsx` | **New file (auto-generated).** shadcn/ui Button component via `npx shadcn@latest add button`. |
| `package.json` | Add `js-yaml` dependency. shadcn/ui components auto-install their Radix UI peer deps. |

**Key implementation details:**

```javascript
// src/context/WorkspaceContext.jsx - frontmatter stripping
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const parseFrontmatter = (rawContent) => {
  const match = rawContent.match(FRONTMATTER_REGEX);
  if (!match) return { frontmatter: null, frontmatterRaw: null, body: rawContent };

  try {
    const parsed = jsYaml.load(match[1]);
    return {
      frontmatter: typeof parsed === 'object' && parsed !== null ? parsed : null,
      frontmatterRaw: match[1],
      body: rawContent.slice(match[0].length),
    };
  } catch (e) {
    showToast('Malformed YAML frontmatter', 'warning');
    return { frontmatter: null, frontmatterRaw: match[1], body: rawContent.slice(match[0].length) };
  }
};
```

```javascript
// src/context/WorkspaceContext.jsx - save with frontmatter
const saveFile = useCallback(async (editorInstance) => {
  const tab = openTabs.find(t => t.id === activeTabId);
  let content;

  if (tab.isQuipu) {
    content = JSON.stringify({ type: "quipu", version: 1, content: editorInstance.getJSON() });
  } else if (tab.isMarkdown) {
    const markdown = editorInstance.storage.markdown.getMarkdown();
    if (tab.frontmatter || tab.frontmatterRaw) {
      const yaml = tab.frontmatter
        ? jsYaml.dump(tab.frontmatter, { sortKeys: false, lineWidth: -1 })
        : tab.frontmatterRaw;
      content = `---\n${yaml}---\n\n${markdown}`;
    } else {
      content = markdown;
    }
  } else {
    content = editorInstance.getText();
  }

  await fs.writeFile(tab.path, content);
  // ... mark clean, update tab
}, [openTabs, activeTabId]);
```

```jsx
// src/components/FrontmatterProperties.jsx - component structure
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CaretRight, CaretDown, X, Plus } from '@phosphor-icons/react';

const FrontmatterProperties = ({
  frontmatter,
  frontmatterRaw,
  isCollapsed,
  onUpdate,
  onAdd,
  onRemove,
  onToggleCollapse
}) => {
  const count = Object.keys(frontmatter || {}).length;

  // Malformed YAML fallback
  if (frontmatterRaw && !frontmatter) {
    return (
      <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse()}>
        <CollapsibleTrigger
          className="flex items-center gap-2 w-full px-4 py-2 text-sm font-mono
                     text-page-text/70 bg-page-bg border-b border-page-border
                     hover:bg-page-bg/80 cursor-pointer"
        >
          {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
          <span>Properties (malformed YAML)</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="px-4 py-3 text-xs font-mono text-error bg-error/5
                          border-b border-page-border whitespace-pre-wrap">
            {frontmatterRaw}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Normal properties view
  return (
    <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse()}>
      <CollapsibleTrigger
        className="flex items-center gap-2 w-full px-4 py-2 text-sm font-mono
                   text-page-text/70 bg-page-bg border-b border-page-border
                   hover:bg-page-bg/80 cursor-pointer"
      >
        {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
        <span>Properties ({count})</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 py-3 space-y-2 bg-page-bg border-b border-page-border">
          {Object.entries(frontmatter || {}).map(([key, value]) => (
            <FrontmatterField
              key={key}
              fieldKey={key}
              value={value}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs font-mono text-accent hover:text-accent-hover"
            onClick={onAdd}
          >
            <Plus size={12} className="mr-1" />
            Add property
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

// Individual property field with type-aware rendering
const FrontmatterField = ({ fieldKey, value, onUpdate, onRemove }) => {
  const isArray = Array.isArray(value);
  const isBoolean = typeof value === 'boolean';
  const isObject = typeof value === 'object' && value !== null && !isArray;

  return (
    <div className="flex items-start gap-3 group">
      {/* Key */}
      <span className="w-28 shrink-0 text-xs font-mono text-page-text/50 pt-1.5 truncate">
        {fieldKey}
      </span>

      {/* Value */}
      <div className="flex-1 min-w-0">
        {isArray ? (
          <div className="flex flex-wrap gap-1">
            {value.map((item, i) => (
              <Badge key={i} variant="secondary" className="text-xs font-mono">
                {String(item)}
              </Badge>
            ))}
          </div>
        ) : isBoolean ? (
          <button
            className={cn(
              "w-8 h-4 rounded-full transition-colors",
              value ? "bg-accent" : "bg-border"
            )}
            onClick={() => onUpdate(fieldKey, !value)}
          />
        ) : isObject ? (
          <pre className="text-xs font-mono text-page-text/60 whitespace-pre-wrap">
            {JSON.stringify(value, null, 2)}
          </pre>
        ) : (
          <Input
            value={String(value ?? '')}
            onChange={(e) => onUpdate(fieldKey, e.target.value)}
            className="h-7 text-sm font-mono bg-transparent border-transparent
                       hover:border-page-border focus:border-accent"
          />
        )}
      </div>

      {/* Remove button */}
      <button
        className="opacity-0 group-hover:opacity-100 p-1 text-page-text/30
                   hover:text-error transition-opacity"
        onClick={() => onRemove(fieldKey)}
      >
        <X size={12} />
      </button>
    </div>
  );
};
```

### Phase 2: Reveal Raw Markdown Extension

**Files to modify:**

| File | Changes |
|------|---------|
| `src/extensions/RevealMarkdown.js` | **New file.** TipTap extension with ProseMirror plugin that adds decorations for the active node/marks. |
| `src/components/Editor.jsx` | Import and register `RevealMarkdown` extension in the `useEditor` config. Only register for markdown files. |
| `src/styles/theme.css` | Add `.reveal-syntax` styles using Tailwind `@apply` in a `@layer components` block. ProseMirror decorations are created via DOM API (`document.createElement`), so they cannot use Tailwind utility classes directly — we define a small set of component classes. |

**Key implementation details:**

```javascript
// src/extensions/RevealMarkdown.js
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const revealMarkdownKey = new PluginKey('revealMarkdown');

// Map of mark/node types to their markdown syntax
const MARK_SYNTAX = {
  bold:          { open: '**', close: '**' },
  italic:        { open: '*',  close: '*' },
  strike:        { open: '~~', close: '~~' },
  code:          { open: '`',  close: '`' },
};

const BLOCK_PREFIX = {
  heading: (node) => '#'.repeat(node.attrs.level) + ' ',
  blockquote: () => '> ',
  bulletList: () => null, // handled at listItem level
  orderedList: () => null,
  listItem: (node, parent) => parent?.type.name === 'orderedList' ? '1. ' : '- ',
  horizontalRule: () => '---',
};

export const RevealMarkdown = Extension.create({
  name: 'revealMarkdown',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: revealMarkdownKey,
        props: {
          decorations(state) {
            const { $from } = state.selection;
            const decorations = [];

            // Block-level prefix for the current node
            const parentNode = $from.parent;
            const grandparent = $from.node($from.depth - 1);
            const prefixFn = BLOCK_PREFIX[parentNode.type.name];

            if (prefixFn) {
              const prefix = prefixFn(parentNode, grandparent);
              if (prefix) {
                const startPos = $from.before($from.depth);
                decorations.push(
                  Decoration.widget(startPos + 1, () => {
                    const span = document.createElement('span');
                    span.className = 'reveal-syntax reveal-prefix';
                    span.textContent = prefix;
                    span.contentEditable = 'false';
                    return span;
                  }, { side: -1 })
                );
              }
            }

            // Inline mark decorations for marks at cursor position
            const marks = $from.marks();
            for (const mark of marks) {
              const syntax = MARK_SYNTAX[mark.type.name];
              if (!syntax) continue;

              // Find the extent of this mark around the cursor
              const markRange = getMarkRange($from, mark.type);
              if (!markRange) continue;

              decorations.push(
                Decoration.widget(markRange.from, () => {
                  const span = document.createElement('span');
                  span.className = 'reveal-syntax reveal-open';
                  span.textContent = syntax.open;
                  span.contentEditable = 'false';
                  return span;
                }, { side: -1 }),
                Decoration.widget(markRange.to, () => {
                  const span = document.createElement('span');
                  span.className = 'reveal-syntax reveal-close';
                  span.textContent = syntax.close;
                  span.contentEditable = 'false';
                  return span;
                }, { side: 1 })
              );
            }

            // Link syntax (special case — shows [text](url))
            const linkMark = marks.find(m => m.type.name === 'link');
            if (linkMark) {
              const markRange = getMarkRange($from, linkMark.type);
              if (markRange) {
                decorations.push(
                  Decoration.widget(markRange.from, () => {
                    const span = document.createElement('span');
                    span.className = 'reveal-syntax reveal-open';
                    span.textContent = '[';
                    span.contentEditable = 'false';
                    return span;
                  }, { side: -1 }),
                  Decoration.widget(markRange.to, () => {
                    const span = document.createElement('span');
                    span.className = 'reveal-syntax reveal-close';
                    span.textContent = `](${linkMark.attrs.href})`;
                    span.contentEditable = 'false';
                    return span;
                  }, { side: 1 })
                );
              }
            }

            // Code block fences
            if (parentNode.type.name === 'codeBlock') {
              const startPos = $from.before($from.depth);
              const endPos = $from.after($from.depth);
              const lang = parentNode.attrs.language || '';

              decorations.push(
                Decoration.widget(startPos + 1, () => {
                  const span = document.createElement('div');
                  span.className = 'reveal-syntax reveal-fence';
                  span.textContent = '```' + lang;
                  span.contentEditable = 'false';
                  return span;
                }, { side: -1 }),
                Decoration.widget(endPos - 1, () => {
                  const span = document.createElement('div');
                  span.className = 'reveal-syntax reveal-fence';
                  span.textContent = '```';
                  span.contentEditable = 'false';
                  return span;
                }, { side: 1 })
              );
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

// Helper: find the range of a mark around a resolved position
function getMarkRange($pos, markType) {
  const { parent, parentOffset } = $pos;
  let start = parentOffset, end = parentOffset;

  // Walk backward to find mark start
  while (start > 0 && markType.isInSet(parent.child(parent.childBefore(start).index).marks)) {
    start--;
  }
  // Walk forward to find mark end
  while (end < parent.content.size && markType.isInSet(parent.child(parent.childAfter(end).index).marks)) {
    end++;
  }

  const from = $pos.start() + start;
  const to = $pos.start() + end;
  return from < to ? { from, to } : null;
}
```

```css
/* src/styles/theme.css - reveal syntax component classes
   ProseMirror decorations use DOM API, so Tailwind utilities can't be applied
   directly. These are thin component classes using @apply. */
@layer components {
  .reveal-syntax {
    @apply text-accent/50 font-mono text-[0.85em] select-none pointer-events-none;
  }

  .reveal-prefix {
    @apply mr-0.5;
  }

  .reveal-fence {
    @apply block my-1 text-[0.8em];
  }
}
```

### Phase 3: Polish & Integration

- Test frontmatter round-trip with real-world files (Hugo, Jekyll, Obsidian)
- Verify reveal decorations work with all StarterKit node/mark types
- Ensure both features coexist with the existing comment system and bubble menu
- Test tab switching preserves both frontmatter state and decoration behavior
- Verify `{ emitUpdate: false }` is used correctly to prevent false dirty states
- Performance test with a 1000-line markdown document with heavy formatting

## Alternative Approaches Considered

### Feature A: Frontmatter as Custom TipTap Node

Could create a `Frontmatter` node type rendered via `ReactNodeViewRenderer` that sits at position 0 in the document. This keeps frontmatter in the TipTap document model, so `getJSON()` snapshots include it automatically.

**Rejected because:** Adds complexity to the TipTap document schema. The tiptap-markdown serializer would need custom serialize/parse rules. The Notion-style property UI is better as a standalone React component with full control over layout and interaction, not constrained by ProseMirror's rendering model.

### Feature B: Custom NodeViews for All Node Types

Replace TipTap's rendering of headings, bold, italic, code, etc. with React components that detect cursor position and toggle between rendered and raw views.

**Rejected because:** This would require ~12 custom NodeView components (one per node/mark type), replacing TipTap's built-in rendering. Massive implementation effort, ongoing maintenance burden as TipTap updates, and performance concerns from wrapping every formatted element in a React component. ProseMirror decorations achieve the same visual result with a fraction of the code and complexity.

### Feature B: CSS-only Approach

Use CSS `::before`/`::after` pseudo-elements with `content` to show syntax characters, toggled by a class that is added/removed based on cursor position.

**Rejected because:** CSS cannot easily know the heading level (to show the right number of `#` characters) or the link URL. Would require data attributes on every formatted element, which conflicts with how TipTap renders content. ProseMirror decorations are the right abstraction level for this.

## Success Metrics

- Markdown files with frontmatter open correctly (no `<hr>` elements from `---`)
- Frontmatter round-trip: open → save without editing body → file diff shows zero body changes
- Properties panel renders within 50ms of file open
- Reveal decorations update within 16ms of cursor movement (single frame)
- No regressions in existing editor functionality (save, tabs, comments, bubble menu)

## Sources & References

### Internal References

- [Editor.jsx](src/components/Editor.jsx) — TipTap editor setup, content loading (lines 24-165), bubble menu (lines 88-107)
- [WorkspaceContext.jsx](src/context/WorkspaceContext.jsx) — Tab state model (line 133), saveFile (lines 194-221), snapshotTab (lines 97-102)
- [Editor.css](src/components/Editor.css) — Editor page styling, bubble menu styles
- [theme.css](src/styles/theme.css) — Tailwind v4 `@theme` tokens (bg-bg-surface, text-text-primary, accent, page-bg, etc.)
- [utils.js](src/lib/utils.js) — `cn()` utility for conditional Tailwind class composition
- [components.json](components.json) — shadcn/ui config (new-york style, JSX, no TypeScript)
- [ActivityBar.jsx](src/components/ActivityBar.jsx) — Reference implementation of Tailwind + `cn()` + Phosphor icons pattern
- [Design System Plan](docs/plans/2026-02-28-feat-design-system-shadcn-phosphor-plan.md) — Full Tailwind/shadcn migration plan and token reference
- Solution: [false-dirty-state-on-file-open.md](docs/solutions/ui-bugs/false-dirty-state-on-file-open.md) — `{ emitUpdate: false }` pattern
- Solution: [editor-overhaul-tabs-search-git.md](docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md) — Markdown round-trip architecture

### External References

- [TipTap Node Views with React](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react) — ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent
- [ProseMirror Decorations Guide](https://prosemirror.net/docs/guide/#view.decorations) — Decoration types, DecorationSet
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML parser/serializer for JavaScript
- [tiptap-markdown](https://github.com/aguingand/tiptap-markdown) — Markdown extension used in the codebase

### Design Inspiration

- **Notion**: Collapsible page properties with typed fields (text, date, select, multi-select)
- **Typora**: WYSIWYG markdown editor that reveals raw syntax at cursor position
- **Obsidian**: Frontmatter properties panel (similar to Notion but simpler)
