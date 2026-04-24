import React, { createContext, useContext, useState, useCallback } from 'react';
import {
  fetchBases, fetchDirectory, fetchFileContent,
  createBase, uploadFile, createRemoteFolder,
} from '../services/kamaluFileSystem';
import type { KamaluBase, KamaluConfig } from '../services/kamaluFileSystem';
import type { FileTreeEntry } from '../types/workspace';

export type KamaluStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface KamaluUser {
  userId: string;
  email: string;
  teamIds: string[];
}

interface KamaluState {
  // Connection
  status: KamaluStatus;
  serverUrl: string | null;
  apiKey: string | null;
  user: KamaluUser | null;
  errorMessage: string | null;
  connect: (serverUrl: string, apiKey: string) => Promise<void>;
  signIn: (signInUrl?: string) => Promise<void>;
  disconnect: () => void;

  // Bases
  bases: KamaluBase[];
  activeBase: KamaluBase | null;
  setActiveBase: (base: KamaluBase | null) => void;
  fetchBases: () => Promise<void>;

  // Remote file tree
  fetchRemoteDirectory: (baseId: string, path: string) => Promise<FileTreeEntry[]>;

  // Sync / Publish
  syncFolder: (localFolderPath: string, baseId: string, remotePath: string) => Promise<void>;
  publishFolder: (localFolderPath: string, name: string, slug?: string) => Promise<KamaluBase>;

  // .kamalu/config.json detection
  detectedConfig: KamaluConfig | null;
  notifyWorkspacePath: (workspacePath: string) => void;
}

const KamaluContext = createContext<KamaluState | null>(null);

const STORAGE_KEY = 'kamalu:connection';

function loadPersisted(): { serverUrl: string; apiKey: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p?.serverUrl && p?.apiKey) return p;
    return null;
  } catch {
    return null;
  }
}

