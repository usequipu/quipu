---
name: toast-notifications
description: Pattern for showing user-facing notifications using the toast system
triggers:
  - toast notification
  - showToast
  - error notification
  - success message
  - user feedback
  - error handling UI
---

# Toast Notification Pattern

Use this skill when showing user-facing notifications in Quipu. All user-visible errors, warnings, and success messages MUST use the toast system. Never use `console.error` alone for failures the user should know about.

## Usage

### In Components

```jsx
import { useToast } from '../components/Toast';

export default function MyComponent() {
    const { showToast } = useToast();

    const handleAction = useCallback(async () => {
        try {
            await someOperation();
            showToast('Operation succeeded', 'success');
        } catch (err) {
            showToast(`Operation failed: ${err.message}`, 'error');
        }
    }, [showToast]);
}
```

### In WorkspaceContext

`useToast()` is already imported in `WorkspaceContext.jsx`:

```javascript
const { showToast } = useToast();
```

Use it in all context operations for error/success feedback.

## Toast Types

| Type | Color | Use for |
|---|---|---|
| `error` | Red (`#cd3131`) | Failed operations, network errors, validation failures |
| `warning` | Yellow (`#e5e510`) | Tab cap reached, non-critical issues |
| `success` | Green (`#0dbc79`) | File saved, git commit succeeded |
| `info` | Blue (`#2472c8`) | Informational messages |

```javascript
showToast('File saved', 'success');
showToast('Close a tab to open more files', 'warning');
showToast('Failed to read directory: permission denied', 'error');
showToast('Search completed with 500+ results', 'info');
```

## Provider Setup

The `ToastProvider` wraps the entire app as the outermost provider in `App.jsx`:

```jsx
function App() {
    return (
        <ToastProvider>
            <WorkspaceProvider>
                <AppContent />
            </WorkspaceProvider>
        </ToastProvider>
    );
}
```

This allows both `WorkspaceContext` and all components to use `useToast()`.

## Behavior

- Position: bottom-right corner, stacked vertically
- Auto-dismiss: 5 seconds
- Max visible: 5 toasts (oldest dismissed first)
- Animation: slide-in from right
- Each toast has a colored left border matching its type
- Close button on each toast for manual dismissal

## Component Location

- `src/components/Toast.jsx` - ToastProvider + useToast hook
- `src/components/Toast.css` - Styles

## Rules

- **Never** use `console.error` alone for user-visible failures
- **Always** pair `console.error` with `showToast()` if keeping the log
- Use `error` type for actual failures, `warning` for non-blocking issues
- Keep messages concise but include the error reason (e.g., `err.message`)
- Success toasts are optional for frequent operations (e.g., don't toast every keystroke)
