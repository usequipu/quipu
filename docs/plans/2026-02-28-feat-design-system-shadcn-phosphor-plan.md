---
title: "feat: Design System with shadcn/ui, Tailwind v4 & Phosphor Icons"
type: feat
status: completed
date: 2026-02-28
origin: docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md
---

# Design System: shadcn/ui + Tailwind CSS v4 + Phosphor Icons

## Overview

Full visual redesign of Quipu Simple establishing a proper design system. Replace the current plain CSS + hand-drawn CSS icons with:

- **Tailwind CSS v4** via `@tailwindcss/vite` for utility-first styling
- **shadcn/ui** (configured for plain JS) for accessible, composable UI primitives
- **@phosphor-icons/react** for a consistent, flexible icon system
- **Custom theme** inspired by Claude (warm matte) + Teenage Engineering (industrial/utilitarian) + Phosphor Icons

The aesthetic: **warm matte industrial** -- a dark mode with warm undertones, monospaced UI chrome, and the intentional, product-design feel of Teenage Engineering's interfaces.

## Problem Statement / Motivation

The current visual layer has served well as a prototype but has structural problems:

1. **No icon system** -- All icons are CSS pseudo-elements (`::before`/`::after`), limiting to crude geometric shapes
2. **No component library** -- Every interactive element (buttons, inputs, dropdowns, modals) is custom-built with inconsistent patterns
3. **Hardcoded colors everywhere** -- 30+ hardcoded hex values across 9 CSS files, not all using the CSS variable system
4. **Two competing themes poorly defined** -- The warm/dark split works but has no clear design language
5. **No accessibility primitives** -- Missing keyboard navigation, focus management, ARIA patterns
6. **Scaling pain** -- Adding new panels (Search, Source Control) means writing hundreds of lines of custom CSS each time

A proper design system fixes all of this while giving the app a distinctive, hip visual identity.

## Proposed Solution

### Design Language: "Warm Matte Industrial"

Three reference points, blended:

| Reference | What we take from it |
|---|---|
| **Claude** | Warm color palette (tans, terracottas, cream), approachable feeling, generous whitespace |
| **Teenage Engineering** | Monospace UI chrome, utilitarian labels, matte finishes, no glossy effects, functional beauty |
| **Phosphor Icons** | Consistent icon weights, multiple styles for state (regular/fill/duotone), clean stroke design |

### Color Palette

**Warm Matte Dark** -- the primary theme. Dark base with warm brown undertones instead of cool gray.

```
@theme {
  /* Background layers (warmest dark to coolest surface) */
  --color-bg-base:     #1c1a17;    /* Deepest background - warm near-black */
  --color-bg-surface:  #252220;    /* Card/panel surfaces */
  --color-bg-elevated: #2e2a27;    /* Elevated elements, hover states */
  --color-bg-overlay:  #37322e;    /* Dropdowns, popovers, modals */

  /* Text */
  --color-text-primary:   #e8e0d4;  /* Primary text - warm off-white */
  --color-text-secondary: #a89e90;  /* Secondary/muted text */
  --color-text-tertiary:  #6b6259;  /* Disabled, placeholders */

  /* Accent - terracotta/clay */
  --color-accent:       #c4835a;    /* Primary accent */
  --color-accent-hover: #d4956a;    /* Accent hover */
  --color-accent-muted: #8b6347;    /* Subtle accent backgrounds */

  /* Borders */
  --color-border:       #3a352f;    /* Default borders */
  --color-border-focus: #c4835a;    /* Focus rings */

  /* Editor page (the paper zone - stays warm light) */
  --color-page-bg:     #f5f0e6;    /* Warm cream paper */
  --color-page-text:   #2c2825;    /* Near-black warm text */
  --color-page-border: #d4ccb8;    /* Paper edge */

  /* Semantic */
  --color-success:  #7ab87a;   /* Muted green */
  --color-warning:  #d4a84a;   /* Warm amber */
  --color-error:    #c75050;   /* Soft red */
  --color-info:     #6b9eca;   /* Muted blue */

  /* Git status (standard semantic, slightly muted) */
  --color-git-modified:  #c4935a;
  --color-git-added:     #7ab87a;
  --color-git-deleted:   #c75050;
  --color-git-renamed:   #6b9eca;
  --color-git-untracked: #6b6259;
}
```

