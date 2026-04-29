import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';

// In-memory storage fake. Defined inside vi.mock's factory so hoisting works,
// then re-imported below for inspection. Mirrors the pattern in
// workspaceKeysMigration.test.ts.
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

// Mock the dependent contexts. AgentProvider only needs:
// - useFileSystem().workspacePath
// - useRepo() → cloneRepoForAgent + repos
// - useTab() → renameTabsByPath
// - useToast() → showToast
//
// We expose mutable controllers on the mock modules so individual tests can
// flip workspacePath at runtime via React state without remounting.
let currentWorkspacePath: string | null = null;

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

// Agent runtime — we don't exercise the subprocess path, just the workspace
// load/save. Provide non-Electron defaults so any path that touches the
// runtime is a no-op.
vi.mock('../services/agentRuntime', () => {
  return {
    isElectronAgentRuntime: () => false,
    startSession: vi.fn(),
  };
});

import storageService from '../services/storageService';
import { agentsKey, agentSessionsKey, agentFoldersKey, migrationFlagKey } from '../services/workspaceKeys';
import { AgentProvider, useAgent } from '../context/AgentContext';

const fakeStorage = storageService as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  __store: Map<string, unknown>;
  __reset: () => void;
};

// Test harness component: drives `currentWorkspacePath` via React state and
// re-renders the provider whenever it changes, simulating a real
// FileSystemContext value flip.
function Harness({ initialPath, onReady, children }: {
  initialPath: string | null;
  onReady?: (api: { setPath: (p: string | null) => void }) => void;
  children: React.ReactNode;
}) {
  const [path, setPath] = useState<string | null>(initialPath);
  // Sync the module-level mock state every render so useFileSystem() returns
  // the latest path during this render pass.
  currentWorkspacePath = path;
  React.useEffect(() => { onReady?.({ setPath }); }, [onReady]);
  return <AgentProvider>{children}</AgentProvider>;
}

/** Renders the current AgentContext state into the DOM so tests can poll it
 *  via standard testing-library assertions. */
function StateProbe() {
  const ctx = useAgent();
  return (
    <div>
      <div data-testid="isLoaded">{String(ctx.isLoaded)}</div>
      <div data-testid="agentIds">{ctx.agents.map(a => a.id).sort().join(',')}</div>
      <div data-testid="folders.agents">{ctx.folders.agents.join(',')}</div>
      <div data-testid="folders.chats">{ctx.folders.chats.join(',')}</div>
    </div>
  );
}

interface ActionsApi {
  upsertAgent: (id: string) => void;
}

let actionsApi: ActionsApi | null = null;

