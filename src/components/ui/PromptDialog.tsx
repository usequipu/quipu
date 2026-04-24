import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface PromptDialogProps {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/**
 * Lightweight in-app replacement for window.prompt(), which Electron's
 * renderer does not support. Renders as a centered modal overlay with a
 * single-line text input.
 */
export default function PromptDialog({
  open,
  title,
  label,
  placeholder,
  defaultValue = '',
  confirmLabel = 'OK',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      // Focus the input on next frame so it's visible before the cursor lands.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className={cn(
        'w-full max-w-md rounded-lg border border-border bg-bg-surface shadow-xl',
        'p-5 mx-4',
      )}>
        <h2 className="text-sm font-medium text-text-primary mb-3">{title}</h2>
        {label && <label className="block text-xs text-text-secondary mb-1.5">{label}</label>}
        <input
          ref={inputRef}
          type="text"
          className="w-full h-9 px-3 rounded border border-border bg-bg-base text-sm focus:outline-none focus:border-accent"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); }
          }}
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="px-3 py-1.5 text-xs rounded border border-border text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleConfirm}
            disabled={value.trim().length === 0}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
