---
name: design-system
description: Quipu design system reference — color tokens, typography, icons, and component patterns using Tailwind v4 + shadcn/ui + Phosphor Icons
triggers:
  - styling a component
  - choosing colors or theme tokens
  - adding icons to UI
  - writing Tailwind classes
  - using shadcn/ui components
  - design system reference
---

# Quipu Design System: Warm Matte Industrial

Visual identity inspired by Claude (warm palette), Teenage Engineering (industrial monospace), and Phosphor Icons (flexible weights).

## Color Tokens

All colors are defined as Tailwind `@theme` tokens in `src/styles/theme.css`. Use Tailwind utility classes, never hardcoded hex values.

### Backgrounds

| Token | Tailwind Class | Value | Use For |
|---|---|---|---|
| `bg-base` | `bg-bg-base` | `#1c1a17` | App base, terminal |
| `bg-surface` | `bg-bg-surface` | `#252220` | Panels, cards |
| `bg-elevated` | `bg-bg-elevated` | `#2e2a27` | Hover states, raised elements |
| `bg-overlay` | `bg-bg-overlay` | `#37322e` | Dropdowns, modals, popovers |
| `page-bg` | `bg-page-bg` | `#f5f0e6` | Editor page (warm cream paper) |

### Text

| Token | Tailwind Class | Value | Use For |
|---|---|---|---|
| `text-primary` | `text-text-primary` | `#e8e0d4` | Main body text |
| `text-secondary` | `text-text-secondary` | `#a89e90` | Labels, descriptions |
| `text-tertiary` | `text-text-tertiary` | `#6b6259` | Disabled, placeholders |

### Accent (Terracotta)

| Token | Tailwind Class | Value | Use For |
|---|---|---|---|
| `accent` | `text-accent` / `bg-accent` | `#c4835a` | Buttons, links, active indicators |
| `accent-hover` | `hover:bg-accent-hover` | `#d4956a` | Hover states |
| `accent-muted` | `bg-accent-muted` | `#8b6347` | Subtle backgrounds |

### Borders

| Token | Tailwind Class | Value | Use For |
|---|---|---|---|
| `border` | `border-border` | `#3a352f` | Default borders |
| `border-focus` | `ring-border-focus` | `#c4835a` | Focus rings (same as accent) |

### Editor Page (Light Zone)

The editor content area stays warm cream — the only light zone in the app.

| Token | Tailwind Class | Value |
|---|---|---|
| `page-bg` | `bg-page-bg` | `#f5f0e6` |
| `page-text` | `text-page-text` | `#2c2825` |
| `page-border` | `border-page-border` | `#d4ccb8` |

### Semantic Colors

| Token | Tailwind Class | Value | Use For |
|---|---|---|---|
| `success` | `text-success` | `#7ab87a` | Success toasts, git added |
| `warning` | `text-warning` | `#d4a84a` | Warning toasts, git modified |
| `error` | `text-error` | `#c75050` | Error toasts, git deleted |
| `info` | `text-info` | `#6b9eca` | Info toasts, git renamed |

## Typography

### Font Stack

```
--font-mono: 'JetBrains Mono', 'Fira Code', monospace   /* UI chrome + code */
--font-sans: 'Inter', system-ui, sans-serif               /* Editor content */
```

### Scale

| Element | Classes | Example |
|---|---|---|
| Section headers | `font-mono text-[11px] uppercase tracking-wider text-text-secondary` | `EXPLORER`, `SEARCH` |
| Tab names | `font-mono text-xs text-text-primary` | File names in tabs |
| Sidebar items | `font-mono text-[13px] text-text-primary` | File tree entries |
| Buttons | `font-mono text-xs` | Action buttons |
| Editor content | `font-sans text-lg leading-relaxed` | Document text |
| Code/terminal | `font-mono text-sm` | Terminal, code blocks |

### TE-Inspired Rules

- Section headers: **always uppercase**, `tracking-wider` (letter-spacing 0.08em)
- No bold in UI chrome — use opacity and color for hierarchy
- Tight sizes for chrome (11-13px), generous for editor (18px)

## Phosphor Icons

Import from `@phosphor-icons/react`. The app wraps in `<IconContext.Provider>` with defaults: `color="currentColor"`, `weight="regular"`, `size={16}`.

### Weight & Size Standards

| Context | Weight | Size | Example |
|---|---|---|---|
| Activity bar | `light` | 24 | `<Files weight="light" size={24} />` |
| Activity bar (active) | `regular` | 24 | `<Files weight="regular" size={24} />` |
| Panel actions | `regular` | 16 | `<Plus size={16} />` |
| Inline/small | `regular` | 14 | `<X size={14} />`, `<CaretRight size={14} />` |
| File types | `regular` | 16 | `<File size={16} />`, `<Folder size={16} />` |
| Status dots | `fill` | 8-12 | `<Circle weight="fill" size={8} />` |

### Common Icon Map

```jsx
// Navigation & actions
import { Files, MagnifyingGlass, GitBranch } from "@phosphor-icons/react"  // Activity bar
import { X, Plus, Check, ArrowsClockwise } from "@phosphor-icons/react"    // Actions
import { CaretRight, CaretDown, List } from "@phosphor-icons/react"         // Expand/collapse
import { Circle, Warning } from "@phosphor-icons/react"                     // Status

// File types
import { File, FileJs, FileCss, FileHtml, FileCode } from "@phosphor-icons/react"
import { Folder, FolderOpen, Article, Notebook } from "@phosphor-icons/react"
```

### Icon Color Rule

**Never set `color` prop on icons directly.** Let icons inherit `currentColor` from the parent element. Control color via Tailwind text color on the parent:

```jsx
// Good
<button className="text-text-secondary hover:text-text-primary">
  <Files weight="light" size={24} />
</button>

// Bad
<Files color="#a89e90" size={24} />
```

## Class Composition with `cn()`

Use `cn()` from `src/lib/utils.js` for conditional classes:

```jsx
import { cn } from '@/lib/utils'

<button className={cn(
  "font-mono text-xs px-3 py-1.5 rounded",
  "bg-bg-surface text-text-primary",
  "hover:bg-bg-elevated",
  isActive && "bg-accent text-white"
)}>
```

## shadcn/ui Components

Components live in `src/components/ui/`. Import and use:

```jsx
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
```

### Button Variants

```jsx
<Button variant="default">Primary</Button>     {/* accent bg */}
<Button variant="outline">Secondary</Button>    {/* border, transparent bg */}
<Button variant="ghost">Subtle</Button>         {/* no border, hover bg */}
<Button variant="destructive">Delete</Button>   {/* error color */}
<Button size="sm">Small</Button>                {/* Sidebar/panel buttons */}
<Button size="icon">                            {/* Icon-only buttons */}
  <Plus size={16} />
</Button>
```

## When to Use Plain CSS

Not everything goes through Tailwind. Keep plain CSS for:

| What | Why | File |
|---|---|---|
| ProseMirror/TipTap styles | Can't add classes to generated DOM | `src/styles/prosemirror.css` |
| xterm.js terminal | External library CSS | xterm's own CSS import |
| Complex `calc()` layouts | Editor A4 page positioning | Kept in component CSS |
| Animations (`@keyframes`) | Cleaner in CSS | Component CSS or `src/styles/` |

## Error Handling

No change from existing pattern:

```jsx
try {
    await someOperation();
    showToast('Operation succeeded', 'success');
} catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
}
```
