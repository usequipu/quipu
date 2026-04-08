import React, { useState, useEffect, useCallback } from 'react';
import { Dialog } from 'radix-ui';
import { XIcon, CaretRightIcon } from '@phosphor-icons/react';
import fs from '../../services/fileSystem';

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FolderPickerProps {
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export default function FolderPicker({ onSelect, onCancel }: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [pathInput, setPathInput] = useState<string>('');

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const items = await fs.readDirectory(dirPath);
      setEntries(items.filter((e: DirectoryEntry) => e.isDirectory));
      setCurrentPath(dirPath);
      setPathInput(dirPath);
    } catch (err) {
      console.error('Failed to load directory:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const home = await fs.getHomeDir();
      loadDirectory(home);
    })();
  }, [loadDirectory]);

  const goUp = useCallback(() => {
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
    loadDirectory(parent);
  }, [currentPath, loadDirectory]);

  const handlePathSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pathInput.trim()) {
      loadDirectory(pathInput.trim());
    }
  }, [pathInput, loadDirectory]);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[2000]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] max-h-[480px] bg-bg-elevated border border-border rounded-lg flex flex-col text-text-primary font-sans text-[13px] shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden z-[2001] outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between py-3 px-4 border-b border-border">
            <Dialog.Title className="text-sm font-semibold text-text-primary">
              Open Folder
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="bg-transparent border-none text-text-tertiary cursor-pointer p-0.5 leading-none hover:text-text-primary"
              >
                <XIcon size={18} />
              </button>
            </Dialog.Close>
          </div>

          <form className="flex py-2 px-3 gap-1.5 border-b border-border" onSubmit={handlePathSubmit}>
            <input
              className="flex-1 bg-bg-overlay border border-border text-text-primary py-1 px-2 text-[13px] font-mono rounded-sm outline-none focus:border-accent"
              value={pathInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPathInput(e.target.value)}
              spellCheck={false}
            />
            <button
              type="submit"
              className="bg-bg-overlay border border-border text-text-primary py-1 px-3 rounded-sm cursor-pointer text-[13px] hover:bg-white/[0.06]"
            >
              Go
            </button>
          </form>

          <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[300px] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-white/15">
            <div
              className="flex items-center gap-2 py-1 px-4 cursor-pointer h-[26px] text-text-tertiary border-b border-border hover:bg-white/[0.04]"
              onClick={goUp}
            >
              <span className="w-4 text-center text-[10px] shrink-0">..</span>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">(parent directory)</span>
            </div>
            {loading ? (
              <div className="p-5 text-center text-text-tertiary">Loading...</div>
            ) : entries.length === 0 ? (
              <div className="p-5 text-center text-text-tertiary">No subfolders</div>
            ) : (
              entries.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center gap-2 py-1 px-4 cursor-pointer h-[26px] hover:bg-white/[0.04]"
                  onDoubleClick={() => loadDirectory(entry.path)}
                >
                  <CaretRightIcon size={10} className="shrink-0 text-text-tertiary" />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{entry.name}</span>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between py-2.5 px-4 border-t border-border gap-3">
            <span className="text-xs text-text-tertiary overflow-hidden text-ellipsis whitespace-nowrap flex-1 font-mono">{currentPath}</span>
            <div className="flex gap-2 shrink-0">
              <button
                className="bg-transparent border border-border text-text-primary py-1.5 px-3.5 rounded-sm cursor-pointer text-[13px] hover:bg-white/[0.06]"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                className="bg-accent border-none text-white py-1.5 px-3.5 rounded-sm cursor-pointer text-[13px] hover:bg-accent-hover"
                onClick={() => onSelect(currentPath)}
              >
                Select Folder
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
