import { useEffect, useRef, useState } from 'react';
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { AGENT_MODELS, DEFAULT_AGENT_MODEL } from '../../services/agentModels';

interface ModelPickerProps {
  value: string | undefined;
  onChange: (modelId: string) => void;
  /** When true, the picker is rendered but interactions are disabled (e.g. during streaming). */
  disabled?: boolean;
}

export default function ModelPicker({ value, onChange, disabled }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const current = value ?? DEFAULT_AGENT_MODEL;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
        && buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          'flex items-center gap-1 text-[11px] text-text-tertiary font-mono rounded px-1.5 py-0.5 transition-colors',
          !disabled && 'hover:text-text-primary hover:bg-bg-elevated cursor-pointer',
          disabled && 'opacity-60 cursor-not-allowed',
        )}
        onClick={() => { if (!disabled) setOpen(v => !v); }}
        title={disabled ? 'Model locked while the agent is responding' : 'Change model for this agent'}
        disabled={disabled}
      >
        <span>{current}</span>
        <CaretDownIcon size={10} weight="bold" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute bottom-full right-0 mb-2 min-w-[200px] rounded-lg border border-border bg-bg-surface shadow-lg overflow-hidden z-30"
        >
          <ul className="py-1">
            {AGENT_MODELS.map((m) => {
              const selected = m.id === current;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono transition-colors',
                      selected ? 'text-text-primary bg-bg-elevated' : 'text-text-secondary hover:bg-bg-elevated',
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onChange(m.id); setOpen(false); }}
                  >
                    <CheckIcon size={12} className={selected ? 'text-accent' : 'text-transparent'} weight="bold" />
                    <span className="truncate">{m.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
