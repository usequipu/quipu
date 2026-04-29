import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import storage from '../services/storageService';
import fs from '../services/fileSystem';
import { useFileSystem } from './FileSystemContext';
import { reposKey } from '../services/workspaceKeys';
import { migrateGlobalKeysIfNeeded } from '../services/workspaceKeysMigration';
import type { Repo } from '@/types/agent';

const GITIGNORE_LINE = 'tmp/';

export type CloneStatus =
  | { state: 'idle' }
  | { state: 'cloning' }
  | { state: 'error'; message: string };

interface RepoContextValue {
  repos: Repo[];
  isLoaded: boolean;
  getRepo: (id: string) => Repo | undefined;
  upsertRepo: (repo: Repo) => void;
  deleteRepo: (id: string, options?: { removeClone?: boolean }) => Promise<void>;
  deleteFolder: (folder: string, options?: { removeClones?: boolean }) => Promise<void>;
  /**
   * Clone a repo into the given agent's scratch directory at
   * `<workspace>/tmp/<agentId>/repos/<repo-name>`. Each agent gets its own
   * isolated copy, worktree-style.
   */
  cloneRepoForAgent: (repoId: string, agentId: string) => Promise<string>;
  getCloneStatus: (id: string) => CloneStatus;
}

const RepoContext = createContext<RepoContextValue | null>(null);

function sanitizeRepoName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'repo';
}

async function ensureTmpGitignored(workspacePath: string): Promise<void> {
  const gitignorePath = `${workspacePath.replace(/\/+$/, '')}/.gitignore`;
  let current = '';
  try {
    const raw = await fs.readFile(gitignorePath);
    current = typeof raw === 'string' ? raw : '';
  } catch {
    current = '';
  }
  const lines = current.split('\n').map(l => l.trim());
  if (lines.includes(GITIGNORE_LINE) || lines.includes('tmp') || lines.includes('/tmp') || lines.includes('/tmp/')) {
    return;
  }
  const trailingNewline = current.length === 0 || current.endsWith('\n');
  const next = current + (trailingNewline ? '' : '\n') + `# Quipu: agent-cloned repos and scratch space\n${GITIGNORE_LINE}\n`;
  try {
    await fs.writeFile(gitignorePath, next);
  } catch {
    /* best-effort — the user might have a custom .gitignore flow */
  }
}

