import type { KeybindingEntry } from '../extensions/keybindingRegistry';

/**
 * Declarative list of all built-in application keybindings.
 * These are registered at startup (before plugin keybindings) so they always
 * take precedence when a conflict arises.
 *
 * Key strings use the normalizeEvent format: modifier(s) joined by '+', then
 * the lowercased e.key value. On macOS the `mac` variant is used instead.
 */
export const builtinKeybindings: KeybindingEntry[] = [
  { key: 'ctrl+s',           mac: 'cmd+s',           commandId: 'file.save' },
  { key: 'ctrl+b',           mac: 'cmd+b',           commandId: 'view.toggleSidebar' },
  { key: 'ctrl+w',           mac: 'cmd+w',           commandId: 'file.closeTab' },
  { key: 'ctrl+tab',         mac: 'cmd+tab',         commandId: 'tab.next' },
  { key: 'ctrl+shift+tab',   mac: 'cmd+shift+tab',   commandId: 'tab.prev' },
  { key: 'ctrl+shift+f',     mac: 'cmd+shift+f',     commandId: 'view.search' },
  { key: 'ctrl+shift+p',     mac: 'cmd+shift+p',     commandId: 'view.commandPalette' },
  { key: 'ctrl+p',           mac: 'cmd+p',           commandId: 'view.quickOpen' },
  { key: 'ctrl+shift+`',     mac: 'cmd+shift+`',     commandId: 'terminal.new' },
  { key: 'ctrl+`',           mac: 'cmd+`',           commandId: 'terminal.toggle' },
  { key: 'ctrl+shift+enter', mac: 'cmd+shift+enter', commandId: 'terminal.send' },
  { key: 'ctrl+shift+l',     mac: 'cmd+shift+l',     commandId: 'terminal.claude' },
  { key: 'ctrl+shift+r',     mac: 'cmd+shift+r',     commandId: 'file.reloadFromDisk' },
  { key: 'ctrl+f',           mac: 'cmd+f',           commandId: 'editor.find' },
];
