import type { PluginCommand, PluginCommandHandler, PluginCommandOptions } from '../types/plugin-types';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _commands: PluginCommand[] = [];

export function registerCommand(
  id: string,
  handler: PluginCommandHandler,
  options?: PluginCommandOptions,
): void {
  const cmd: PluginCommand = {
    id,
    handler,
    label: options?.label ?? id,
    category: options?.category ?? 'Plugin',
    shortcut: options?.shortcut,
  };
  const existing = _commands.findIndex((c) => c.id === id);
  if (existing !== -1) {
    _commands[existing] = cmd;
  } else {
    _commands.push(cmd);
  }
}

export function executeCommand(id: string, ...args: unknown[]): void {
  const cmd = _commands.find((c) => c.id === id);
  cmd?.handler(...args);
}

export function getRegisteredCommands(): readonly PluginCommand[] {
  return _commands;
}
