---
name: add-component
description: Step-by-step guide for adding new UI components to Quipu using the design system (Tailwind v4 + shadcn/ui + Phosphor Icons)
triggers:
  - creating new component
  - adding UI panel or view
  - building new React component
  - adding a new feature panel
---

# Add a Quipu Component

Use this when creating new React components for Quipu. This replaces the old `quipu-component` skill with design-system-aware patterns.

## File Structure

```
src/components/
  ComponentName.jsx          # Component file
  ui/                        # shadcn/ui primitives (don't edit directly)
    button.jsx
    input.jsx
    ...
```

No separate `.css` file needed — use Tailwind utility classes. Only create a CSS file if you need ProseMirror overrides, complex `calc()` layouts, or `@keyframes` animations.

## Component Template

```jsx
// src/components/ComponentName.jsx
import { useState, useCallback } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { cn } from '@/lib/utils';

// Import only the Phosphor icons you need (tree-shaken)
import { SomeIcon } from '@phosphor-icons/react';

// Import shadcn/ui primitives as needed
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function ComponentName() {
    const { /* destructure only what you need */ } = useWorkspace();

    const handleAction = useCallback(() => {
        // handler logic
    }, [/* deps */]);

    return (
        <div className="flex flex-col h-full bg-bg-surface text-text-primary">
            {/* Section header — TE-inspired uppercase mono */}
            <div className="px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary">
                SECTION NAME
            </div>

            {/* Scrollable content */}
            <ScrollArea className="flex-1">
                {/* content */}
            </ScrollArea>
        </div>
    );
}
```

## Step-by-Step

### 1. Create the component file

`src/components/ComponentName.jsx` — functional component, named function declaration.

### 2. Choose your background layer

| Where it lives | Background class |
|---|---|
| Side panel (Explorer, Search, Source Control) | `bg-bg-surface` |
| Overlay/modal/dropdown | `bg-bg-overlay` |
| Hover state of items | `bg-bg-elevated` |
| Editor page area | `bg-page-bg` |

### 3. Add icons with Phosphor

```jsx
import { Files, MagnifyingGlass, X, CaretRight } from '@phosphor-icons/react';

// Activity bar size
<Files weight="light" size={24} />

// Panel action buttons
<Button variant="ghost" size="icon">
    <MagnifyingGlass size={16} />
</Button>

// Inline small (close, expand)
<X size={14} />
<CaretRight size={14} />
```

**Never set `color` prop on icons.** Use parent's `text-*` class:

```jsx
<button className="text-text-secondary hover:text-text-primary">
    <Files weight="light" size={24} />
</button>
```

### 4. Use shadcn/ui primitives for interactive elements

```jsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Buttons
<Button variant="ghost" size="sm">Action</Button>
<Button variant="default">Primary</Button>
<Button variant="destructive" size="sm">Delete</Button>

// Inputs
<Input placeholder="Search..." className="bg-bg-elevated border-border" />

// Tooltips (wrap interactive icon buttons)
<TooltipProvider>
    <Tooltip>
        <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
                <Plus size={16} />
            </Button>
        </TooltipTrigger>
        <TooltipContent>New File</TooltipContent>
    </Tooltip>
</TooltipProvider>
```

### 5. Use `cn()` for conditional classes

```jsx
import { cn } from '@/lib/utils';

<div className={cn(
    "flex items-center px-2 py-1 font-mono text-[13px] cursor-pointer",
    "hover:bg-bg-elevated",
    isActive && "bg-bg-elevated text-text-primary",
    !isActive && "text-text-secondary"
)}>
```

### 6. Style list items (file tree, search results, git changes)

```jsx
<div
    className={cn(
        "flex items-center gap-2 px-3 py-0.5 font-mono text-[13px] cursor-pointer",
        "hover:bg-bg-elevated transition-colors",
        isSelected && "bg-bg-elevated"
    )}
    style={{ paddingLeft: `${12 + depth * 16}px` }}
>
    <CaretRight
        size={14}
        className={cn("transition-transform", isExpanded && "rotate-90")}
    />
    <Folder size={16} />
    <span className="truncate">{name}</span>
</div>
```

### 7. Section headers (TE-inspired)

```jsx
<div className="flex items-center justify-between px-3 py-2">
    <span className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">
        SECTION NAME
    </span>
    <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-5 w-5">
            <Plus size={14} />
        </Button>
    </div>
</div>
```

## Rules

### JavaScript
- **Functional components only** — no class components
- **useCallback** for all event handlers
- **useRef** for DOM references and mutable values
- **useEffect** with explicit dependency arrays
- Named function declaration: `export default function ComponentName()`
- Handler naming: `handleClick`, `handleSubmit`, `handleContextMenu`
- Boolean state naming: `isExpanded`, `isDirty`, `isLoading`

### Styling
- **Tailwind utility classes** for all styling
- **`cn()`** for conditional class composition
- **No hardcoded hex values** — use design tokens (`bg-bg-surface`, `text-accent`, etc.)
- **No separate CSS file** unless needed for ProseMirror, xterm, calc(), or keyframes
- **font-mono** for all UI chrome text
- **font-sans** only for editor document content

### Accessibility
- Add `role` attributes for interactive containers (`tablist`, `toolbar`, `tree`, `menu`)
- Add `aria-label` on icon-only buttons
- Add `aria-selected` on selectable items
- Use shadcn/ui primitives (they handle ARIA automatically)
- Phosphor icons: use `alt` prop for meaningful icons: `<Files alt="File explorer" />`

### Electron Compatibility
- For draggable title bar areas: add `style={{ WebkitAppRegionDrag: 'drag' }}`
- For interactive elements in drag regions: `style={{ WebkitAppRegionDrag: 'no-drag' }}`

## Error Handling

```jsx
try {
    await someOperation();
    showToast('Operation succeeded', 'success');
} catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
}
```

Never use `console.error` for user-facing failures. Always surface via `showToast()`.
