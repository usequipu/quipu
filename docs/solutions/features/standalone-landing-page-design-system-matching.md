---
title: "Build standalone marketing landing page for Quipu code editor"
date: "2026-03-01"
problem_type: "new_feature"
component: "landing"
tags:
  - landing-page
  - marketing
  - standalone-html
  - no-framework
  - design-system
  - css-only-mockup
  - fontshare
  - intersection-observer
  - quipu
difficulty: medium
symptoms:
  - referenced plan file did not exist — requirements derived from CLAUDE.md and app code
  - design system must be matched without Tailwind or the Vite build pipeline
  - constraint to not modify any existing files
related:
  - docs/solutions/ui-bugs/editor-font-command-palette-theme-toggle.md
  - docs/solutions/ui-bugs/tailwind-v4-tiptap-typography-reset.md
---

# Standalone Landing Page with Design System Matching

## Problem

Implement a marketing landing page for the Quipu code editor as a **standalone HTML/CSS/JS** artifact in a new `landing/` directory. Constraints:

- Do not modify any existing files
- No build step (no Vite, no Tailwind compiler, no npm)
- Must visually match the app's design system (terracotta accent, three themes, Clash Grotesk font)
- The plan file (`docs/plans/2026-03-01-feat-landing-page-plan.md`) did not exist

## Root Cause / Challenge

The app's styling is entirely delivered through **Tailwind v4 CSS utilities** compiled at build time. A standalone HTML page cannot consume those utilities directly — all class names like `bg-bg-base`, `text-accent`, `hover:bg-accent-hover` resolve to nothing without the Tailwind compiler. Matching the design system required:

1. Extracting raw CSS custom property values from `src/styles/theme.css`
2. Duplicating the three-theme switching logic (`:root`, `:root.dark`, `:root.tinted`) in vanilla CSS
3. Sourcing the `Clash Grotesk` font from the same Fontshare CDN the app uses

## Solution

### Files Created

```
landing/
├── index.html    — semantic HTML, all 7 sections
├── styles.css    — 550 lines, full design system in vanilla CSS
└── script.js     — ~130 lines, Intersection Observer + typing animation + theme toggle
```

### Design Token Extraction

Copy the exact CSS custom property names and values from `src/styles/theme.css` into a `:root` block, then override in `:root.dark`:

```css
/* In landing/styles.css — pulled verbatim from src/styles/theme.css */
:root {
  --bg-base: #f5f3ef;
  --bg-surface: #ffffff;
  --text-primary: #1e1e1e;
  --text-secondary: #616161;
  --accent: #c4835a;
  --accent-hover: #b57348;
  --accent-muted: #f5e6d8;
  --border: #e0ddd8;
  --page-bg: #fffcf7;
  --page-text: #3d3530;
}

:root.dark {
  --bg-base: #111111;
  --bg-surface: #1a1a1a;
  --text-primary: #e8e8e0;
  --text-secondary: #a0a0a0;
  --accent: #d4935a;
  --border: #333333;
}
```

Never hardcode hex values inline in CSS rules — always reference custom properties so both themes stay consistent.

### Font Loading

Match the app's font stack exactly. Use Fontshare CDN for Clash Grotesk (same URL pattern as `src/index.css`):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?f[]=clash-grotesk@400,500,600,700&display=swap" rel="stylesheet">
```

Fallback chain: `'Clash Grotesk', 'Inter', sans-serif` — ensures readable text if Fontshare is unavailable.

### CSS-Only Editor Mockup

The hero section contains a detailed mockup of the Quipu editor UI built entirely in CSS with no images or canvas:

```html
<div class="mockup">
  <div class="mockup-titlebar">...</div>  <!-- traffic lights + title -->
  <div class="mockup-body">
    <div class="mockup-activity-bar">...</div>  <!-- 3 icon buttons -->
    <div class="mockup-sidebar">...</div>        <!-- file tree -->
    <div class="mockup-main">
      <div class="mockup-tabs">...</div>         <!-- open file tabs -->
      <div class="mockup-editor">               <!-- prose content -->
        <span class="ed-comment" data-comment="...">text</span>
      </div>
      <div class="mockup-terminal">...</div>     <!-- terminal panel -->
    </div>
  </div>
</div>
```

The inline comment tooltip is pure CSS via `content: attr(data-comment)` on a `::after` pseudo-element, opacity-transitioned on `:hover`.

### Scroll Animations

Use `IntersectionObserver` — not scroll event listeners — for fade-in animations:

```javascript
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);  // disconnect after first trigger
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
);

