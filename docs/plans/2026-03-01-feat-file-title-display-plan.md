# Plan: File Title Display (No Extension, Bigger Than h1)

## Context
When a file is open, there's no prominent title. The file name should be displayed at the top of the page content, without the file extension, styled bigger than h1.

## Files to Modify
- `src/components/Editor.jsx`

## Implementation

### Editor.jsx - Add Title

1. Compute display title by stripping extension:
```jsx
import { useMemo } from 'react';

// Inside the Editor component:
const displayTitle = useMemo(() => {
  if (!activeFile?.name) return '';
  const name = activeFile.name;
  // Remove .md, .markdown, .quipu extensions
  return name.replace(/\.(md|markdown|quipu)$/i, '');
}, [activeFile?.name]);
```

2. Render title inside the page div, BEFORE the frontmatter section:
```jsx
<div className="w-[816px] ...page div..." ref={pageRef}>
  {displayTitle && (
    <h1 className="text-5xl font-bold text-page-text mb-6 font-editor leading-tight tracking-tight select-none">
      {displayTitle}
    </h1>
  )}
  {/* existing frontmatter block */}
  {activeTab && (activeTab.frontmatter || activeTab.frontmatterRaw) && (
    ...
  )}
  {/* editor content */}
</div>
```

### Styling Details
- `text-5xl` = 3rem (48px), bigger than ProseMirror h1 at 2em (~36px)
- `font-editor` = Clash Grotesk (the editor display font)
- `font-bold` for weight 700
- `tracking-tight` for slightly tighter letter spacing
- `select-none` since it's read-only display, not editable

## Verification
- Open a `.md` file like `README.md` - title should show "README"
- Open a `.quipu` file - title shows name without .quipu
- Title should be visibly larger than h1 headings in the document
