import { useEffect, useRef, useState } from 'react';
import { CaretDownIcon, CaretRightIcon, CaretLeftIcon, CheckIcon, InfoIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
  FALLBACK_MODELS,
  AGENT_EFFORTS,
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_EFFORT,
  loadAvailableModels,
  modelLabel,
  effortLabel,
  type AgentEffort,
  type AgentModelOption,
} from '../../services/agentModels';

interface ModelPickerProps {
  value: string | undefined;
  effort: AgentEffort | undefined;
  reasoning: boolean | undefined;
  onChange: (modelId: string) => void;
  onEffortChange: (effort: AgentEffort) => void;
  onReasoningChange: (enabled: boolean) => void;
  disabled?: boolean;
}

type View = 'main' | 'effort' | 'models';

export default function ModelPicker({
  value,
  effort,
  reasoning,
  onChange,
  onEffortChange,
  onReasoningChange,
  disabled,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('main');
  const [models, setModels] = useState<AgentModelOption[]>(FALLBACK_MODELS);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Resolve the live model list once on mount. The function caches internally,
  // so opening the picker repeatedly doesn't refetch.
  useEffect(() => {
    let cancelled = false;
    void loadAvailableModels().then((list) => {
      if (!cancelled && list.length > 0) setModels(list);
    });
    return () => { cancelled = true; };
  }, []);

  const currentId = value ?? DEFAULT_AGENT_MODEL;
  const featured = models.filter(m => m.tier !== 'more');
  const others = models.filter(m => m.tier === 'more' && m.id !== currentId);
  const currentEffort = effort ?? DEFAULT_AGENT_EFFORT;
  const reasoningOn = reasoning ?? true;

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
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view !== 'main') setView('main');
        else setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, view]);

  // Reset to main view whenever the popover closes so it doesn't reopen mid-submenu.
  useEffect(() => { if (!open) setView('main'); }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          'flex items-center gap-1.5 rounded px-2 py-1 transition-colors',
          !disabled && 'hover:bg-bg-elevated cursor-pointer',
          disabled && 'opacity-60 cursor-not-allowed',
        )}
        onClick={() => { if (!disabled) setOpen(v => !v); }}
        title={disabled ? 'Model locked while the agent is responding' : 'Change model, effort, or reasoning'}
        disabled={disabled}
      >
        <span className="text-[13px] text-text-secondary">{modelLabel(currentId, models)}</span>
        <span className="text-[12px] text-text-tertiary">{effortLabel(currentEffort)}</span>
        <CaretDownIcon size={11} weight="bold" className="text-text-tertiary" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute bottom-full right-0 mb-2 w-[280px] rounded-xl border border-border bg-bg-surface shadow-lg overflow-hidden z-30"
        >
          {view === 'main' && (
            <ul className="py-1">
              {featured.map((m) => {
                const selected = m.id === currentId;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={cn(
                        'w-full flex items-start justify-between gap-3 px-3 py-2 text-left transition-colors',
                        'hover:bg-bg-elevated',
                      )}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { onChange(m.id); setOpen(false); }}
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] text-text-primary leading-tight">{m.label}</div>
                        {m.description && (
                          <div className="text-[11px] text-text-tertiary mt-0.5 leading-tight">{m.description}</div>
                        )}
                      </div>
                      {selected && <CheckIcon size={14} className="text-accent shrink-0 mt-0.5" weight="bold" />}
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-bg-elevated transition-colors"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setView('effort')}
                >
                  <span className="text-[13px] text-text-primary">Esforço</span>
                  <span className="flex items-center gap-1 text-text-tertiary">
                    <span className="text-[12px]">{effortLabel(currentEffort)}</span>
                    <CaretRightIcon size={11} weight="bold" />
                  </span>
                </button>
              </li>
              {others.length > 0 && (
                <li>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-bg-elevated transition-colors"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setView('models')}
                  >
                    <span className="text-[13px] text-text-primary">Mais modelos</span>
                    <CaretRightIcon size={11} weight="bold" className="text-text-tertiary" />
                  </button>
                </li>
              )}
            </ul>
          )}

          {view === 'effort' && (
            <div>
              <div className="px-3 pt-3 pb-2">
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-primary"
                  onClick={() => setView('main')}
                >
                  <CaretLeftIcon size={12} weight="bold" />
                  <span>Voltar</span>
                </button>
                <p className="text-[11px] text-text-tertiary mt-2 leading-relaxed">
                  Maior esforço significa respostas mais completas, mas demora mais e usa seus limites mais rapidamente.
                </p>
              </div>
              <ul className="pb-1">
                {AGENT_EFFORTS.map((opt) => {
                  const selected = opt.id === currentEffort;
                  return (
                    <li key={opt.id}>
                      <button
                        type="button"
                        className={cn(
                          'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-bg-elevated',
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { onEffortChange(opt.id); setView('main'); }}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-[13px] text-text-primary">{opt.label}</span>
                          {opt.isDefault && (
                            <span className="text-[10px] text-text-tertiary bg-bg-elevated px-1.5 py-0.5 rounded">
                              Padrão
                            </span>
                          )}
                          {opt.id === 'max' && (
                            <InfoIcon size={11} className="text-text-tertiary" />
                          )}
                        </span>
                        {selected && <CheckIcon size={13} className="text-accent" weight="bold" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-border px-3 py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-text-primary leading-tight">Raciocínio</div>
                  <div className="text-[11px] text-text-tertiary mt-0.5 leading-tight">
                    Pode raciocinar para tarefas mais complexas
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={reasoningOn}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onReasoningChange(!reasoningOn)}
                  className={cn(
                    'shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors relative',
                    reasoningOn ? 'bg-accent' : 'bg-bg-elevated',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',
                      reasoningOn ? 'left-[18px]' : 'left-0.5',
                    )}
                  />
                </button>
              </div>
            </div>
          )}

          {view === 'models' && (
            <div>
              <div className="px-3 pt-3 pb-1">
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-primary"
                  onClick={() => setView('main')}
                >
                  <CaretLeftIcon size={12} weight="bold" />
                  <span>Voltar</span>
                </button>
              </div>
              <ul className="py-1">
                {models.map((m) => {
                  const selected = m.id === currentId;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        className={cn(
                          'w-full flex items-start justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-bg-elevated',
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { onChange(m.id); setOpen(false); }}
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] text-text-primary leading-tight">{m.label}</div>
                          {m.description && (
                            <div className="text-[11px] text-text-tertiary mt-0.5 leading-tight">{m.description}</div>
                          )}
                        </div>
                        {selected && <CheckIcon size={14} className="text-accent shrink-0 mt-0.5" weight="bold" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