function ActionsProbe() {
  const ctx = useAgent();
  React.useEffect(() => {
    actionsApi = {
      upsertAgent: (id: string) => ctx.upsertAgent({
        id,
        name: id,
        kind: 'agent',
        systemPrompt: '',
        model: 'claude-sonnet-4-5',
        bindings: [],
        permissionMode: 'default',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    };
  });
  return null;
}

beforeEach(() => {
  fakeStorage.__reset();
  fakeStorage.get.mockClear();
  fakeStorage.set.mockClear();
  currentWorkspacePath = null;
  actionsApi = null;
  // Mark migration flag set by default so most tests can exercise the load
  // path without involving the migration step. Tests that want migration
  // explicitly clear the flag in setup.
  fakeStorage.__store.set(migrationFlagKey(), true);
});

describe('AgentProvider workspace-scoped storage', () => {
  it('happy path: mounts with workspacePath=/foo and populates state from scoped keys', async () => {
    const seededAgents = [{
      id: 'a1',
      name: 'Agent 1',
      kind: 'agent',
      systemPrompt: '',
      model: 'claude-sonnet-4-5',
      bindings: [],
      permissionMode: 'default',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }];
    fakeStorage.__store.set(agentsKey('/foo'), seededAgents);
    fakeStorage.__store.set(agentFoldersKey('/foo'), { agents: ['team-a'], chats: ['inbox'] });

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
    });
    expect(getByTestId('agentIds').textContent).toBe('a1');
    expect(getByTestId('folders.agents').textContent).toBe('team-a');
    expect(getByTestId('folders.chats').textContent).toBe('inbox');
  });

  it('mounts with workspacePath=null → state stays empty, isLoaded false, no scoped reads', async () => {
    const { getByTestId } = render(
      <Harness initialPath={null}>
        <StateProbe />
      </Harness>,
    );

    // Give effects a chance to flush.
    await act(async () => { await Promise.resolve(); });

    expect(getByTestId('isLoaded').textContent).toBe('false');
    expect(getByTestId('agentIds').textContent).toBe('');

    // No scoped get for any of the workspace keys.
    const calls = fakeStorage.get.mock.calls.map(c => c[0]);
    expect(calls.some((k: string) => k.startsWith('agents:'))).toBe(false);
    expect(calls.some((k: string) => k.startsWith('agent-sessions:'))).toBe(false);
    expect(calls.some((k: string) => k.startsWith('agent-folders:'))).toBe(false);
  });

  it('workspace switch /foo → /bar: /foo state cleared, /bar scoped keys load, /bar gets its own data', async () => {
    fakeStorage.__store.set(agentsKey('/foo'), [{
      id: 'foo-1', name: 'Foo', kind: 'agent', systemPrompt: '', model: 'claude-sonnet-4-5',
      bindings: [], permissionMode: 'default',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }]);
    fakeStorage.__store.set(agentsKey('/bar'), [{
      id: 'bar-1', name: 'Bar', kind: 'agent', systemPrompt: '', model: 'claude-sonnet-4-5',
      bindings: [], permissionMode: 'default',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }]);

    let api: { setPath: (p: string | null) => void } | null = null;
    const { getByTestId } = render(
      <Harness initialPath="/foo" onReady={a => { api = a; }}>
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
      expect(getByTestId('agentIds').textContent).toBe('foo-1');
    });

    expect(api).not.toBeNull();
    await act(async () => {
      api!.setPath('/bar');
    });

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
      expect(getByTestId('agentIds').textContent).toBe('bar-1');
    });

    // Confirm that during the switch, /foo's data was not overwritten with
    // /bar's data, and /bar's data was not overwritten with empty.
    expect(fakeStorage.__store.get(agentsKey('/foo'))).toEqual([
      expect.objectContaining({ id: 'foo-1' }),
    ]);
    expect(fakeStorage.__store.get(agentsKey('/bar'))).toEqual([
      expect.objectContaining({ id: 'bar-1' }),
    ]);
  });

  it('rapid workspace switch /foo → /bar → /foo before initial load completes: latest path wins', async () => {
    fakeStorage.__store.set(agentsKey('/foo'), [{
      id: 'foo-1', name: 'Foo', kind: 'agent', systemPrompt: '', model: 'claude-sonnet-4-5',
      bindings: [], permissionMode: 'default',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }]);
    fakeStorage.__store.set(agentsKey('/bar'), [{
      id: 'bar-1', name: 'Bar', kind: 'agent', systemPrompt: '', model: 'claude-sonnet-4-5',
      bindings: [], permissionMode: 'default',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }]);

    let api: { setPath: (p: string | null) => void } | null = null;
    const { getByTestId } = render(
      <Harness initialPath="/foo" onReady={a => { api = a; }}>
        <StateProbe />
      </Harness>,
    );

    // Synchronously rapid-fire switches before any load resolves.
    await act(async () => {
      api!.setPath('/bar');
      api!.setPath('/foo');
    });

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
      expect(getByTestId('agentIds').textContent).toBe('foo-1');
    });
  });

  it('upsertAgent before isLoaded does NOT trigger a save (no empty-write to new workspace key)', async () => {
    // Slow the get so we can observe the pre-load state.
    let resolveAgents: ((v: unknown) => void) | null = null;
    fakeStorage.get.mockImplementation((key: string) => {
      if (key === agentsKey('/slow')) {
        return new Promise(res => { resolveAgents = res; });
      }
      return Promise.resolve(fakeStorage.__store.has(key) ? fakeStorage.__store.get(key) : null);
    });

    const { getByTestId } = render(
      <Harness initialPath="/slow">
        <StateProbe />
        <ActionsProbe />
      </Harness>,
    );

    // Wait until probe sees isLoaded=false. Until the get resolves, no save
    // should have fired regardless of any state mutation we trigger.
    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('false');
    });

    // Snapshot set-call count before triggering an upsert that would normally
    // produce a save.
    const setCallsBefore = fakeStorage.set.mock.calls.length;

    expect(actionsApi).not.toBeNull();
    await act(async () => {
      actionsApi!.upsertAgent('pre-load');
    });

    // No additional saves since we're still not isLoaded.
    expect(fakeStorage.set.mock.calls.length).toBe(setCallsBefore);

    // Now release the load.
    await act(async () => {
      resolveAgents!(null);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
    });

    // Critically, the agentsKey('/slow') key was NOT set with an empty array
    // during the pre-load window — only after isLoaded became true.
    const setCallsDuringPreload = fakeStorage.set.mock.calls.slice(0, setCallsBefore);
    const preloadAgentsWrites = setCallsDuringPreload.filter(c => c[0] === agentsKey('/slow'));
    expect(preloadAgentsWrites).toEqual([]);
  });

  it('workspace switch kills active session handles and does not destroy previous workspace data', async () => {
    // Simulate a previous workspace having sessions persisted. The session
    // map is loaded from storage; on workspace switch the in-memory state is
    // cleared and the previous workspace's storage record must NOT be
    // overwritten by the empty-clear (the !isLoaded guard on the save effect).
    fakeStorage.__store.set(agentSessionsKey('/foo'), {
      'a1': { agentId: 'a1', messages: [], updatedAt: '2026-01-01T00:00:00Z' },
    });

    let api: { setPath: (p: string | null) => void } | null = null;
    const { getByTestId } = render(
      <Harness initialPath="/foo" onReady={a => { api = a; }}>
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
    });

    // Switch — sessions for /foo should be cleared from memory, then /bar
    // loads its own (empty) sessions. The /foo sessions in storage MUST
    // remain intact.
    await act(async () => { api!.setPath('/bar'); });

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
    });

    // /foo's session data in storage was not destroyed by the switch.
    expect(fakeStorage.__store.get(agentSessionsKey('/foo'))).toEqual({
      'a1': expect.objectContaining({ agentId: 'a1' }),
    });
  });

  it('migration: opening /foo for first time copies globals into agents:/foo and clears globals', async () => {
    // Clear the flag this test set in beforeEach.
    fakeStorage.__store.delete(migrationFlagKey());
    fakeStorage.__store.set('agents', [{
      id: 'legacy-1', name: 'Legacy', kind: 'agent', systemPrompt: '', model: 'claude-sonnet-4-5',
      bindings: [], permissionMode: 'default',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }]);

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
      expect(getByTestId('agentIds').textContent).toBe('legacy-1');
    });

    expect(fakeStorage.__store.get(agentsKey('/foo'))).toEqual([
      expect.objectContaining({ id: 'legacy-1' }),
    ]);
    expect(fakeStorage.__store.has('agents')).toBe(false);
    expect(fakeStorage.__store.get(migrationFlagKey())).toBe(true);
  });

  it('error path: storage.get rejects on a scoped key → isLoaded still flips to true, state stays empty', async () => {
    fakeStorage.get.mockImplementation(async (key: string) => {
      if (key === agentsKey('/foo')) throw new Error('boom');
      return fakeStorage.__store.has(key) ? fakeStorage.__store.get(key) : null;
    });

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
    });

    expect(getByTestId('agentIds').textContent).toBe('');
  });
});
