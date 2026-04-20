import storageService from './storageService';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PluginRegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  downloadUrl: string;
  sizeHint: string;
  fileTypes: string[];
}

export interface PluginRegistryService {
  fetchRegistry(forceRefresh?: boolean): Promise<PluginRegistryEntry[]>;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const PLUGIN_REGISTRY_URL = 'https://raw.githubusercontent.com/usequipu/registry/main/plugins.json';
const CACHE_KEY = 'plugin-registry-cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface RegistryCache {
  entries: PluginRegistryEntry[];
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const pluginRegistry: PluginRegistryService = {
  async fetchRegistry(forceRefresh = false): Promise<PluginRegistryEntry[]> {
    // Return cached result when still fresh and no forced refresh requested.
    if (!forceRefresh) {
      const cached = (await storageService.get(CACHE_KEY)) as RegistryCache | null;
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.entries;
      }
    }

    try {
      const response = await fetch(PLUGIN_REGISTRY_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const entries = (await response.json()) as PluginRegistryEntry[];
      await storageService.set(CACHE_KEY, { entries, fetchedAt: Date.now() } satisfies RegistryCache);
      return entries;
    } catch (err) {
      // Network failure — degrade to stale cache when available.
      const cached = (await storageService.get(CACHE_KEY)) as RegistryCache | null;
      if (cached) return cached.entries;
      // No cache and no network — propagate so the caller can show an error.
      throw err;
    }
  },
};

export default pluginRegistry;
