import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Command } from 'cmdk';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../../context/WorkspaceContext';
import searchService from '../../services/searchService';
import { commands } from '../../data/commands';
import type { Command as CommandType } from '../../data/commands';

interface FileEntry {
  name: string;
  path: string;
}

interface QuickOpenProps {
  isOpen: boolean;
  onClose: () => void;
  onAction: (action: string) => void;
  initialValue?: string;
}

export default function QuickOpen({ isOpen, onClose, onAction, initialValue = '' }: QuickOpenProps) {
  const { workspacePath, openFile } = useWorkspace();
  const [query, setQuery] = useState<string>('');
  const [allFiles, setAllFiles] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const isCommandMode = query.trimStart().startsWith('>');

  // Set initial value when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery(initialValue);
    }
  }, [isOpen, initialValue]);

  // Fetch file list when modal opens
  useEffect(() => {
    if (!isOpen || !workspacePath) return;

    let cancelled = false;
    setIsLoading(true);

    searchService.listFilesRecursive(workspacePath, 5000)
      .then((files: string[]) => {
        if (!cancelled) {
          setAllFiles(files.map(f => ({ name: f.split('/').pop() || f, path: f })));
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllFiles([]);
          setIsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [isOpen, workspacePath]);

  // Filtered files for file mode (cmdk handles filtering for commands via its built-in filter)
  const filteredFiles = useMemo((): FileEntry[] => {
    if (isCommandMode) return [];
    if (!query.trim()) return allFiles.slice(0, 100);
    const lowerQuery = query.toLowerCase();
    return allFiles
      .filter((f: FileEntry) => f.path.toLowerCase().includes(lowerQuery))
      .slice(0, 100);
  }, [allFiles, query, isCommandMode]);

  // Filtered commands for command mode
  const filteredCommands = useMemo((): CommandType[] => {
    if (!isCommandMode) return [];
    const commandQuery = query.trimStart().slice(1).trim().toLowerCase();
    if (!commandQuery) return commands;
    return commands.filter((c: CommandType) =>
      c.label.toLowerCase().includes(commandQuery) ||
      c.category.toLowerCase().includes(commandQuery)
    );
  }, [query, isCommandMode]);

  const handleOpen = useCallback((file: FileEntry) => {
    if (!workspacePath) return;
    const absolutePath = workspacePath + '/' + file.path;
    openFile(absolutePath, file.name);
    onClose();
  }, [workspacePath, openFile, onClose]);

  const handleCommandSelect = useCallback((command: CommandType) => {
    onClose();
    if (onAction) {
      onAction(command.action);
    }
  }, [onClose, onAction]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/35 z-[1000] flex justify-center pt-[15vh]"
      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Command
        className="w-[500px] max-w-[90vw] max-h-[400px] bg-bg-elevated rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden self-start"
        shouldFilter={false}
        onKeyDown={handleKeyDown}
        label={isCommandMode ? "Command palette" : "Quick open"}
      >
        <Command.Input
          className="w-full border-none outline-none py-3 px-4 text-[15px] font-sans text-text-primary bg-bg-elevated border-b border-border shrink-0 placeholder:text-text-tertiary"
          placeholder={isCommandMode ? "Type a command..." : "Type a file name to open..."}
          value={query}
          onValueChange={setQuery}
          autoFocus
        />
        <Command.List className="flex-1 overflow-y-auto max-h-[340px]">
          {/* File mode */}
          {!isCommandMode && (
            <>
              {isLoading && (
                <Command.Loading className="p-4 text-center text-[13px] text-text-primary opacity-50 italic">
                  Loading files...
                </Command.Loading>
              )}
              <Command.Empty className="p-4 text-center text-[13px] text-text-primary opacity-50 italic">
                {query.trim() ? 'No matching files' : 'No files in workspace'}
              </Command.Empty>
              {!isLoading && filteredFiles.map((file: FileEntry) => (
                <Command.Item
                  key={file.path}
                  value={file.path}
                  onSelect={() => handleOpen(file)}
                  className={cn(
                    "flex items-center py-1.5 px-4 cursor-pointer gap-2.5",
                    "hover:bg-bg-overlay data-[selected=true]:bg-bg-overlay",
                  )}
                >
                  <span className="text-sm font-medium text-text-primary shrink-0">{file.name}</span>
                  <span className="text-xs text-text-tertiary overflow-hidden text-ellipsis whitespace-nowrap min-w-0 font-mono">{file.path}</span>
                </Command.Item>
              ))}
            </>
          )}

          {/* Command mode */}
          {isCommandMode && (
            <>
              <Command.Empty className="p-4 text-center text-[13px] text-text-primary opacity-50 italic">
                No matching commands
              </Command.Empty>
              {filteredCommands.map((cmd: CommandType) => (
                <Command.Item
                  key={cmd.action}
                  value={cmd.action}
                  onSelect={() => handleCommandSelect(cmd)}
                  className={cn(
                    "flex items-center justify-between py-1.5 px-4 cursor-pointer",
                    "hover:bg-bg-overlay data-[selected=true]:bg-bg-overlay",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] text-text-tertiary shrink-0">{cmd.category}</span>
                    <span className="text-sm text-text-primary truncate">{cmd.label}</span>
                  </div>
                  {cmd.shortcut && (
                    <span className="text-[11px] text-text-tertiary ml-4 shrink-0">{cmd.shortcut}</span>
                  )}
                </Command.Item>
              ))}
            </>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