export function RepoProvider({ children }: { children: React.ReactNode }) {
  const { workspacePath } = useFileSystem();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [cloneStates, setCloneStates] = useState<Record<string, CloneStatus>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const reposRef = useRef<Repo[]>(repos);
  useEffect(() => { reposRef.current = repos; }, [repos]);

  // Tracks which workspacePath the in-memory `repos` belongs to. Synchronously
  // cleared at the top of the load effect (before the setStates that reset
  // state) and synchronously set when a load completes — both done via this
  // ref rather than a state value because the save effect needs a same-render
  // barrier. Without this, the save effect would fire during the workspace
  // transition (when its `workspacePath` dep changed but `repos` still holds
  // the previous workspace's data), writing the previous workspace's data
  // into the new workspace's storage key — a silent corruption of the new
  // workspace. (Mirrors the pattern in AgentContext.)
  const loadedWorkspaceRef = useRef<string | null>(null);

  // Load (and reload on workspace switch). Storage keys are scoped to the
  // current workspace; while `workspacePath` is null we present empty state
  // and never write, so a no-workspace window cannot accidentally clobber
  // data. The `cancelled` flag protects against rapid workspace switches: a
  // stale load that resolves after the user has already moved to a different
  // workspace must not overwrite the new workspace's just-loaded state.
  useEffect(() => {
    let cancelled = false;

    // Synchronously invalidate the loaded-workspace barrier so the save
    // effect that fires later in this same effect cycle (because its
    // `workspacePath` dep just changed) bails out instead of writing the
    // previous workspace's in-memory data into the new workspace's storage
    // key.
    loadedWorkspaceRef.current = null;

    // Reset on every workspace change. `cloneStates` is in-memory only — a
    // clone-in-progress that belongs to the previous workspace must not
    // bleed into the new one. The clone may still complete on disk (the
    // promise in cloneRepoForAgent keeps running), but the in-memory
    // cloning indicator is gone — that's an acceptable trade since the
    // clone target path is workspace-relative anyway.
    setIsLoaded(false);
    setRepos([]);
    setCloneStates({});

    if (!workspacePath) {
      return () => { cancelled = true; };
    }

    const key = reposKey(workspacePath);

    (async () => {
      try {
        await migrateGlobalKeysIfNeeded(workspacePath);
      } catch (err) {
        // Migration failure must not block workspace open. The corresponding
        // scoped key will simply be empty on first read; the user can re-key
        // by hand if needed.
        console.warn('[repos] migrateGlobalKeysIfNeeded failed', err);
      }
      if (cancelled) return;

      const saved = await storage.get(key).catch(() => null);
      if (cancelled) return;

      if (Array.isArray(saved)) {
        setRepos(saved as Repo[]);
      }
      // Mark this workspace as the source-of-truth BEFORE flipping isLoaded
      // so the save effect (which fires on the resulting render) sees the
      // matching ref and writes back to the correct key.
      loadedWorkspaceRef.current = workspacePath;
      setIsLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [workspacePath]);

  // Save effect guards on `isLoaded && workspacePath` AND on the
  // `loadedWorkspaceRef` matching the current workspacePath. The ref check is
  // what prevents cross-workspace data corruption: if the workspacePath dep
  // changed but the new workspace's load hasn't completed (or is in flight),
  // the ref is null and the save is skipped, so the previous workspace's
  // `repos` value never gets written into the new workspace's storage key.
  useEffect(() => {
    if (!isLoaded || !workspacePath) return;
    if (loadedWorkspaceRef.current !== workspacePath) return;
    storage.set(reposKey(workspacePath), repos).catch(() => {});
  }, [repos, isLoaded, workspacePath]);

  const getRepo = useCallback((id: string) => repos.find(r => r.id === id), [repos]);
  const getCloneStatus = useCallback((id: string) => cloneStates[id] ?? { state: 'idle' as const }, [cloneStates]);

  const upsertRepo = useCallback((repo: Repo) => {
    setRepos(prev => {
      const idx = prev.findIndex(r => r.id === repo.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = repo;
        return next;
      }
      return [...prev, repo];
    });
  }, []);

  const deleteRepo = useCallback(async (id: string, options?: { removeClone?: boolean }) => {
    const repo = reposRef.current.find(r => r.id === id);
    if (!repo) return;
    if (options?.removeClone && repo.localClonePath) {
      try {
        await fs.deletePath(repo.localClonePath);
      } catch (err) {
        console.warn('[repos] failed to delete clone dir', repo.localClonePath, err);
      }
    }
    setRepos(prev => prev.filter(r => r.id !== id));
    setCloneStates(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const deleteFolder = useCallback(async (folder: string, options?: { removeClones?: boolean }) => {
    const targetKey = folder.trim();
    const matches = reposRef.current.filter(r => (r.folder?.trim() ?? '') === targetKey);
    if (matches.length === 0) return;
    if (options?.removeClones) {
      await Promise.all(matches.map(async (repo) => {
        if (repo.localClonePath) {
          try { await fs.deletePath(repo.localClonePath); } catch (err) { console.warn('[repos] failed to delete clone dir', repo.localClonePath, err); }
        }
      }));
    }
    const ids = new Set(matches.map(r => r.id));
    setRepos(prev => prev.filter(r => !ids.has(r.id)));
    setCloneStates(prev => {
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        if (id in next) { delete next[id]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, []);

  const cloneRepoForAgent = useCallback(async (repoId: string, agentId: string): Promise<string> => {
    const repo = reposRef.current.find(r => r.id === repoId);
    if (!repo) throw new Error('Unknown repo');
    if (!repo.url) throw new Error('Repo has no URL to clone');
    if (!workspacePath) throw new Error('Open a workspace before cloning repos');
    if (!window.electronAPI?.gitClone) throw new Error('Cloning is only available in Electron');

    const base = workspacePath.replace(/\/+$/, '');
    const name = sanitizeRepoName(repo.name);
    const target = `${base}/tmp/${agentId}/repos/${name}`;

    // If it already exists, treat as a cache hit.
    if (window.electronAPI?.pathExists) {
      try {
        if (await window.electronAPI.pathExists(target)) return target;
      } catch { /* fall through to clone */ }
    } else {
      try {
        await fs.readDirectory(target);
        return target;
      } catch { /* not cloned yet */ }
    }

    setCloneStates(prev => ({ ...prev, [repoId]: { state: 'cloning' } }));
    try {
      await ensureTmpGitignored(base);
      await window.electronAPI.gitClone(repo.url, target);
      setCloneStates(prev => {
        const next = { ...prev };
        delete next[repoId];
        return next;
      });
      return target;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCloneStates(prev => ({ ...prev, [repoId]: { state: 'error', message } }));
      throw err;
    }
  }, [workspacePath]);

  const value: RepoContextValue = {
    repos,
    isLoaded,
    getRepo,
    upsertRepo,
    deleteRepo,
    deleteFolder,
    cloneRepoForAgent,
    getCloneStatus,
  };

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new Error('useRepo must be used within a RepoProvider');
  }
  return ctx;
}
