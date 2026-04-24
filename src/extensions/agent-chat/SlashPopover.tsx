import { useEffect, useRef } from 'react';
import type { ClaudeCommand } from '../../services/claudeCommandsService';

export type SlashCommand = ClaudeCommand;

interface SlashPopoverProps {
  query: string;
  commands: SlashCommand[];
  activeIndex: number;
  onSelect: (command: SlashCommand) => void;
  onIndexChange: (index: number) => void;
}

export function filterSlashCommands(query: string, commands: SlashCommand[]): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q || q === '/') return commands;
  const needle = q.replace(/^\//, '');
  const starts: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const c of commands) {
    const label = c.label.toLowerCase();
    const name = label.replace(/^\//, '');
    if (name.startsWith(needle)) starts.push(c);
    else if (label.includes(needle) || c.description.toLowerCase().includes(needle)) contains.push(c);
  }
  return [...starts, ...contains];
}

function sourceBadge(cmd: SlashCommand): { label: string; className: string } | null {
  if (cmd.source === 'workspace') return { label: 'workspace', className: 'text-accent' };
  if (cmd.source === 'plugin') return { label: cmd.pluginName ?? 'plugin', className: 'text-text-secondary' };
  if (cmd.source === 'user') return { label: 'user', className: 'text-text-secondary' };
  return null;
}

export default function SlashPopover({
  query,
  commands,
  activeIndex,
  onSelect,
  onIndexChange,
}: SlashPopoverProps) {
  const filtered = filterSlashCommands(query, commands);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex];
    if (el && el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border bg-bg-surface shadow-lg px-3 py-2 text-xs text-text-tertiary">
        No matching commands.
      </div>
    );
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border bg-bg-surface shadow-lg overflow-hidden">
      <ul ref={listRef} className="max-h-72 overflow-auto py-1">
        {filtered.map((cmd, idx) => {
          const isActive = idx === activeIndex;
          const badge = sourceBadge(cmd);
          return (
            <li key={cmd.id}>
              <button
                type="button"
                className={`w-full flex items-baseline gap-3 px-3 py-2 text-left transition-colors ${
                  isActive ? 'bg-bg-elevated' : 'hover:bg-bg-elevated'
                }`}
                onMouseEnter={() => onIndexChange(idx)}
                onMouseDown={(e) => { e.preventDefault(); }}
                onClick={() => onSelect(cmd)}
              >
                <span className="text-xs font-mono text-accent shrink-0">{cmd.label}</span>
                <span className="text-[11px] text-text-tertiary truncate flex-1">{cmd.description}</span>
                {badge && (
                  <span className={`text-[9px] font-semibold uppercase tracking-wider shrink-0 ${badge.className}`}>
                    {badge.label}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-text-tertiary">
        <kbd className="px-1 bg-bg-elevated rounded">↑↓</kbd> navigate
        <span className="mx-1.5">·</span>
        <kbd className="px-1 bg-bg-elevated rounded">Tab</kbd> /
        <kbd className="px-1 bg-bg-elevated rounded ml-1">↵</kbd> select
        <span className="mx-1.5">·</span>
        <kbd className="px-1 bg-bg-elevated rounded">Esc</kbd> dismiss
      </div>
    </div>
  );
}