### Typography

| Zone | Font | Purpose |
|---|---|---|
| **UI chrome** (tabs, sidebar labels, status) | `JetBrains Mono` | Industrial/utilitarian feel, TE-inspired |
| **UI labels** (buttons, menus) | `JetBrains Mono` at 11-12px | Tight, monospace, uppercase for section headers |
| **Editor content** | `Inter` | Comfortable reading for document editing |
| **Code/terminal** | `JetBrains Mono` / `Fira Code` | Standard code monospace |

**Key TE-inspired choices:**
- Section headers (`EXPLORER`, `SEARCH`, `SOURCE CONTROL`) in uppercase monospace, letter-spacing `0.08em`
- Small, tight font sizes for chrome (11-12px) contrasted with generous editor font (18px)
- No bold in UI chrome -- use opacity and color to create hierarchy instead

### Phosphor Icon Standard

| Context | Weight | Size | Examples |
|---|---|---|---|
| Activity bar | `light` | 24px | `Files`, `MagnifyingGlass`, `GitBranch` |
| Activity bar (active) | `regular` | 24px | Same icons, heavier weight for selected state |
| Panel actions | `regular` | 16px | `Plus`, `ArrowsClockwise`, `Check` |
| Inline/small | `regular` | 14px | `X` (close), `CaretRight` (expand), `CaretDown` (collapse) |
| File types | `regular` | 16px | `File`, `FileJs`, `FileCss`, `Folder`, `FolderOpen` |
| Status indicators | `fill` | 12px | `Circle` (dirty dot), `Warning` |

**Icon color:** Inherits `currentColor` from parent. Never hardcode icon colors directly -- control via parent element's text color class.

### Component Architecture

#### shadcn/ui Components to Adopt

Start with these primitives (lowest risk, highest value):

| Component | Replaces | Why |
|---|---|---|
| **Button** | Custom `.save-btn`, `.send-btn`, `.sc-commit-button` | Consistent variants (default, outline, ghost), proper focus states |
| **Input** | Custom search inputs, rename inputs | Consistent sizing, focus rings, disabled states |
| **Textarea** | Custom commit message textarea | Same as Input |
| **ScrollArea** | Custom webkit scrollbar CSS | Cross-browser, accessible, themed |
| **Tooltip** | None (missing feature) | Activity bar labels, button descriptions |
| **ContextMenu** | Custom context menu in FileExplorer | Proper keyboard nav, accessibility |
| **Dialog** | Custom FolderPicker, confirm dialogs | Focus trapping, accessible overlay |
| **DropdownMenu** | Custom branch dropdown | Keyboard nav, proper positioning |

**NOT adopting initially** (keep custom, migrate styles to Tailwind):
- Toast -- keep custom `showToast()` API, it's documented in CLAUDE.md
- Command/QuickOpen -- keep custom, the current implementation works
- Tabs -- the TabBar is too integrated with WorkspaceContext to swap

#### File Structure

```
src/
  components/
    ui/                    # shadcn/ui generated components (plain JS)
      button.jsx
      input.jsx
      textarea.jsx
      scroll-area.jsx
      tooltip.jsx
      context-menu.jsx
      dialog.jsx
      dropdown-menu.jsx
    ActivityBar.jsx        # Existing components, migrated
    ActivityBar.css        # Gradually replaced/emptied
    ...
  lib/
    utils.js               # cn() utility (clsx + tailwind-merge)
  styles/
    theme.css              # @theme tokens, imported by main CSS
    prosemirror.css         # TipTap/ProseMirror overrides (stays as plain CSS)
    xterm-overrides.css     # Terminal container styles (stays as plain CSS)
```

## Technical Approach

### Phase 0: Infrastructure (No Visual Changes)

Install dependencies and configure the toolchain. The app should look **identical** after this phase.

#### 0a. Install Tailwind CSS v4

```bash
npm install tailwindcss @tailwindcss/vite
```

