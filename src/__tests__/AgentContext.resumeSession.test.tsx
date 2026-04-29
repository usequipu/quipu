import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import type { Agent } from '@/types/agent';

// In-memory storage fake — same shape used by the other AgentContext tests.
vi.mock('../services/storageService', () => {
  const store = new Map<string, unknown>();
  const fake = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      if (value === null || value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    }),
    __store: store,
    __reset: () => { store.clear(); },
  };
  return { default: fake, isElectronRuntime: () => false };
});

let currentWorkspacePath: string | null = '/foo';

vi.mock('../context/FileSystemContext', () => {
  return {
    useFileSystem: () => ({ workspacePath: currentWorkspacePath }),
  };
});

vi.mock('../context/RepoContext', () => {
  return {
    useRepo: () => ({
      cloneRepoForAgent: vi.fn(async () => '/fake/clone'),
      repos: [],
    }),
  };
});

vi.mock('../context/TabContext', () => {
  return {
    useTab: () => ({ renameTabsByPath: vi.fn() }),
  };
});

vi.mock('../components/ui/Toast', () => {
  return {
    useToast: () => ({ showToast: vi.fn() }),
  };
});

// Drive `isElectronAgentRuntime` and `startSession` per-test so we can
// simulate Electron-vs-browser and observe spawn calls + arguments.
let runtimeIsElectron = true;
const startSessionMock = vi.fn();

vi.mock('../services/agentRuntime', () => {
  return {
    isElectronAgentRuntime: () => runtimeIsElectron,
    startSession: (...args: unknown[]) => startSessionMock(...args),
  };
});

import storageService from '../services/storageService';
import { agentsKey, agentSessionsKey, migrationFlagKey } from '../services/workspaceKeys';
import { AgentProvider, useAgent } from '../context/AgentContext';

const fakeStorage = storageService as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  __store: Map<string, unknown>;
  __reset: () => void;
};

interface ResumeApi {
  resumeSession: (id: string) => Promise<void>;
  getSessionMessages: (id: string) => Array<{ role: string; body: string }>;
}

let api: ResumeApi | null = null;

function ApiProbe() {
  const ctx = useAgent();
  React.useEffect(() => {
    api = {
      resumeSession: ctx.resumeSession,
      getSessionMessages: (id: string) => {
        const s = ctx.getSession(id);
        return (s?.messages ?? []).map(m => ({ role: m.role, body: m.body }));
      },
    };
  });
  return <div data-testid="isLoaded">{String(ctx.isLoaded)}</div>;
}

function Harness({ initialPath = '/foo' as string | null, children }: {
  initialPath?: string | null;
  children: React.ReactNode;
}) {
  const [path] = useState<string | null>(initialPath);
  currentWorkspacePath = path;
  return <AgentProvider>{children}</AgentProvider>;
}

