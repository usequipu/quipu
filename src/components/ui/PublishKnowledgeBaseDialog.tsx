import React, { useState, useEffect, useRef } from 'react';
import { Dialog } from 'radix-ui';
import { XIcon, CircleNotchIcon, CloudArrowUpIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useKamalu } from '../../context/KamaluContext';
import { useToast } from './Toast';
import { cn } from '../../lib/utils';

interface PublishKnowledgeBaseDialogProps {
  open: boolean;
  onClose: () => void;
  localFolderPath: string;
  localFolderName: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

export default function PublishKnowledgeBaseDialog({ open, onClose, localFolderPath, localFolderName }: PublishKnowledgeBaseDialogProps) {
  const { publishFolder } = useKamalu();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(localFolderName);
      setSlug(slugify(localFolderName));
      setSlugManuallyEdited(false);
      setIsPublishing(false);
      setError(null);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open, localFolderName]);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManuallyEdited) setSlug(slugify(val));
  };

  const handleSlugChange = (val: string) => {
    setSlug(val);
    setSlugManuallyEdited(true);
  };

  const handlePublish = async () => {
    if (!name.trim()) return;
    setIsPublishing(true);
    setError(null);
    try {
      const base = await publishFolder(localFolderPath, name.trim(), slug.trim() || undefined);
      showToast(`Published "${base.name}" to Kamalu`, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !isPublishing) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[9998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg-elevated border border-border rounded-lg shadow-xl w-[460px] z-[9999] outline-none">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
            <Dialog.Title className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <CloudArrowUpIcon size={16} className="text-accent" />
              Publish as knowledge base
            </Dialog.Title>
            <button
              onClick={onClose}
              disabled={isPublishing}
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
                Name
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                disabled={isPublishing}
                placeholder="My knowledge base"
                className="w-full px-3 py-2 text-sm bg-bg-surface border border-border rounded-md text-text-primary outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Slug
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                disabled={isPublishing}
                placeholder="my-knowledge-base"
                className="w-full px-3 py-2 text-sm bg-bg-surface border border-border rounded-md text-text-primary outline-none focus:border-accent font-mono"
              />
              <p className="text-xs text-text-tertiary mt-1.5">
                URL-friendly identifier. Lowercase letters, numbers, and hyphens only.
              </p>
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
                disabled={isPublishing}
                className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={!name.trim() || isPublishing}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md text-white transition-colors',
                  (!name.trim() || isPublishing)
                    ? 'bg-accent/60 cursor-not-allowed'
                    : 'bg-accent hover:bg-accent-hover'
                )}
              >
                {isPublishing && <CircleNotchIcon size={13} className="animate-spin" />}
                {isPublishing ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
