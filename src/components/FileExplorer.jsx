import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CaretRightIcon, CaretDownIcon, FileIcon as PhFileIcon, FolderIcon, FolderOpenIcon,
  NotebookIcon, FileJsIcon, FileJsxIcon, FileCssIcon, FileHtmlIcon,
  FileCodeIcon, FileMdIcon, FileTextIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../context/WorkspaceContext';

function getFileIcon(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  switch (ext) {
    case 'js': return FileJsIcon;
    case 'jsx': return FileJsxIcon;
    case 'css': return FileCssIcon;
    case 'html': return FileHtmlIcon;
    case 'json': case 'go': case 'ts': case 'tsx': return FileCodeIcon;
    case 'md': case 'markdown': return FileMdIcon;
    case 'quipu': return NotebookIcon;
    case 'txt': return FileTextIcon;
    default: return PhFileIcon;
  }
}

function FileIconComponent({ name, isDirectory, isExpanded }) {
  if (isDirectory) {
    return isExpanded
      ? <FolderOpenIcon size={16} className="shrink-0" />
      : <FolderIcon size={16} className="shrink-0" />;
  }
  const Icon = getFileIcon(name);
  return <Icon size={16} className="shrink-0" />;
}

function FileTreeItem({ entry, depth = 0 }) {
  const {
    activeFile,
    expandedFolders,
    toggleFolder,
    openFile,
    loadSubDirectory,
    createNewFile,
    createNewFolder,
    deleteEntry,
    renameEntry,
  } = useWorkspace();

  const [children, setChildren] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isCreating, setIsCreating] = useState(null); // 'file' | 'folder' | null
  const [createValue, setCreateValue] = useState('');
  const renameRef = useRef(null);
  const createRef = useRef(null);

  const isExpanded = expandedFolders.has(entry.path);
  const isActive = activeFile && activeFile.path === entry.path;

  useEffect(() => {
    if (entry.isDirectory && isExpanded) {
      loadSubDirectory(entry.path).then(setChildren);
    }
  }, [entry.path, entry.isDirectory, isExpanded, loadSubDirectory]);

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (isCreating && createRef.current) {
      createRef.current.focus();
    }
  }, [isCreating]);

  const handleClick = useCallback(() => {
    if (entry.isDirectory) {
      toggleFolder(entry.path);
    } else {
      openFile(entry.path, entry.name);
    }
  }, [entry, toggleFolder, openFile]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (contextMenu) {
      const handler = () => closeContextMenu();
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [contextMenu, closeContextMenu]);

  const handleRenameStart = useCallback(() => {
    setRenameValue(entry.name);
    setIsRenaming(true);
    closeContextMenu();
  }, [entry.name, closeContextMenu]);

  const handleRenameSubmit = useCallback(() => {
    if (renameValue && renameValue !== entry.name) {
      const parentPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
      renameEntry(entry.path, parentPath + '/' + renameValue);
    }
    setIsRenaming(false);
  }, [renameValue, entry, renameEntry]);

  const handleDelete = useCallback(() => {
    closeContextMenu();
    if (window.confirm(`Delete "${entry.name}"?`)) {
      deleteEntry(entry.path);
    }
  }, [entry, deleteEntry, closeContextMenu]);

  const handleNewFile = useCallback(() => {
    closeContextMenu();
    if (entry.isDirectory) {
      if (!isExpanded) toggleFolder(entry.path);
      setIsCreating('file');
    }
  }, [entry, isExpanded, toggleFolder, closeContextMenu]);

  const handleNewFolder = useCallback(() => {
    closeContextMenu();
    if (entry.isDirectory) {
      if (!isExpanded) toggleFolder(entry.path);
      setIsCreating('folder');
    }
  }, [entry, isExpanded, toggleFolder, closeContextMenu]);

  const handleCreateSubmit = useCallback(() => {
    if (createValue) {
      if (isCreating === 'file') {
        createNewFile(entry.path, createValue);
      } else {
        createNewFolder(entry.path, createValue);
      }
    }
    setIsCreating(null);
    setCreateValue('');
  }, [createValue, isCreating, entry.path, createNewFile, createNewFolder]);

  return (
    <div className="relative">
      <div
        className={cn(
          "flex items-center h-[22px] cursor-pointer gap-1 whitespace-nowrap overflow-hidden",
          "hover:bg-white/[0.06]",
          isActive && "bg-white/10",
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {entry.isDirectory && (
          isExpanded
            ? <CaretDownIcon size={14} className="shrink-0 text-text-tertiary" />
            : <CaretRightIcon size={14} className="shrink-0 text-text-tertiary" />
        )}
        <FileIconComponent name={entry.name} isDirectory={entry.isDirectory} isExpanded={isExpanded} />
        {isRenaming ? (
          <input
            ref={renameRef}
            className="bg-bg-elevated border border-accent text-text-primary text-[13px] font-[inherit] px-1 h-[18px] flex-1 outline-none rounded-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="overflow-hidden text-ellipsis flex-1 leading-[22px]">{entry.name}</span>
        )}
      </div>

      {contextMenu && (
        <div
          className="fixed bg-bg-elevated border border-border rounded shadow-lg py-1 min-w-[160px] z-[1000]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {entry.isDirectory && (
            <>
              <div className="py-1 px-6 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white" onClick={handleNewFile}>New File</div>
              <div className="py-1 px-6 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white" onClick={handleNewFolder}>New Folder</div>
              <div className="h-px bg-border my-1" />
            </>
          )}
          <div className="py-1 px-6 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white" onClick={handleRenameStart}>Rename</div>
          <div className="py-1 px-6 cursor-pointer text-[13px] text-text-secondary hover:bg-error hover:text-white" onClick={handleDelete}>Delete</div>
        </div>
      )}

      {entry.isDirectory && isExpanded && (
        <div>
          {isCreating && (
            <div className="flex items-center h-[22px] cursor-pointer gap-1 whitespace-nowrap overflow-hidden" style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}>
              {isCreating === 'folder' ? <FolderIcon size={16} className="shrink-0" /> : <PhFileIcon size={16} className="shrink-0" />}
              <input
                ref={createRef}
                className="bg-bg-elevated border border-accent text-text-primary text-[13px] font-[inherit] px-1 h-[18px] flex-1 outline-none rounded-none"
                value={createValue}
                placeholder={isCreating === 'file' ? 'filename' : 'folder name'}
                onChange={(e) => setCreateValue(e.target.value)}
                onBlur={handleCreateSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateSubmit();
                  if (e.key === 'Escape') { setIsCreating(null); setCreateValue(''); }
                }}
              />
            </div>
          )}
          {children.map((child) => (
            <FileTreeItem key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer() {
  const { workspacePath, fileTree, openFolder } = useWorkspace();

  return (
    <div className="bg-bg-surface text-text-primary flex flex-col select-none text-[13px] font-sans flex-1 overflow-hidden">
      <div className="h-[35px] flex items-center px-5 text-[11px] font-semibold tracking-wider text-text-tertiary uppercase border-b border-border shrink-0">
        <span>EXPLORER</span>
      </div>

      {!workspacePath ? (
        <div className="flex flex-col items-center justify-center p-5 flex-1 gap-3">
          <p className="text-text-tertiary text-[13px] m-0">No folder opened</p>
          <button
            className="bg-accent text-white border-none py-1.5 px-4 rounded-sm text-[13px] cursor-pointer hover:bg-accent-hover"
            onClick={openFolder}
          >
            Open Folder
          </button>
        </div>
      ) : (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div
            className="h-[22px] flex items-center px-3 text-[11px] font-bold tracking-wide text-text-tertiary uppercase cursor-pointer shrink-0 hover:bg-white/[0.06]"
            onClick={openFolder}
          >
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{workspacePath.split('/').pop()}</span>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb:hover]:bg-white/25">
            {fileTree.map((entry) => (
              <FileTreeItem key={entry.path} entry={entry} depth={0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
