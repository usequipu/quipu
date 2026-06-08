export interface AgentModelOption {
  id: string;
  label: string;
  description?: string;
  /** 'featured' models render at the top of the picker; 'more' sits behind the "Mais modelos" submenu. */
  tier?: 'featured' | 'more';
}

export const AGENT_MODELS: AgentModelOption[] = [
  {
    id: 'claude-opus-4-8',
    label: 'Opus 4.8',
    description: 'Most capable for ambitious work',
    tier: 'featured',
  },
  {
    id: 'claude-opus-4-7',
    label: 'Opus 4.7',
    description: 'Previous flagship',
    tier: 'more',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    description: 'Balanced speed and quality',
    tier: 'more',
  },
  {
    id: 'claude-sonnet-4-5',
    label: 'Sonnet 4.5',
    description: 'Reliable everyday model',
    tier: 'more',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    description: 'Fastest, lightest',
    tier: 'more',
  },
];

export const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-5';

export type AgentEffort = 'low' | 'medium' | 'high' | 'extra' | 'max';

export interface AgentEffortOption {
  id: AgentEffort;
  label: string;
  isDefault?: boolean;
}

export const AGENT_EFFORTS: AgentEffortOption[] = [
  { id: 'low', label: 'Baixo' },
  { id: 'medium', label: 'Médio' },
  { id: 'high', label: 'Alto', isDefault: true },
  { id: 'extra', label: 'Extra' },
  { id: 'max', label: 'Max' },
];

export const DEFAULT_AGENT_EFFORT: AgentEffort = 'high';

export function effortLabel(id: AgentEffort | undefined): string {
  return AGENT_EFFORTS.find(e => e.id === (id ?? DEFAULT_AGENT_EFFORT))?.label ?? 'Alto';
}

export function modelLabel(id: string | undefined): string {
  if (!id) return AGENT_MODELS[0]?.label ?? '';
  return AGENT_MODELS.find(m => m.id === id)?.label ?? id;
}