`vite.config.js`:
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
})
```

Create `src/styles/theme.css`:
```css
@import "tailwindcss" layer(utilities);
/* Disable Preflight (base layer) to avoid breaking existing styles */
/* We'll enable it after full migration */

@theme {
  /* All color tokens from the palette above */
  /* All font tokens */
  /* Spacing, radius, shadow tokens */
}
```

Import in `src/main.jsx` **before** `index.css` so existing styles win:
```javascript
import './styles/theme.css'
import './index.css'
```

**Critical: Disable Preflight.** Tailwind v4's Preflight (CSS reset) will break ProseMirror editor styling, button appearances, and form elements. By importing only the utilities layer, existing styles remain intact. Preflight is re-enabled in the final cleanup phase after all components are migrated.

#### 0b. Install shadcn/ui

```bash
npx shadcn@latest init
```

Configure `components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": false,
  "tailwind": {
    "config": "",
    "css": "src/styles/theme.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "none",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib"
  }
}
```

Create `src/lib/utils.js`:
```javascript
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
```

```bash
npm install tailwind-merge
# clsx already in package.json
```

#### 0c. Install Phosphor Icons

```bash
npm install @phosphor-icons/react
```

#### 0d. Add path aliases

Update `vite.config.js` to support `@/` imports:
```javascript
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

**Verification:** Run `npm run dev` and `npm run start` -- app should look identical with no console errors.

### Phase 1: Icon Migration (Visual Change, No Layout Change)

Replace all CSS pseudo-element icons with Phosphor components. This is the lowest-risk visual change.

#### Icon Mapping Table

| Current | Location | Phosphor Replacement |
|---|---|---|
| `.activity-icon-files` (CSS rectangles) | `ActivityBar.jsx` | `<Files weight="light" size={24} />` |
| `.activity-icon-search` (CSS circle+line) | `ActivityBar.jsx` | `<MagnifyingGlass weight="light" size={24} />` |
| `.activity-icon-git` (CSS line+dot) | `ActivityBar.jsx` | `<GitBranch weight="light" size={24} />` |
| `.dir-arrow` (CSS triangle) | `FileExplorer.jsx` | `<CaretRight size={14} />` / `<CaretDown size={14} />` |
| `.file-icon-file` (CSS page shape) | `FileExplorer.jsx` | `<File size={16} />` |
| `.file-icon-quipu` (text "Q") | `FileExplorer.jsx` | `<Notebook size={16} />` or keep "Q" |
| `\u2630` (hamburger) | `App.jsx:202` | `<List size={18} />` |
| `&times;` (tab close) | `TabBar.jsx:33` | `<X size={14} />` |
| `&#128269;` (search emoji) | `SearchPanel.jsx:120` | `<MagnifyingGlass size={16} />` |
| `.sc-toggle-arrow` (CSS triangle) | `SourceControlPanel.jsx` | `<CaretRight size={14} />` / `<CaretDown size={14} />` |
| `✕` (resolve comment) | `Editor.jsx:410` | `<X size={14} />` |

#### File-type icons (bonus, if Phosphor has them)

| Extension | Phosphor Icon |
|---|---|
| `.js`, `.jsx` | `<FileJs size={16} />` |
| `.css` | `<FileCss size={16} />` |
| `.html` | `<FileHtml size={16} />` |
| `.json` | `<FileCode size={16} />` (generic code) |
| `.md` | `<Article size={16} />` |
| `.go` | `<FileCode size={16} />` |
| folder (closed) | `<Folder size={16} />` |
| folder (open) | `<FolderOpen size={16} />` |

#### Global Icon Context

Wrap the app in `IconContext.Provider` in `App.jsx`:
```jsx
import { IconContext } from "@phosphor-icons/react";

// In the render:
<IconContext.Provider value={{ color: "currentColor", weight: "regular", size: 16 }}>
  {/* ... app content ... */}
</IconContext.Provider>
```

**Delete after migration:** All CSS icon rules in `ActivityBar.css` (lines 42-117), `FileExplorer.css` (lines 148-177), `SourceControlPanel.css` (lines 356-367).

### Phase 2: Theme Token Migration

