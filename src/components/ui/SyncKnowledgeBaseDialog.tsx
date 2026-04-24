import React, { useState, useEffect } from 'react';
import { Dialog } from 'radix-ui';
import { XIcon, CircleNotchIcon, CloudArrowDownIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useKamalu } from '../../context/KamaluContext';
import { useToast } from './Toast';
import { cn } from '../../lib/utils';
import type { KamaluBase } from '../../services/kamaluFileSystem';

interface SyncKnowledgeBaseDialogProps {
  open: boolean;
  onClose: () => void;
  localFolderPath: string;
  localFolderName: string;
}

type SyncMode = 'root' | 'path';

export default function SyncKnowledgeBaseDialog({ open, onClose, localFolderPath, localFolderName }: SyncKnowledgeBaseDialogProps) {
  const { bases, syncFolder } = useKamalu();
  const { showToast } = useToast();

  const [selectedBaseId, setSelectedBaseId] = useState<string>('');
  const [mode, setMode] = useState<SyncMode>('root');
  const [remotePath, setRemotePath] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedBaseId(bases[0]?.id ?? '');
      setMode('root');
      setRemotePath('');
      setIsSyncing(false);
      setError(null);
    }
  }, [open, bases]);

  const handleSync = async () => {
    if (!selectedBaseId) return;
    setIsSyncing(true);
    setError(null);
    try {
      const path = mode === 'root' ? '' : remotePath.replace(/^\/+|\/+$/g, '');
      await syncFolder(localFolderPath, selectedBaseId, path);
      const base = bases.find((b) => b.id === selectedBaseId);
      showToast(`Synced "${base?.name ?? 'base'}" to ${localFolderName}`, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !isSyncing) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[9998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg-elevated border border-border rounded-lg shadow-xl w-[460px] z-[9999] outline-none">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
            <Dialog.Title className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <CloudArrowDownIcon size={16} className="text-accent" />
              Sync with knowledge base
            </Dialog.Title>
            <button
              onClick={onClose}
              disabled={isSyncing}
              className="text-text-tertiary hover:text-text-primary transition-colors p-0.5 rounded disabled:opacity-40"
            >
              <XIcon size={14} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div>
              <p className="text-xs text-text-tertiary mb-1.5">Local folder</p>
              <p className="text-sm text-text-primary font-mono truncate">{localFolderPath}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Knowledge base
              </label>
              {bases.length === 0 ? (
                <p className="text-xs text-text-tertiary italic">No knowledge bases available.</p>
              ) : (
                <select
                  value={selectedBaseId}
                  onChange={(e) => setSelectedBaseId(e.target.value)}
                  disabled={isSyncing}
                  className="w-full px-3 py-2 text-sm bg-bg-surface border border-border rounded-md text-text-primary outline-none focus:border-accent"
                >
                  {bases.map((b: KamaluBase) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                What to sync
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                  <input
                    type="radio"
                    checked={mode === 'root'}
                    onChange={() => setMode('root')}
                    disabled={isSyncing}
                    className="accent-accent"
                  />
                  <span>Entire base (root)</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                  <input
                    type="radio"
                    checked={mode === 'path'}
                    onChange={() => setMode('path')}
                    disabled={isSyncing}
                    className="accent-accent"
                  />
                  <span>Specific path</span>
                </label>
                {mode === 'path' && (
                  <input
                    type="text"
                    value={remotePath}
                    onChange={(e) => setRemotePath(e.target.value)}
                    placeholder="notes/projects"
                    disabled={isSyncing}
                    className="w-full px-3 py-2 text-sm bg-bg-surface border border-border rounded-md text-text-primary outline-none focus:border-accent font-mono ml-5"
                  />
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-error/10 border border-error/20 rounded-md px-3 py-2">
                <WarningCircleIcon size={14} className="text-error shrink-0 mt-0.5" />
                <p className="text-xs text-error">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                disabled={isSyncing}
                className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleSync}
                disabled={!selectedBaseId || isSyncing || (mode === 'path' && !remotePath.trim())}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md text-white transition-colors',
                  (!selectedBaseId || isSyncing || (mode === 'path' && !remotePath.trim()))
                    ? 'bg-accent/60 cursor-not-allowed'
                    : 'bg-accent hover:bg-accent-hover'
                )}
              >
                {isSyncing && <CircleNotchIcon size={13} className="animate-spin" />}
                {isSyncing ? 'Syncing…' : 'Sync'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