export function KamaluProvider({ children }: { children: React.ReactNode }) {
  const persisted = loadPersisted();

  const [status, setStatus] = useState<KamaluStatus>('disconnected');
  const [serverUrl, setServerUrl] = useState<string | null>(persisted?.serverUrl ?? null);
  const [apiKey, setApiKey] = useState<string | null>(persisted?.apiKey ?? null);
  const [user, setUser] = useState<KamaluUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bases, setBases] = useState<KamaluBase[]>([]);
  const [activeBase, setActiveBase] = useState<KamaluBase | null>(null);
  const [detectedConfig, setDetectedConfig] = useState<KamaluConfig | null>(null);

  const attemptConnect = useCallback(async (url: string, key: string) => {
    const base = url.replace(/\/$/, '');
    setStatus('connecting');
    setErrorMessage(null);
    try {
      const res = await fetch(`${base}/api/auth/me`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as KamaluUser;
      setServerUrl(base);
      setApiKey(key);
      setUser(data);
      setStatus('connected');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ serverUrl: base, apiKey: key }));
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Connection failed');
    }
  }, []);

  // Auto-reconnect on mount; also handle /auth/callback for browser OAuth flow
  React.useEffect(() => {
    // Browser OAuth callback: if we landed on /auth/callback with a token, consume it
    if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      const returnedState = params.get('state');
      const returnedServer = params.get('server') ?? 'https://api.quipu.cc';
      const expectedState = sessionStorage.getItem('kamalu:oauth:state');
      sessionStorage.removeItem('kamalu:oauth:state');
      window.history.replaceState({}, '', '/');
      if (token && returnedState && returnedState === expectedState) {
        attemptConnect(returnedServer, token);
        return;
      }
    }

    if (persisted?.serverUrl && persisted?.apiKey) {
      attemptConnect(persisted.serverUrl, persisted.apiKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-load bases after connecting
  React.useEffect(() => {
    if (status === 'connected' && serverUrl && apiKey) {
      fetchBases(serverUrl, apiKey)
        .then(setBases)
        .catch(() => {});
    }
    if (status !== 'connected') {
      setBases([]);
    }
  }, [status, serverUrl, apiKey]);

  // Auto-select active base from detected config when bases load
  React.useEffect(() => {
    if (detectedConfig && bases.length > 0 && !activeBase) {
      const match = bases.find((b) => b.id === detectedConfig.baseId);
      if (match) setActiveBase(match);
    }
  }, [detectedConfig, bases, activeBase]);

  const connect = useCallback(async (url: string, key: string) => {
    await attemptConnect(url, key);
  }, [attemptConnect]);

  const signIn = useCallback(async (signInUrl?: string) => {
    const url = signInUrl ?? 'https://quipu.cc/sign-in';
    setStatus('connecting');
    setErrorMessage(null);
    try {
      if (window.electronAPI?.kamaluStartOAuth) {
        const { token, serverUrl: returnedServer } = await window.electronAPI.kamaluStartOAuth(url);
        const target = returnedServer ?? 'https://api.quipu.cc';
        await attemptConnect(target, token);
        return;
      }

      // Browser build: navigate to hosted sign-in with our callback
      const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('kamalu:oauth:state', state);
      const redirect = `${window.location.origin}/auth/callback`;
      const signInTarget = new URL(url);
      signInTarget.searchParams.set('redirect_uri', redirect);
      signInTarget.searchParams.set('state', state);
      window.location.href = signInTarget.toString();
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Sign-in failed');
    }
  }, [attemptConnect]);

  const disconnect = useCallback(() => {
    setStatus('disconnected');
    setServerUrl(null);
    setApiKey(null);
    setUser(null);
    setErrorMessage(null);
    setBases([]);
    setActiveBase(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const fetchBasesCallback = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    const result = await fetchBases(serverUrl, apiKey);
    setBases(result);
  }, [serverUrl, apiKey]);

  const fetchRemoteDirectory = useCallback(async (baseId: string, path: string): Promise<FileTreeEntry[]> => {
    if (!serverUrl || !apiKey) return [];
    return fetchDirectory(serverUrl, apiKey, baseId, path);
  }, [serverUrl, apiKey]);

  const syncFolder = useCallback(async (localFolderPath: string, baseId: string, remotePath: string): Promise<void> => {
    if (!serverUrl || !apiKey) throw new Error('Not connected to Kamalu');
    const base = bases.find((b) => b.id === baseId);
    if (!base) throw new Error('Base not found');

    const fs = (await import('../services/fileSystem')).default;

    const walk = async (remoteDir: string, localDir: string): Promise<void> => {
      const entries = await fetchDirectory(serverUrl, apiKey, baseId, remoteDir);
      await fs.createFolder(localDir);
      for (const entry of entries) {
        const localChild = `${localDir}/${entry.name}`;
        if (entry.isDirectory) {
          await walk(entry.path, localChild);
        } else {
          const content = await fetchFileContent(serverUrl, apiKey, baseId, entry.path);
          await fs.writeFile(localChild, content);
        }
      }
    };

    await walk(remotePath, localFolderPath);

    const config: KamaluConfig = {
      server: serverUrl,
      baseId: base.id,
      baseName: base.name,
      lastSeqNo: 0,
    };
    await fs.createFolder(`${localFolderPath}/.kamalu`);
    await fs.writeFile(`${localFolderPath}/.kamalu/config.json`, JSON.stringify(config, null, 2));
  }, [serverUrl, apiKey, bases]);

  const publishFolder = useCallback(async (localFolderPath: string, name: string, slug?: string): Promise<KamaluBase> => {
    if (!serverUrl || !apiKey) throw new Error('Not connected to Kamalu');

    const base = await createBase(serverUrl, apiKey, name, slug);

    const fs = (await import('../services/fileSystem')).default;

    const walk = async (localDir: string, remoteDir: string): Promise<void> => {
      const entries = await fs.readDirectory(localDir);
      for (const entry of entries) {
        if (entry.name === '.kamalu' || entry.name === '.git' || entry.name === 'node_modules') continue;
        const localChild = `${localDir}/${entry.name}`;
        const remoteChild = remoteDir ? `${remoteDir}/${entry.name}` : entry.name;
        if (entry.isDirectory) {
          await createRemoteFolder(serverUrl, apiKey, base.id, remoteChild);
          await walk(localChild, remoteChild);
        } else {
          const content = await fs.readFile(localChild);
          await uploadFile(serverUrl, apiKey, base.id, remoteChild, content);
        }
      }
    };

    await walk(localFolderPath, '');

    const config: KamaluConfig = {
      server: serverUrl,
      baseId: base.id,
      baseName: base.name,
      lastSeqNo: 0,
    };
    await fs.createFolder(`${localFolderPath}/.kamalu`);
    await fs.writeFile(`${localFolderPath}/.kamalu/config.json`, JSON.stringify(config, null, 2));

    setBases((prev) => [...prev, base]);
    return base;
  }, [serverUrl, apiKey]);

  // Called by KamaluWorkspaceSync when workspacePath changes.
  // Reads .kamalu/config.json from the workspace via a plain fetch to the local Go server
  // (or reads the file directly in Electron). We do a best-effort JSON parse.
  const notifyWorkspacePath = useCallback(async (workspacePath: string) => {
    if (!workspacePath) {
      setDetectedConfig(null);
      return;
    }
    try {
      const fs = (await import('../services/fileSystem')).default;
      const raw = await fs.readFile(`${workspacePath}/.kamalu/config.json`);
      const config = JSON.parse(raw) as KamaluConfig;
      if (config.server && config.baseId) {
        setDetectedConfig(config);
      } else {
        setDetectedConfig(null);
      }
    } catch {
      setDetectedConfig(null);
    }
  }, []);

  return (
    <KamaluContext.Provider value={{
      status, serverUrl, apiKey, user, errorMessage, connect, signIn, disconnect,
      bases, activeBase, setActiveBase, fetchBases: fetchBasesCallback,
      fetchRemoteDirectory,
      syncFolder, publishFolder,
      detectedConfig, notifyWorkspacePath,
    }}>
      {children}
    </KamaluContext.Provider>
  );
}

export function useKamalu(): KamaluState {
  const ctx = useContext(KamaluContext);
  if (!ctx) throw new Error('useKamalu must be used within KamaluProvider');
  return ctx;
}