document.querySelectorAll('.anim-fade-up').forEach((el) => observer.observe(el));
```

Stagger delays via a CSS custom property: `style="--delay: 0.2s"` on each element.

### Typing Animation

A looping character-by-character typing effect cycles through real terminal commands:

```javascript
const commands = [
  'npm run dev',
  'git commit -m "ship landing page"',
  'claude "review my code"',
  'npm run build',
  'go run server/main.go',
];
// Type at 50–90ms/char (jitter for realism), pause 2s, delete at 25ms/char, repeat
```

Started only when the mockup scrolls into view (separate `IntersectionObserver` at 30% threshold) to avoid CPU waste above the fold.

### Section Structure

| Section | Content |
|---|---|
| Nav | Logo, links, theme toggle, mobile hamburger, "Download" CTA |
| Hero | Headline, subtitle, dual CTA, full CSS editor mockup with animated terminal |
| Features | 6-card grid: rich text, terminal, inline comments, command palette, frontmatter, dual runtime |
| Editor deep-dive | Split layout showing `.md` ↔ `.quipu` format conversion with visual before/after |
| Themes | Three mini-preview cards (Light, Tinted, Dark) using exact app color tokens |
| Download CTA | Large CTA card with download + GitHub buttons |
| Footer | Logo, nav links, attribution |

### Handling the Missing Plan File

The referenced plan (`docs/plans/2026-03-01-feat-landing-page-plan.md`) did not exist. Fallback derivation order used:

1. **`CLAUDE.md`** — design tokens, font names, component conventions, theme system
2. **`src/styles/theme.css`** — exact hex values for all three themes
3. **`src/index.css`** — Fontshare CDN URL, Google Fonts URL, font-face declarations
4. **`src/App.jsx`** — panel layout proportions to match in the CSS mockup
5. **`package.json`** — feature list (TipTap, xterm.js, Electron, Go, node-pty) for copy

Note added to implementation summary: "Plan file `docs/plans/2026-03-01-feat-landing-page-plan.md` was not found. Requirements were derived from CLAUDE.md and app source files."

## Prevention / Best Practices

### Standalone Page Checklist

```
Pre-build
  [ ] Confirm no build tool required — add comment to index.html: "Standalone page: no Vite, no npm"
  [ ] Read CLAUDE.md for current accent color and theme names (can change across versions)
  [ ] Copy CSS custom properties verbatim from src/styles/theme.css (do not approximate)
  [ ] Check src/index.css for exact Fontshare URL (CDN path may change)

Structure
  [ ] landing/index.html — meta charset, viewport, Open Graph tags, favicon
  [ ] landing/styles.css — linked externally, not inlined
  [ ] landing/script.js — linked externally, no type="module" unless needed
  [ ] No references to node_modules/, src/, or any path that requires the build pipeline

Design System
  [ ] Use CSS custom properties (--accent, --bg-surface) not Tailwind class names
  [ ] Mirror three-theme logic from theme.css (:root, :root.dark, :root.tinted)
  [ ] Apply theme class synchronously via <script> in <head> to prevent flash
  [ ] Persist theme in localStorage — check whether to share the app's key

Accessibility
  [ ] aria-label on icon-only buttons
  [ ] All external links: rel="noopener noreferrer"
  [ ] @media (prefers-reduced-motion) disables or reduces animations

Responsive
  [ ] Test at: 1440px, 1024px, 900px, 640px (breakpoints), 375px
  [ ] No horizontal scroll on any breakpoint
```

### What to Watch Out For

**Tailwind class names don't work.** Every time you reach for `bg-bg-base` or `text-accent`, translate it to `background: var(--bg-base)` or `color: var(--accent)`. Build the CSS property translation mentally before writing rules.

**Fontshare CDN stability.** The URL `https://api.fontshare.com/v2/css?...` is not guaranteed forever. For long-lived pages, self-host WOFF2 files under `landing/fonts/` and use `@font-face`. Add a comment to the `<link>` tag noting when it was last verified.

**Editor mockup drift.** The CSS mockup will fall out of sync as the app UI evolves. Add: `<!-- Editor mockup: last synced with app on 2026-03-01 -->` so it is easy to identify.

**localStorage key conflicts.** If the landing page uses a different localStorage key than the app for theme, a user with both open sees inconsistent themes. Check `src/App.jsx` for the app's key before setting yours.

**Deployment path.** If Go server will serve `landing/`, add a static file handler in `server/main.go` for that path. Ensure the sandbox restriction allows reads from `landing/`. If served from GitHub Pages separately, verify `landing/` is not excluded by `.gitignore`.

## Related Docs

- [`docs/solutions/ui-bugs/editor-font-command-palette-theme-toggle.md`](../ui-bugs/editor-font-command-palette-theme-toggle.md) — how Clash Grotesk and theme cycling were added to the app
- [`docs/solutions/ui-bugs/tailwind-v4-tiptap-typography-reset.md`](../ui-bugs/tailwind-v4-tiptap-typography-reset.md) — Tailwind v4 token system and CSS custom property patterns used in the app
