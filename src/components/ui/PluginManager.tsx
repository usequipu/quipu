import React, { useState, useEffect, useCallback } from 'react';
import semver from 'semver';
import { isElectron, type PluginsConfig, type PluginsConfigEntry } from '../../services/pluginLoader';
import pluginRegistry, { type PluginRegistryEntry } from '../../services/pluginRegistry';
import { useToast } from './Toast';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InstalledManifest {
  id: string;
  name: string;
  version: string;
  description: string;
}

type ManagerTab = 'installed' | 'available' | 'updates';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readConfig(): Promise<PluginsConfig | null> {
  const raw = await window.electronAPI!.readPluginsConfig();
  if (!raw) return null;
  try {
    const config = JSON.parse(raw) as PluginsConfig;
    return config;
  } catch {
    return null;
  }
}

async function saveConfig(config: PluginsConfig): Promise<void> {
  await window.electronAPI!.writePluginsConfig(JSON.stringify(config, null, 2));
}

async function readManifest(quipuDir: string, id: string): Promise<InstalledManifest | null> {
  try {
    const raw = await window.electronAPI!.readFile(`${quipuDir}/plugins/${id}/manifest.json`);
    if (!raw) return null;
    const m = JSON.parse(raw) as InstalledManifest;
    return m;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PluginManager component
// ---------------------------------------------------------------------------

export default function PluginManager() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<ManagerTab>('installed');
  const [config, setConfig] = useState<PluginsConfig | null>(null);
  const [manifests, setManifests] = useState<Record<string, InstalledManifest>>({});
  const [registry, setRegistry] = useState<PluginRegistryEntry[]>([]);
  const [quipuDir, setQuipuDir] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Load config + manifests + quipu dir on mount.
  const loadInstalled = useCallback(async () => {
    if (!isElectron()) return;
    setLoading(true);
    try {
      const [dir, cfg] = await Promise.all([
        window.electronAPI!.getQuipuDir(),
        readConfig(),
      ]);
      setQuipuDir(dir);
      setConfig(cfg ?? { plugins: [] });

      if (cfg) {
        const entries = await Promise.all(
          cfg.plugins.map(async (p) => {
            const m = await readManifest(dir, p.id);
            return m ? ([p.id, m] as [string, InstalledManifest]) : null;
          }),
        );
        const map: Record<string, InstalledManifest> = {};
        entries.forEach((e) => { if (e) map[e[0]] = e[1]; });
        setManifests(map);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Load registry for Available / Updates tabs (lazy — only when needed).
  const loadRegistry = useCallback(async (force = false) => {
    setRegistryLoading(true);
    try {
      const entries = await pluginRegistry.fetchRegistry(force);
      setRegistry(entries);
    } catch (err) {
      showToast(
        `Could not load plugin registry: ${err instanceof Error ? err.message : String(err)}`,
        'warning',
      );
    } finally {
      setRegistryLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadInstalled(); }, [loadInstalled]);

  // Fetch registry when switching to Available or Updates tab.
  useEffect(() => {
    if ((tab === 'available' || tab === 'updates') && registry.length === 0) {
      loadRegistry();
    }
  }, [tab, registry.length, loadRegistry]);

  const setActionBusy = (id: string, busy: boolean) =>
    setActionLoading((prev) => ({ ...prev, [id]: busy }));

  // Toggle enabled/disabled.
  const handleToggleEnabled = useCallback(async (id: string) => {
    if (!config) return;
    const updated: PluginsConfig = {
      plugins: config.plugins.map((p) =>
        p.id === id ? { ...p, enabled: !p.enabled } : p,
      ),
    };
    await saveConfig(updated);
    setConfig(updated);
    showToast('Restart Quipu to activate changes', 'info');
  }, [config, showToast]);

  // Uninstall.
  const handleUninstall = useCallback(async (id: string) => {
    if (!config) return;
    setActionBusy(id, true);
    try {
      await window.electronAPI!.removePluginDir(id);
      const updated: PluginsConfig = {
        plugins: config.plugins.filter((p) => p.id !== id),
      };
      await saveConfig(updated);
      setConfig(updated);
      setManifests((prev) => { const next = { ...prev }; delete next[id]; return next; });
      showToast('Restart Quipu to activate changes', 'info');
    } catch (err) {
      showToast(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setActionBusy(id, false);
    }
  }, [config, showToast]);

  // Install from registry.
  const handleInstall = useCallback(async (entry: PluginRegistryEntry) => {
    setActionBusy(entry.id, true);
    try {
      const result = await window.electronAPI!.downloadAndExtractPlugin({
        id: entry.id,
        downloadUrl: entry.downloadUrl,
      });
      if ('error' in result) throw new Error(result.error);

      const currentConfig = config ?? { plugins: [] };
      const alreadyInConfig = currentConfig.plugins.some((p) => p.id === entry.id);
      const updated: PluginsConfig = alreadyInConfig
        ? { plugins: currentConfig.plugins.map((p) => p.id === entry.id ? { ...p, enabled: true } : p) }
        : { plugins: [...currentConfig.plugins, { id: entry.id, enabled: true }] };

      await saveConfig(updated);
      setConfig(updated);

      // Refresh manifest for the newly installed plugin.
      if (quipuDir) {
        const m = await readManifest(quipuDir, entry.id);
        if (m) setManifests((prev) => ({ ...prev, [entry.id]: m }));
      }

      showToast('Restart Quipu to activate changes', 'info');
    } catch (err) {
      showToast(`Install failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setActionBusy(entry.id, false);
    }
  }, [config, quipuDir, showToast]);

  // Update (re-download) an installed plugin.
  const handleUpdate = useCallback(async (entry: PluginRegistryEntry) => {
    // Update is a re-install — same flow as install.
    await handleInstall(entry);
  }, [handleInstall]);

  // ---------------------------------------------------------------------------
  // Browser guard
  // ---------------------------------------------------------------------------

  if (!isElectron()) {
    return (
      <div className="flex flex-col h-full items-center justify-center px-6 py-10 text-center gap-3">
        <p className="text-sm font-medium text-text-primary">Desktop only</p>
        <p className="text-xs text-text-secondary leading-relaxed">
          Plugin management is only available in the Quipu desktop app.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const installedIds = new Set((config?.plugins ?? []).map((p) => p.id));

  const availableEntries = registry.filter((e) => !installedIds.has(e.id));

  const updateEntries = registry.filter((e) => {
    if (!installedIds.has(e.id)) return false;
    const installedVersion = manifests[e.id]?.version;
    if (!installedVersion) return false;
    try { return semver.gt(e.version, installedVersion); } catch { return false; }
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const TabButton = ({ id, label, count }: { id: ManagerTab; label: string; count?: number }) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
        tab === id
          ? 'bg-accent-muted text-accent'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
      )}
    >
      {label}
      {count != null && count > 0 && (
        <span className={cn(
          'min-w-[16px] h-4 flex items-center justify-center rounded-full text-[10px] font-bold px-1',
          tab === id ? 'bg-accent text-white' : 'bg-bg-overlay text-text-tertiary',
        )}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">Plugins</p>
        <div className="flex gap-1">
          <TabButton id="installed" label="Installed" count={(config?.plugins ?? []).length} />
          <TabButton id="available" label="Available" />
          <TabButton id="updates" label="Updates" count={updateEntries.length} />
        </div>
      </div>

      <div className="border-b border-border" />

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Installed ── */}
        {tab === 'installed' && (
          <>
            {loading ? (
              <p className="p-5 text-xs text-text-tertiary">Loading…</p>
            ) : (config?.plugins ?? []).length === 0 ? (
              <div className="p-5 text-center">
                <p className="text-xs text-text-secondary leading-relaxed">
                  No plugins installed.
                  <br />
                  Browse the <button className="text-accent underline-offset-2 hover:underline" onClick={() => setTab('available')}>Available</button> tab to add some.
                </p>
              </div>
            ) : (
              config!.plugins.map((entry: PluginsConfigEntry) => {
                const manifest = manifests[entry.id];
                const busy = actionLoading[entry.id] ?? false;
                return (
                  <div key={entry.id} className="px-4 py-3 border-b border-border last:border-b-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-text-primary truncate">
                          {manifest?.name ?? entry.id}
                        </p>
                        {manifest?.version && (
                          <p className="text-[10px] text-text-tertiary">{manifest.version}</p>
                        )}
                      </div>
                      {/* Toggle */}
                      <button
                        onClick={() => handleToggleEnabled(entry.id)}
                        className={cn(
                          'flex-shrink-0 relative rounded-full transition-colors',
                          entry.enabled ? 'bg-accent' : 'bg-bg-overlay',
                        )}
                        style={{ width: 32, height: 18 }}
                        title={entry.enabled ? 'Disable' : 'Enable'}
                      >
                        <span
                          className="absolute rounded-full bg-white shadow-sm transition-all"
                          style={{ width: 14, height: 14, top: 2, left: entry.enabled ? 16 : 2 }}
                        />
                      </button>
                    </div>
                    {manifest?.description && (
                      <p className="text-[10px] text-text-secondary leading-relaxed mb-2">
                        {manifest.description}
                      </p>
                    )}
                    <button
                      onClick={() => handleUninstall(entry.id)}
                      disabled={busy}
                      className="text-[10px] text-text-tertiary hover:text-error transition-colors disabled:opacity-40"
                    >
                      {busy ? 'Removing…' : 'Uninstall'}
                    </button>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── Available ── */}
        {tab === 'available' && (
          <>
            {registryLoading ? (
              <p className="p-5 text-xs text-text-tertiary">Loading registry…</p>
            ) : availableEntries.length === 0 ? (
              <div className="p-5 text-center">
                <p className="text-xs text-text-secondary">
                  {registry.length === 0 ? 'No plugins found in registry.' : 'All available plugins are already installed.'}
                </p>
                <button
                  onClick={() => loadRegistry(true)}
                  className="mt-2 text-xs text-accent hover:underline"
                >
                  Refresh
                </button>
              </div>
            ) : (
              <>
                {availableEntries.map((entry) => {
                  const busy = actionLoading[entry.id] ?? false;
                  return (
                    <div key={entry.id} className="px-4 py-3 border-b border-border last:border-b-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-text-primary truncate">{entry.name}</p>
                          <p className="text-[10px] text-text-tertiary">
                            {entry.version}
                            {entry.sizeHint && ` · ${entry.sizeHint}`}
                          </p>
                        </div>
                        <button
                          onClick={() => handleInstall(entry)}
                          disabled={busy}
                          className="flex-shrink-0 px-2 py-0.5 text-[10px] font-medium bg-accent text-white rounded hover:bg-accent-hover transition-colors disabled:opacity-40"
                        >
                          {busy ? 'Installing…' : 'Install'}
                        </button>
                      </div>
                      <p className="text-[10px] text-text-secondary leading-relaxed mb-1.5">
                        {entry.description}
                      </p>
                      {entry.fileTypes.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {entry.fileTypes.map((ft) => (
                            <span
                              key={ft}
                              className="text-[10px] font-mono px-1 py-px rounded bg-bg-overlay text-text-tertiary"
                            >
                              {ft}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="px-4 py-2">
                  <button
                    onClick={() => loadRegistry(true)}
                    className="text-[10px] text-text-tertiary hover:text-accent transition-colors"
                  >
                    Refresh registry
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Updates ── */}
        {tab === 'updates' && (
          <>
            {registryLoading ? (
              <p className="p-5 text-xs text-text-tertiary">Checking for updates…</p>
            ) : updateEntries.length === 0 ? (
              <div className="p-5 text-center">
                <p className="text-xs text-text-secondary">All plugins are up to date.</p>
                <button
                  onClick={() => loadRegistry(true)}
                  className="mt-2 text-xs text-accent hover:underline"
                >
                  Check again
                </button>
              </div>
            ) : (
              updateEntries.map((entry) => {
                const busy = actionLoading[entry.id] ?? false;
                const installedVersion = manifests[entry.id]?.version ?? '?';
                return (
                  <div key={entry.id} className="px-4 py-3 border-b border-border last:border-b-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-text-primary truncate">{entry.name}</p>
                        <p className="text-[10px] text-text-tertiary">
                          {installedVersion} → <span className="text-accent">{entry.version}</span>
                        </p>
                      </div>
                      <button
                        onClick={() => handleUpdate(entry)}
                        disabled={busy}
                        className="flex-shrink-0 px-2 py-0.5 text-[10px] font-medium bg-accent text-white rounded hover:bg-accent-hover transition-colors disabled:opacity-40"
                      >
                        {busy ? 'Updating…' : 'Update'}
                      </button>
                    </div>
                    <p className="text-[10px] text-text-secondary leading-relaxed">
                      {entry.description}
                    </p>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
