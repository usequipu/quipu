export interface Command {
  type?: undefined;
  label: string;
  shortcut?: string;
  action: string;
  category: string;
}

interface MenuSeparator {
  type: 'separator';
}

interface MenuOpenRecent {
  type: 'openRecent';
}

export type MenuItem = Command | MenuSeparator | MenuOpenRecent | undefined;

export interface Menu {
  label: string;
  items: MenuItem[];
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

const sep: MenuSeparator = { type: 'separator' };

export const menus: Menu[] = [
  {
    label: 'File',
    items: [
      commands.find(c => c.action === 'file.new'),
      commands.find(c => c.action === 'file.newWindow'),
      commands.find(c => c.action === 'file.openFolder'),
      { type: 'openRecent' },
      sep,
      commands.find(c => c.action === 'file.save'),
      sep,
      commands.find(c => c.action === 'file.closeTab'),
    ],
  },
  {
    label: 'Edit',
    items: [
      commands.find(c => c.action === 'edit.undo'),
      commands.find(c => c.action === 'edit.redo'),
      sep,
      commands.find(c => c.action === 'edit.cut'),
      commands.find(c => c.action === 'edit.copy'),
      commands.find(c => c.action === 'edit.paste'),
      sep,
      commands.find(c => c.action === 'edit.findInFiles'),
    ],
  },
  {
    label: 'View',
    items: [
      commands.find(c => c.action === 'view.explorer'),
      commands.find(c => c.action === 'view.search'),
      commands.find(c => c.action === 'view.git'),
      sep,
      commands.find(c => c.action === 'view.toggleSidebar'),
      commands.find(c => c.action === 'view.toggleTerminal'),
      sep,
      commands.find(c => c.action === 'view.quickOpen'),
    ],
  },
  {
    label: 'Terminal',
    items: [
      commands.find(c => c.action === 'terminal.toggle'),
      commands.find(c => c.action === 'terminal.new'),
      sep,
      commands.find(c => c.action === 'terminal.send'),
    ],
  },
];
