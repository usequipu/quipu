import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import storage from '../services/storageService';
import fs from '../services/fileSystem';
import { useFileSystem } from './FileSystemContext';
import type { Repo } from '@/types/agent';

const STORAGE_KEY = 'repos';
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

  useEffect(() => {
    storage.get(STORAGE_KEY).then((saved) => {
      if (Array.isArray(saved)) {
        setRepos(saved as Repo[]);
      }
      setIsLoaded(true);
    }).catch(() => {
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    storage.set(STORAGE_KEY, repos).catch(() => {});
  }, [repos, isLoaded]);

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