Convert existing CSS variables to the new Tailwind `@theme` palette. Update `src/styles/theme.css` with the full warm matte industrial palette.

#### Mapping: Old Variables to New Tokens

| Old CSS Variable | New Tailwind Token | Value Change |
|---|---|---|
| `--bg-color: #ede8d0` | `--color-bg-base: #1c1a17` | Going dark |
| `--text-color: #3d3d3d` | `--color-text-primary: #e8e0d4` | Light text on dark |
| `--accent-color: #a67c52` | `--color-accent: #c4835a` | Slightly brighter terracotta |
| `--accent-hover: #8c6642` | `--color-accent-hover: #d4956a` | Lighter on hover (dark bg) |
| `--border-color: #d1cbb8` | `--color-border: #3a352f` | Dark warm border |
| `--page-bg: #ffffff` | `--color-page-bg: #f5f0e6` | Warm cream instead of pure white |
| `--terminal-bg: #2b2a27` | `--color-bg-base` (same zone now) | Terminal blends with base |
| `--sidebar-dark-bg: #252526` | `--color-bg-surface: #252220` | Warmer dark |
| `--sidebar-dark-text: #cccccc` | `--color-text-primary: #e8e0d4` | Warmer off-white |

#### Hardcoded Colors to Map

These hardcoded hex values across component CSS files must be replaced:

- `FileExplorer.css`: `#0e639c` -> `--color-accent`, `#8a7e6b` -> `--color-text-secondary`, `#3c3c3c` -> `--color-bg-overlay`
- `Editor.css`: `#0969da` -> `--color-accent`, `#24292f` -> `--color-bg-overlay`, `#57606a` -> `--color-text-secondary`
- `SourceControlPanel.css`: Git status colors -> `--color-git-*` tokens
- `Toast.css`: Status colors -> `--color-success/warning/error/info`
- `FolderPicker.css`: All hardcoded dark colors -> new token equivalents

### Phase 3: Component-by-Component Migration

Migrate in this order (smallest/most isolated first):

#### 3a. ActivityBar

- Replace CSS icon spans with Phosphor components (done in Phase 1)
- Replace remaining CSS with Tailwind utility classes
- Active state: `weight="regular"` instead of `weight="light"` + left accent border
- Add `<Tooltip>` (shadcn/ui) for icon labels on hover
- **Delete:** `ActivityBar.css` entirely

#### 3b. TabBar

- Replace tab styling with Tailwind classes
- Monospace font for tab names (`font-mono text-xs`)
- Dirty indicator: `<Circle weight="fill" size={8} />` in accent color
- Close button: `<X size={14} />` with `opacity-0 group-hover:opacity-100`
- **Delete:** `TabBar.css` entirely

#### 3c. FileExplorer

- Replace tree item styling with Tailwind classes
- Caret icons already replaced in Phase 1
- File type icons already replaced in Phase 1
- Replace context menu with shadcn/ui `<ContextMenu>`
- Section header: `font-mono text-[11px] uppercase tracking-wider`
- **Delete:** `FileExplorer.css` entirely

#### 3d. SearchPanel

- Replace input with shadcn/ui `<Input>`
- Replace toggle buttons with proper Tailwind-styled toggles
- Replace results list styling with Tailwind
- Use `<ScrollArea>` for results container
- **Delete:** `SearchPanel.css` entirely

#### 3e. SourceControlPanel

- Replace commit textarea with shadcn/ui `<Textarea>`
- Replace branch dropdown with shadcn/ui `<DropdownMenu>`
- Replace buttons with shadcn/ui `<Button>`
- Use git status color tokens for status badges
- Use `<ScrollArea>` for file lists
- **Delete:** `SourceControlPanel.css` entirely

#### 3f. Editor Chrome (Header + Page Container)

- Migrate editor header (title bar area) to Tailwind
- Migrate page container and A4 layout shadows/borders to new tokens
- **Keep as plain CSS:** ProseMirror internal styles (`.ProseMirror`, `mark.comment`, placeholder `::before`)
- **Keep as plain CSS:** Comments track positioning (`calc()` expressions)
- Bubble menu: migrate dark theme to new `--color-bg-overlay` tokens
- Move ProseMirror-specific CSS to `src/styles/prosemirror.css`
- **Partially delete:** `Editor.css` (keep only ProseMirror-specific rules)