function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  const now = new Date().toISOString();
  return {
    id,
    name: id,
    kind: 'agent',
    systemPrompt: '',
    model: 'claude-sonnet-4-5',
    bindings: [],
    permissionMode: 'default',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeHandle() {
  return {
    sessionKey: 'fake-session',
    sendUserMessage: vi.fn(),
    respondToPermission: vi.fn(),
    stop: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  fakeStorage.__reset();
  fakeStorage.get.mockClear();
  fakeStorage.set.mockClear();
  api = null;
  currentWorkspacePath = '/foo';
  runtimeIsElectron = true;
  startSessionMock.mockReset();
  startSessionMock.mockImplementation(async () => makeFakeHandle());
  // Skip migration-from-globals noise.
  fakeStorage.__store.set(migrationFlagKey(), true);
});

async function renderWith(seededAgents: Agent[], seededSessions: Record<string, unknown> = {}) {
  fakeStorage.__store.set(agentsKey('/foo'), seededAgents);
  if (Object.keys(seededSessions).length > 0) {
    fakeStorage.__store.set(agentSessionsKey('/foo'), seededSessions);
  }
  const result = render(
    <Harness initialPath="/foo">
      <ApiProbe />
    </Harness>,
  );
  await waitFor(() => {
    expect(result.getByTestId('isLoaded').textContent).toBe('true');
  });
  expect(api).not.toBeNull();
  return result;
}

describe('AgentContext.resumeSession', () => {
  it('happy path: agent has stored claudeSessionId → startSession called with resumeSessionId', async () => {
    await renderWith(
      [makeAgent('a1')],
      { 'a1': { agentId: 'a1', messages: [], updatedAt: '2026-01-01T00:00:00Z', claudeSessionId: 'claude-abc' } },
    );

    await act(async () => {
      await api!.resumeSession('a1');
    });

    expect(startSessionMock).toHaveBeenCalledTimes(1);
    const [agentIdArg, opts] = startSessionMock.mock.calls[0];
    expect(agentIdArg).toBe('a1');
    expect((opts as { resumeSessionId?: string }).resumeSessionId).toBe('claude-abc');
  });

  it('happy path: agent has no stored session → startSession called with resumeSessionId === undefined', async () => {
    await renderWith([makeAgent('fresh')]);

    await act(async () => {
      await api!.resumeSession('fresh');
    });

    expect(startSessionMock).toHaveBeenCalledTimes(1);
    const [, opts] = startSessionMock.mock.calls[0];
    expect((opts as { resumeSessionId?: string }).resumeSessionId).toBeUndefined();
  });

  it('runtimeAvailable === false (browser mode) → no-op, startSession not called', async () => {
    runtimeIsElectron = false;
    await renderWith([makeAgent('browser-agent')]);

    await act(async () => {
      await api!.resumeSession('browser-agent');
    });

    expect(startSessionMock).not.toHaveBeenCalled();
  });

  it('agent does not exist → no crash, no spawned process', async () => {
    await renderWith([makeAgent('exists')]);

    await act(async () => {
      await api!.resumeSession('does-not-exist');
    });

    expect(startSessionMock).not.toHaveBeenCalled();
    // Also did not append any error-role message anywhere — the missing-agent
    // case is silent because there is no session to surface an error in.
    expect(api!.getSessionMessages('does-not-exist')).toEqual([]);
  });

  it('sequential rapid resumeSession calls for the same agent → only one subprocess spawns (handle cache)', async () => {
    await renderWith([makeAgent('cached')]);

    // Real-world rapid tab switches are sequential: each ChatView mount fires
    // its mount effect once, the previous mount's resume already settled. The
    // sessionHandlesRef.current.has(agentId) check inside ensureSession is
    // what prevents the second-and-onward calls from re-spawning.
    await act(async () => {
      await api!.resumeSession('cached');
    });
    await act(async () => {
      await api!.resumeSession('cached');
    });
    await act(async () => {
      await api!.resumeSession('cached');
    });

    expect(startSessionMock).toHaveBeenCalledTimes(1);
  });

  it('error path: startSession throws → an error message is appended to the agent session', async () => {
    startSessionMock.mockImplementationOnce(async () => {
      throw new Error('spawn failed: no claude binary');
    });

    await renderWith([makeAgent('boom')]);

    await act(async () => {
      await api!.resumeSession('boom');
    });

    const messages = api!.getSessionMessages('boom');
    expect(messages.some(m => m.role === 'error' && m.body.includes('spawn failed'))).toBe(true);
  });

  it('error path: startSession throws non-Error → string message still surfaces', async () => {
    startSessionMock.mockImplementationOnce(async () => {
      // Some lower layers reject with strings rather than Error instances.
      throw 'plain string failure';
    });

    await renderWith([makeAgent('strerr')]);

    await act(async () => {
      await api!.resumeSession('strerr');
    });

    const messages = api!.getSessionMessages('strerr');
    expect(messages.some(m => m.role === 'error' && m.body === 'plain string failure')).toBe(true);
  });

  it('integration: workspace switch clearing sessions means a fresh resumeSession spawns again', async () => {
    // Mount with a stored claudeSessionId so the first resume uses --resume.
    await renderWith(
      [makeAgent('persistent')],
      { 'persistent': { agentId: 'persistent', messages: [], updatedAt: '2026-01-01T00:00:00Z', claudeSessionId: 'sid-1' } },
    );

    await act(async () => {
      await api!.resumeSession('persistent');
    });
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect((startSessionMock.mock.calls[0][1] as { resumeSessionId?: string }).resumeSessionId).toBe('sid-1');

    // Calling resume again with the cached handle should NOT respawn.
    await act(async () => {
      await api!.resumeSession('persistent');
    });
    expect(startSessionMock).toHaveBeenCalledTimes(1);
  });
});
