import { executeCommand } from './commandRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeybindingEntry {
  /** Normalized key string, e.g. "ctrl+shift+g" */
  key: string;
  /** macOS variant, e.g. "cmd+shift+g". Falls back to `key` if omitted. */
  mac?: string;
  commandId: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _bindings: KeybindingEntry[] = [];

export function registerKeybinding(entry: KeybindingEntry): void {
  _bindings.push(entry);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Finds the first registered keybinding that matches the given KeyboardEvent,
 * calls e.preventDefault(), executes the bound command, and returns its ID.
 * Returns null if no binding matches.
 *
 * Built-in keybindings are registered before plugin ones, so they always win
 * when the same key combo is registered by multiple sources.
 */
export function resolveKeybinding(e: KeyboardEvent): string | null {
  const normalized = normalizeEvent(e);
  const isMac = navigator.platform.startsWith('Mac');

  for (const binding of _bindings) {
    const target = (isMac ? (binding.mac ?? binding.key) : binding.key).toLowerCase();
    if (target === normalized) {
      e.preventDefault();
      executeCommand(binding.commandId);
      return binding.commandId;
    }
  }
  return null;
}

function normalizeEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.metaKey) parts.push('cmd'); // Cmd on macOS, Win key on Windows
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(e.key.toLowerCase());
  return parts.join('+');
}
