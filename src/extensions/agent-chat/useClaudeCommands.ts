import { useEffect, useState } from 'react';
import { useFileSystem } from '../../context/FileSystemContext';
import { loadClaudeCommands, type ClaudeCommand } from '../../services/claudeCommandsService';

/**
 * Returns the full list of slash commands Claude Code advertises for this
 * workspace — built-ins, user skills, workspace commands, and every installed
 * plugin's commands + skills. Source of truth is the CLI's init event, so the
 * list matches what `claude` shows interactively.
 */
export function useClaudeCommands(): ClaudeCommand[] {
  const { workspacePath } = useFileSystem();
  const [commands, setCommands] = useState<ClaudeCommand[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadClaudeCommands(workspacePath).then((cmds) => {
      if (!cancelled) setCommands(cmds);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [workspacePath]);

  return commands;
}
