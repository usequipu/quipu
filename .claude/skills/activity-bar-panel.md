---
name: activity-bar-panel
description: Pattern for adding a new panel to the VSCode-style Activity Bar sidebar system
triggers:
  - adding new panel
  - activity bar
  - sidebar panel
  - new side panel
  - extending activity bar
---

# Activity Bar Panel Pattern

Use this skill when adding a new panel to the Activity Bar sidebar system (like Explorer, Search, Source Control).

## Architecture

The panel system has 3 layers:
- **ActivityBar** (`src/components/ActivityBar.jsx`): 48px dark icon rail, renders buttons from `PANELS` array
- **App.jsx**: `activePanel` state controls which panel renders inside `.side-panel`
- **Panel component**: The actual panel content (warm theme, inside `.side-panel` container)

## Step 1: Create the Panel Component

Follow the [quipu-component](quipu-component.md) pattern. Panel components render inside `.side-panel` (250px wide, warm theme).

```jsx
import React, { useState, useCallback } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useToast } from '../components/Toast';
import './NewPanel.css';

export default function NewPanel() {
    const { workspacePath } = useWorkspace();
    const { showToast } = useToast();

    if (!workspacePath) {
        return (
            <div className="new-panel">
                <div className="new-panel-empty">Open a folder to get started</div>
            </div>
        );
    }

    return (
        <div className="new-panel">
            {/* panel content */}
        </div>
    );
}
```

CSS should use warm theme variables (panel inherits `var(--bg-color)` background from `.side-panel`):
```css
.new-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: var(--font-sans);
}
```

## Step 2: Register in ActivityBar

In `src/components/ActivityBar.jsx`, add to the `PANELS` array:

```javascript
const PANELS = [
    { id: 'explorer', label: 'Explorer', icon: 'files' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'git', label: 'Source Control', icon: 'git' },
    { id: 'newpanel', label: 'New Panel', icon: 'newicon' },  // Add here
];
```

Add the CSS icon in `src/components/ActivityBar.css`:

```css
.activity-icon-newicon::before {
    content: '...';  /* Unicode or emoji character */
}
```

## Step 3: Wire into App.jsx

In `src/App.jsx`:

1. Import the panel:
```jsx
import NewPanel from './components/NewPanel';
```

2. Add to the panel rendering block:
```jsx
{activePanel && (
    <div className="side-panel">
        {activePanel === 'explorer' && <FileExplorer />}
        {activePanel === 'search' && <SearchPanel />}
        {activePanel === 'git' && <SourceControlPanel />}
        {activePanel === 'newpanel' && <NewPanel />}
    </div>
)}
```

3. Optionally add a keyboard shortcut:
```jsx
if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'X') {
    e.preventDefault();
    setActivePanel('newpanel');
}
```

## Panel State Pattern

The panel toggle uses a single `activePanel` state in App.jsx:

```javascript
const [activePanel, setActivePanel] = useState('explorer');

const handlePanelToggle = useCallback((panelId) => {
    setActivePanel(prev => prev === panelId ? null : panelId);
}, []);
```

- Click active icon: closes panel (`null`)
- Click different icon: switches panel
- Ctrl+B: toggles sidebar visibility

## Checklist

- [ ] Panel component created with `.jsx` + `.css`
- [ ] Panel uses warm theme CSS variables
- [ ] Panel handles no-workspace-open state
- [ ] Panel entry added to `PANELS` array in ActivityBar.jsx
- [ ] CSS icon added in ActivityBar.css
- [ ] Panel rendering added to App.jsx side-panel block
- [ ] Keyboard shortcut added (optional)
- [ ] `aria-label` set on ActivityBar button
