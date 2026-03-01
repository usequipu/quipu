import React, { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../context/WorkspaceContext';
import searchService from '../services/searchService';

export default function QuickOpen({ isOpen, onClose }) {
  const { workspacePath, openFile } = useWorkspace();
  const [query, setQuery] = useState('');
  const [allFiles, setAllFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Fetch file list when modal opens
  useEffect(() => {
    if (!isOpen || !workspacePath) return;

    let cancelled = false;
    setIsLoading(true);
    setQuery('');
    setSelectedIndex(0);

    searchService.listFilesRecursive(workspacePath, 5000)
      .then(response => {
        if (!cancelled) {
          setAllFiles(response.files);
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

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Use a small delay to ensure the modal is rendered
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Filter files by query
  const filteredFiles = React.useMemo(() => {
    if (!query.trim()) return allFiles.slice(0, 100);
    const lowerQuery = query.toLowerCase();
    return allFiles
      .filter(f => f.path.toLowerCase().includes(lowerQuery))
      .slice(0, 100);
  }, [allFiles, query]);

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredFiles.length, query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.children[selectedIndex];
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleOpen = useCallback((file) => {
    if (!workspacePath) return;
    const absolutePath = workspacePath + '/' + file.path;
    openFile(absolutePath, file.name);
    onClose();
  }, [workspacePath, openFile, onClose]);

  const handleQueryChange = useCallback((e) => {
    setQuery(e.target.value);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filteredFiles.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredFiles[selectedIndex]) {
        handleOpen(filteredFiles[selectedIndex]);
      }
      return;
    }
  }, [onClose, filteredFiles, selectedIndex, handleOpen]);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/35 z-[1000] flex justify-center pt-[15vh]"
      onClick={handleBackdropClick}
    >
      <div className="w-[500px] max-w-[90vw] max-h-[400px] bg-bg-elevated rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden self-start">
        <input
          ref={inputRef}
          type="text"
          className="w-full border-none outline-none py-3 px-4 text-[15px] font-sans text-text-primary bg-bg-elevated border-b border-border shrink-0 placeholder:text-text-tertiary"
          placeholder="Type a file name to open..."
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        <div className="flex-1 overflow-y-auto max-h-[340px]" ref={listRef}>
          {isLoading && (
            <div className="p-4 text-center text-[13px] text-text-primary opacity-50 italic">Loading files...</div>
          )}
          {!isLoading && filteredFiles.length === 0 && query.trim() && (
            <div className="p-4 text-center text-[13px] text-text-primary opacity-50 italic">No matching files</div>
          )}
          {!isLoading && filteredFiles.length === 0 && !query.trim() && allFiles.length === 0 && (
            <div className="p-4 text-center text-[13px] text-text-primary opacity-50 italic">No files in workspace</div>
          )}
          {!isLoading && filteredFiles.map((file, idx) => (
            <div
              key={file.path}
              className={cn(
                "flex items-center py-1.5 px-4 cursor-pointer gap-2.5",
                "hover:bg-white/[0.04]",
                idx === selectedIndex && "bg-bg-overlay",
              )}
              onClick={() => handleOpen(file)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span className="text-sm font-medium text-text-primary shrink-0">{file.name}</span>
              <span className="text-xs text-text-tertiary overflow-hidden text-ellipsis whitespace-nowrap min-w-0 font-mono">{file.path}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
