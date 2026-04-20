import React, { useState, useEffect, useCallback } from 'react';
import pluginRegistry, { type PluginRegistryEntry } from '../../services/pluginRegistry';
import { isElectron } from '../../services/pluginLoader';

interface FirstRunWizardProps {
  onComplete: () => void;
}

type InstallState = 'idle' | 'installing' | 'done' | 'error';

interface InstallStatus {
  state: InstallState;
  message?: string;
}

export default function FirstRunWizard({ onComplete }: FirstRunWizardProps) {
  const [entries, setEntries] = useState<PluginRegistryEntry[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [installStatus, setInstallStatus] = useState<Record<string, InstallStatus>>({});
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    pluginRegistry
      .fetchRegistry()
      .then(setEntries)
      .catch((err: unknown) =>
        setFetchError((err instanceof Error ? err.message : String(err)) || 'Failed to load plugin registry'),
      )
      .finally(() => setFetchLoading(false));
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const writeConfig = useCallback(async (installedIds: string[]) => {
    const config = { plugins: installedIds.map((id) => ({ id, enabled: true })) };
    await window.electronAPI!.writePluginsConfig(JSON.stringify(config, null, 2));
  }, []);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    const ids = Array.from(selected);
    const succeeded: string[] = [];

    for (const id of ids) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) continue;

      setInstallStatus((prev) => ({ ...prev, [id]: { state: 'installing' } }));
      try {
        const result = await window.electronAPI!.downloadAndExtractPlugin({
          id,
          downloadUrl: entry.downloadUrl,
        });
        if ('error' in result) {
          setInstallStatus((prev) => ({ ...prev, [id]: { state: 'error', message: result.error } }));
        } else {
          setInstallStatus((prev) => ({ ...prev, [id]: { state: 'done' } }));
          succeeded.push(id);
        }
      } catch (err) {
        setInstallStatus((prev) => ({
          ...prev,
          [id]: { state: 'error', message: err instanceof Error ? err.message : String(err) },
        }));
      }
    }

    await writeConfig(succeeded);
    setInstalling(false);
    onComplete();
  }, [selected, entries, writeConfig, onComplete]);

  const handleSkip = useCallback(async () => {
    await writeConfig([]);
    onComplete();
  }, [writeConfig, onComplete]);

  // Browser mode: no plugins supported — skip wizard entirely.
  if (!isElectron()) return null;

  const canInstall = !fetchLoading && !installing;

  return (
    <div className="fixed inset-0 z-[9999] bg-bg-base flex items-center justify-center">
      <div className="w-full max-w-xl px-8 py-10">
        <h1 className="text-xl font-semibold text-text-primary mb-1">Welcome to Quipu</h1>
        <p className="text-sm text-text-secondary leading-relaxed mb-7">
          Choose which viewer plugins to install. You can manage plugins later from the Plugin Manager panel.
        </p>

        {/* Plugin list */}
        <div
          className="bg-bg-surface border border-border rounded-lg overflow-y-auto mb-7"
          style={{ maxHeight: 340 }}
        >
          {fetchLoading ? (
            <p className="p-8 text-center text-sm text-text-tertiary">Loading available plugins…</p>
          ) : fetchError ? (
            <div className="p-8 text-center">
              <p className="text-sm text-text-secondary mb-1">Could not load plugin list</p>
              <p className="text-xs text-text-tertiary">{fetchError}</p>
              <p className="text-xs text-text-tertiary mt-2">
                You can install plugins later from the Plugin Manager.
              </p>
            </div>
          ) : entries.length === 0 ? (
            <p className="p-8 text-center text-sm text-text-tertiary">No plugins available yet.</p>
          ) : (
            entries.map((entry) => {
              const status = installStatus[entry.id];
              return (
                <label
                  key={entry.id}
                  className={`flex items-start gap-4 px-5 py-4 border-b border-border last:border-b-0 cursor-pointer hover:bg-bg-elevated transition-colors${installing ? ' pointer-events-none' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(entry.id)}
                    onChange={() => toggleSelect(entry.id)}
                    disabled={installing}
                    className="mt-0.5 flex-shrink-0 accent-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-medium text-text-primary">{entry.name}</span>
                      <span className="text-xs text-text-tertiary">{entry.version}</span>
                      {entry.sizeHint && (
                        <span className="text-xs text-text-tertiary">· {entry.sizeHint}</span>
                      )}
                      {status?.state === 'installing' && (
                        <span className="text-xs text-accent">Installing…</span>
                      )}
                      {status?.state === 'done' && (
                        <span className="text-xs text-success">✓ Installed</span>
                      )}
                      {status?.state === 'error' && (
                        <span className="text-xs text-error" title={status.message}>Failed</span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed mb-1.5">
                      {entry.description}
                    </p>
                    {entry.fileTypes.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {entry.fileTypes.map((ft) => (
                          <span
                            key={ft}
                            className="text-xs font-mono px-1.5 py-px rounded bg-bg-overlay text-text-tertiary"
                          >
                            {ft}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={handleSkip}
            disabled={installing}
            className="text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
          >
            Skip for now
          </button>
          <button
            onClick={handleInstall}
            disabled={!canInstall}
            className="px-5 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40"
          >
            {installing
              ? 'Installing…'
              : selected.size > 0
              ? `Install ${selected.size} plugin${selected.size > 1 ? 's' : ''}`
              : 'Continue without plugins'}
          </button>
        </div>
      </div>
    </div>
  );
}
