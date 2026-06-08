// Agent model + effort options.
//
// The static list below is the FALLBACK we ship with — `claude` CLI accepts
// these aliases directly and resolves them to whatever Anthropic ships as
// latest. The live list returned by `loadAvailableModels()` supersedes this
// at runtime when the user has an `ANTHROPIC_API_KEY` configured: we hit
// Anthropic's /v1/models endpoint and use whatever the API says is real.

import type { AgentModelEntry, AgentModelsResult } from '@/types/electron-api';

export interface AgentModelOption extends AgentModelEntry {
  /** 'featured' models render at the top of the picker; 'more' sits behind the "Mais modelos" submenu. */
  tier?: 'featured' | 'more';
}

/**
 * Static fallback list using the CLI's built-in aliases. These ALWAYS work
 * because the CLI itself resolves them — `claude --model opus` always points
 * at whatever the latest Opus is. We use this list before the dynamic fetch
 * completes and as the final fallback when no API key is configured.
 */
export const FALLBACK_MODELS: AgentModelOption[] = [
  { id: 'opus', label: 'Opus', description: 'Most capable for ambitious work', tier: 'featured' },
  { id: 'sonnet', label: 'Sonnet', description: 'Balanced speed and quality', tier: 'more' },
  { id: 'haiku', label: 'Haiku', description: 'Fastest, lightest', tier: 'more' },
];

export const DEFAULT_AGENT_MODEL = 'sonnet';

let cachedModels: AgentModelOption[] | null = null;
let inFlight: Promise<AgentModelOption[]> | null = null;

/**
 * Resolve the list of available models at runtime. Hits Anthropic's models
 * endpoint via the Electron main process (so the API key never leaves the
 * machine and we don't pollute the renderer's network panel). Falls back to
 * the alias list when the IPC bridge is missing (browser runtime) or the
 * fetch fails (no key, network down, etc.).
 */
export async function loadAvailableModels(): Promise<AgentModelOption[]> {
  if (cachedModels) return cachedModels;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (api?.agentListModels) {
        const res: AgentModelsResult = await api.agentListModels();
        if (res?.models?.length) {
          const enriched = enrichWithTiers(res.models);
          cachedModels = enriched;
          return enriched;
        }
      }
    } catch (err) {
      console.warn('[agentModels] dynamic fetch failed, using fallback', err);
    }
    cachedModels = FALLBACK_MODELS;
    return FALLBACK_MODELS;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Force a refetch — used by the "refresh" affordance in the picker. */
export function clearModelCache(): void {
  cachedModels = null;
}

/**
 * Promote the top result (alphabetically, or by familiar marketing tier) to
 * 'featured'. Anthropic's /v1/models response is reverse-chronological so
 * the newest model is usually first; we honor that and put it on top.
 */
function enrichWithTiers(models: AgentModelEntry[]): AgentModelOption[] {
  return models.map((m, idx) => ({
    ...m,
    description: m.description ?? deriveDescription(m.id, m.label),
    tier: idx === 0 ? 'featured' : 'more',
  }));
}

function deriveDescription(id: string, _label: string): string {
  // Cheap inference so the picker shows SOMETHING under each row even when
  // the API doesn't return display copy. We only key off the tier in the
  // model id — full ids look like `claude-opus-4-8-20251205` etc.
  if (/opus/i.test(id)) return 'Most capable for ambitious work';
  if (/sonnet/i.test(id)) return 'Balanced speed and quality';
  if (/haiku/i.test(id)) return 'Fastest, lightest';
  return '';
}

export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentEffortOption {
  id: AgentEffort;
  label: string;
  isDefault?: boolean;
}

// Effort levels mirror `claude --effort` exactly. xhigh is the CLI's name —
// we display it as "Extra" in the UI, but the value is the CLI's value.
export const AGENT_EFFORTS: AgentEffortOption[] = [
  { id: 'low', label: 'Baixo' },
  { id: 'medium', label: 'Médio' },
  { id: 'high', label: 'Alto', isDefault: true },
  { id: 'xhigh', label: 'Extra' },
  { id: 'max', label: 'Max' },
];

export const DEFAULT_AGENT_EFFORT: AgentEffort = 'high';

export function effortLabel(id: AgentEffort | undefined): string {
  return AGENT_EFFORTS.find(e => e.id === (id ?? DEFAULT_AGENT_EFFORT))?.label ?? 'Alto';
}

export function modelLabel(id: string | undefined, available: AgentModelOption[] | null = cachedModels): string {
  if (!id) return available?.[0]?.label ?? '';
  const found = (available ?? FALLBACK_MODELS).find(m => m.id === id);
  if (found) return found.label;
  // The agent record may carry a full id (e.g. claude-opus-4-8-20251205)
  // that's not in our list — surface a humanized short label rather than
  // the noisy date suffix.
  return shortenModelId(id);
}

function shortenModelId(id: string): string {
  // claude-opus-4-8-20251205 -> Opus 4.8
  const m = id.match(/^claude-([a-z]+)-(\d+)-(\d+)/i);
  if (m) {
    const family = m[1][0].toUpperCase() + m[1].slice(1);
    return `${family} ${m[2]}.${m[3]}`;
  }
  return id;
}