#### 3g. Overlay Components

- **Toast:** Keep custom component, migrate CSS to Tailwind classes. Keep `showToast()` API.
- **QuickOpen:** Keep custom component, migrate CSS to Tailwind classes. Consider shadcn/ui `<Command>` as future enhancement.
- **FolderPicker:** Replace with shadcn/ui `<Dialog>` + Tailwind styling.

#### 3h. Terminal Container

- Terminal internals are xterm.js (not CSS-controllable)
- Update xterm.js theme object in `Terminal.jsx` to use new warm palette values
- Migrate container inline styles to Tailwind classes
- **Keep as-is:** xterm CSS import

### Phase 4: Cleanup & Polish

#### 4a. Enable Tailwind Preflight

Now that all components use Tailwind classes, enable the base layer:
```css
@import "tailwindcss";  /* Full import including Preflight */
```

Fix any remaining visual regressions from Preflight.

#### 4b. Remove Legacy CSS

- Delete emptied component CSS files
- Remove old CSS variables from `src/index.css` (replaced by `@theme` tokens)
- Remove duplicate Google Fonts `@import` (consolidate to one location)
- Clean up any remaining hardcoded hex values

#### 4c. Update CLAUDE.md

Update these sections to reflect the new design system:
- CSS conventions: Tailwind utility classes, when to use plain CSS (ProseMirror, xterm)
- Component conventions: shadcn/ui for primitives, Phosphor for icons
- Theme: New token names and values
- Remove "No CSS modules, no CSS-in-JS" rule (Tailwind is now standard)
- Add "Use `cn()` from `src/lib/utils.js` for conditional classes"

#### 4d. Create Claude Code Skills

Write design system skills so future development follows the system. See "Skills" section below.

## System-Wide Impact

### Interaction Graph

- `vite.config.js` -> adds `@tailwindcss/vite` plugin -> processes all `.jsx`/`.css` files for utility classes
- `src/styles/theme.css` -> `@theme` directive -> Tailwind generates utility classes from tokens
- `src/lib/utils.js` -> `cn()` function -> used by every component for class merging
- `@phosphor-icons/react` -> tree-shaken -> only imported icons bundled
- shadcn/ui components -> `src/components/ui/` -> import Radix UI primitives as peer deps

### Error Propagation

- If Tailwind plugin fails: Vite build fails entirely (hard error, immediately visible)
- If icon import is wrong: React compile error (immediately visible)
- If shadcn/ui component has wrong props: Runtime React warning (visible in console)
- If theme token misspelled: Tailwind generates no class, element unstyled (visual, caught by testing)

### State Lifecycle Risks

- **No state changes.** This is a visual-only migration. All WorkspaceContext state, file operations, git operations, and terminal behavior remain unchanged.
- **Risk:** If a component's JSX structure changes significantly during migration (e.g., wrapping in shadcn/ui primitives), event handlers or `useRef` bindings could break. Mitigation: test each component after migration.

### API Surface Parity

- `showToast(message, type)` API: **Preserved** (custom Toast kept)
- File system service API: **Unchanged**
- Git service API: **Unchanged**
- Electron IPC / Go server: **Unchanged**

## Acceptance Criteria

### Functional Requirements

- [x] App loads without errors in both browser and Electron modes
- [x] All file operations (open, save, create, delete, rename) work identically
- [x] Editor content (TipTap) renders and edits correctly
- [x] Terminal connects and functions normally
- [x] Search, Source Control panels work without regression
- [x] All keyboard shortcuts preserved
- [x] Context menus work (right-click in file explorer)
- [x] Quick open (Ctrl+P) works

### Visual Requirements

- [x] Warm matte dark theme applied to all non-editor areas
- [x] Editor page retains warm cream paper appearance
- [x] Phosphor icons replace all CSS-drawn icons
- [x] Monospace typography in UI chrome (tabs, sidebars, labels)
- [x] Section headers are uppercase monospace with letter-spacing
- [x] Consistent accent color (terracotta) across interactive elements
- [x] Activity bar icons have light/regular weight toggle for active state
- [x] No hardcoded hex values remain in component CSS (all via tokens)

