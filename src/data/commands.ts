/**
 * Static command definitions consumed by the command palette (QuickOpen).
 *
 * Historically this file also drove the MenuBar component (File / Edit / View
 * / Terminal dropdowns) via the `menus` export and `MenuItem` union, but the
 * MenuBar was removed in Phase 1 of the visual overhaul
 * (docs/plans/2026-05-28-001-feat-visual-overhaul-plan.md). Only the flat
 * `commands` list survives — QuickOpen merges it with plugin-registered
 * commands from `commandRegistry`.
 */

export interface Command {
  type?: undefined;
  label: string;
  shortcut?: string;
  action: string;
  category: string;
}

export const commands: Command[] = [
  // File
  { label: 'New File', shortcut: 'Ctrl+N', action: 'file.new', category: 'File' },
  { label: 'New Window', shortcut: 'Ctrl+Shift+N', action: 'file.newWindow', category: 'File' },
  { label: 'Open Folder', action: 'file.openFolder', category: 'File' },
  { label: 'Save', shortcut: 'Ctrl+S', action: 'file.save', category: 'File' },
  { label: 'Close Tab', shortcut: 'Ctrl+W', action: 'file.closeTab', category: 'File' },

  // Edit
  { label: 'Undo', shortcut: 'Ctrl+Z', action: 'edit.undo', category: 'Edit' },
  { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: 'edit.redo', category: 'Edit' },
  { label: 'Cut', shortcut: 'Ctrl+X', action: 'edit.cut', category: 'Edit' },
  { label: 'Copy', shortcut: 'Ctrl+C', action: 'edit.copy', category: 'Edit' },
  { label: 'Paste', shortcut: 'Ctrl+V', action: 'edit.paste', category: 'Edit' },
  { label: 'Find in Files', shortcut: 'Ctrl+Shift+F', action: 'edit.findInFiles', category: 'Edit' },

  // View
  { label: 'Explorer', shortcut: 'Ctrl+Shift+E', action: 'view.explorer', category: 'View' },
  { label: 'Search', shortcut: 'Ctrl+Shift+F', action: 'view.search', category: 'View' },
  { label: 'Source Control', shortcut: 'Ctrl+Shift+G', action: 'view.git', category: 'View' },
  { label: 'Toggle Sidebar', action: 'view.toggleSidebar', category: 'View' },
  { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: 'view.toggleTerminal', category: 'View' },
  { label: 'Quick Open', shortcut: 'Ctrl+P', action: 'view.quickOpen', category: 'View' },
  { label: 'Command Palette', shortcut: 'Ctrl+Shift+P', action: 'view.commandPalette', category: 'View' },

  // Terminal
  { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: 'terminal.toggle', category: 'Terminal' },
  { label: 'New Terminal', shortcut: 'Ctrl+Shift+`', action: 'terminal.new', category: 'Terminal' },
  { label: 'Send to Terminal', action: 'terminal.send', category: 'Terminal' },

  // Kernel
  { label: 'Kernel: Run All Cells', action: 'kernel.runAll', category: 'Kernel' },
  { label: 'Kernel: Interrupt Kernel', action: 'kernel.interrupt', category: 'Kernel' },
  { label: 'Kernel: Restart Kernel', action: 'kernel.restart', category: 'Kernel' },

  // Preferences
  { label: 'Cycle Theme (Light / Tinted / Dark)', action: 'theme.toggle', category: 'Preferences' },
  { label: 'Toggle Editor Mode (Rich Text / Obsidian)', action: 'editor.toggleMode', category: 'Preferences' },
];
