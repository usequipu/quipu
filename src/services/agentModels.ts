export interface AgentModelOption {
  id: string;
  label: string;
}

export const AGENT_MODELS: AgentModelOption[] = [
  { id: 'claude-opus-4-7', label: 'claude-opus-4-7' },
  { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
  { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
  { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
];

export const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-5';
