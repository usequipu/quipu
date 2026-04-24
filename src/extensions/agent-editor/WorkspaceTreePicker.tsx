import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CaretRightIcon,
  CaretDownIcon,
  FolderIcon,
  FolderOpenIcon,
  FileIcon,
  XIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useFileSystem } from '../../context/FileSystemContext';
import type { FileTreeEntry } from '@/types/workspace';

interface WorkspaceTreePickerProps {
  value: string;
  onChange: (subpath: string) => void;
}

function toRelative(absolutePath: string, workspacePath: string | null): string {
  if (!workspacePath) return absolutePath;
  if (absolutePath === workspacePath) return '';
  const prefix = workspacePath.endsWith('/') ? workspacePath : workspacePath + '/';
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : absolutePath;
}

export default function WorkspaceTreePicker({ value, onChange }: WorkspaceTreePickerProps) {
  const { workspacePath, fileTree } = useFileSystem();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handlePick = useCallback(
    (entry: FileTreeEntry) => {
      onChange(toRelative(entry.path, workspacePath));
      setOpen(false);
    },
    [onChange, workspacePath],
  );

  const handlePickRoot = useCallback(() => {
    onChange('');
    setOpen(false);
  }, [onChange]);

  const label = value || '(workspace root)';

  return (
    <div className="relative flex-1 min-w-0">
      <div className="flex items-center gap-1">
        <button
          ref={buttonRef}
          className="flex-1 min-w-0 h-8 px-2 rounded border border-border bg-bg-base text-xs font-mono text-left hover:border-accent focus:outline-none focus:border-accent flex items-center gap-2"
          onClick={() => setOpen((v) => !v)}
          title={value || 'Pick a path from the workspace'}
        >
          <FolderIcon size={12} className="text-text-tertiary shrink-0" />
          <span className={cn('truncate', !value && 'text-text-tertiary')}>{label}</span>
        </button>
        {value && (
          <button
            className="w-7 h-8 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors shrink-0"
            onClick={() => onChange('')}
            aria-label="Clear path"
            title="Clear path"
          >
            <XIcon size={12} />
          </button>
        )}
      </div>

      {open && (
        <div
          ref={popoverRef}
          className="absolute z-30 top-full left-0 right-0 mt-1 max-h-72 overflow-auto rounded border border-border bg-bg-surface shadow-lg"
        >
          {!workspacePath ? (
            <div className="px-3 py-4 text-xs text-text-tertiary">
              Open a workspace to pick paths.
            </div>
          ) : (
            <>
              <button
                className="w-full flex items-center gap-2 h-7 px-2 text-xs hover:bg-bg-elevated"
                onClick={handlePickRoot}
              >
                <FolderOpenIcon size={12} className="text-accent" />
                <span className="text-text-secondary">(workspace root)</span>
              </button>
              {fileTree.map((entry) => (
                <TreeNode key={entry.path} entry={entry} depth={0} onPick={handlePick} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface TreeNodeProps {
  entry: FileTreeEntry;
  depth: number;
  onPick: (entry: FileTreeEntry) => void;
}

function TreeNode({ entry, depth, onPick }: TreeNodeProps) {
  const { loadSubDirectory } = useFileSystem();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileTreeEntry[]>(entry.children ?? []);
  const [loading, setLoading] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!entry.isDirectory) return;
    if (!expanded && children.length === 0) {
      setLoading(true);
      try {
        const loaded = await loadSubDirectory(entry.path);
        setChildren(loaded);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  };

  return (
    <>
      <div
        className="flex items-center gap-1 h-7 px-2 text-xs hover:bg-bg-elevated cursor-pointer select-none"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onPick(entry)}
      >
        {entry.isDirectory ? (
          <button
            className="w-4 h-4 flex items-center justify-center text-text-tertiary hover:text-text-primary shrink-0"
            onClick={handleToggle}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <CaretDownIcon size={10} /> : <CaretRightIcon size={10} />}
          </button>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}
        {entry.isDirectory ? (
          expanded
            ? <FolderOpenIcon size={12} className="text-accent shrink-0" />
            : <FolderIcon size={12} className="text-text-tertiary shrink-0" />
        ) : (
          <FileIcon size={12} className="text-text-tertiary shrink-0" />
        )}
        <span className="truncate">{entry.name}</span>
        {loading && <span className="ml-auto text-[10px] text-text-tertiary">…</span>}
      </div>
      {expanded && children.map((child) => (
        <TreeNode key={child.path} entry={child} depth={depth + 1} onPick={onPick} />
      ))}
    </>
  );
}