### Technical Requirements

- [x] `npm run dev` works (Vite dev server)
- [x] `npm run start` works (Vite + Electron)
- [x] `npm run build` produces working production build
- [x] No TypeScript files introduced (project stays plain JS)
- [x] Bundle size increase documented and under 100KB gzipped for all new deps
- [x] `src/components/ui/` contains only shadcn/ui generated components
- [x] `cn()` utility used for all conditional class composition
- [x] ProseMirror styles isolated in `src/styles/prosemirror.css`

### Documentation Requirements

- [x] CLAUDE.md updated with new CSS/component conventions
- [ ] Claude Code skills created for design system usage
- [ ] Icon mapping table documented in skill

## Dependencies & Risks

### New Dependencies

| Package | Purpose | Size Impact (gzipped) |
|---|---|---|
| `tailwindcss` | Utility CSS framework | Dev-only (0 runtime) |
| `@tailwindcss/vite` | Vite plugin | Dev-only (0 runtime) |
| `tailwind-merge` | Smart class merging | ~3KB |
| `@phosphor-icons/react` | Icon system (tree-shaken) | ~1-2KB per icon, est. ~30KB total |
| `@radix-ui/react-*` | shadcn/ui primitives | ~50-80KB total for 8 components |
| Various shadcn/ui deps | `class-variance-authority`, etc. | ~5KB |

**Estimated total runtime increase:** ~90-120KB gzipped

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tailwind Preflight breaks ProseMirror | High | High | Disable Preflight initially, enable after migration |
| shadcn/ui CLI generates TypeScript | Medium | Low | Use `tsx: false`, manually fix if needed |
| Active `feat/windows-build-wsl-remote` branch conflicts | Medium | Medium | Branch from `main`, merge Windows build first |
| Bundle size exceeds budget | Low | Medium | Monitor with `vite-bundle-analyzer` after each phase |
| Electron font rendering differs from browser | Low | Low | Test on both runtimes per phase |

## Claude Code Skills Plan

Create two skills to document the design system:

### Skill 1: `quipu-design-system`

**Trigger:** When writing or modifying any UI component in Quipu Simple

**Content:**
- Complete color token reference
- Typography scale
- Phosphor icon standards (weight, size per context)
- shadcn/ui component usage patterns
- `cn()` utility usage
- When to use plain CSS vs. Tailwind (ProseMirror, xterm)

### Skill 2: `quipu-add-component`

**Trigger:** When adding a new UI component or panel

**Content:**
- Step-by-step: create component file, use shadcn/ui primitives, apply theme tokens
- Icon selection guide
- Accessibility checklist
- File naming and structure conventions

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md](docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md) -- Activity Bar layout decisions (Decision #3, #4) and panel structure carried forward

### Internal References

- Current CSS variables: [src/index.css:3-22](src/index.css#L3-L22)
- Activity Bar icons (CSS): [src/components/ActivityBar.css:42-117](src/components/ActivityBar.css#L42-L117)
- File Explorer icons (CSS): [src/components/FileExplorer.css:148-177](src/components/FileExplorer.css#L148-L177)
- Editor page layout: [src/components/Editor.css:1-90](src/components/Editor.css#L1-L90)
- Terminal xterm theme: [src/components/Terminal.jsx:34-55](src/components/Terminal.jsx#L34-L55)
- Vite config: [vite.config.js](vite.config.js)
- Package deps: [package.json](package.json)

### External References

- [shadcn/ui JavaScript support](https://ui.shadcn.com/docs/javascript) -- `tsx: false` configuration
- [Tailwind CSS v4 Vite plugin](https://tailwindcss.com/docs/installation/vite) -- `@tailwindcss/vite`
- [Tailwind CSS v4 @theme directive](https://tailwindcss.com/docs/adding-custom-styles) -- CSS-based theme config
- [@phosphor-icons/react](https://github.com/phosphor-icons/react) -- React icon components
- [Phosphor Icons catalog](https://phosphoricons.com/) -- Browse all icons
