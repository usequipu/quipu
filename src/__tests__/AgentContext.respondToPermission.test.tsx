import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import type { AgentMessage, AgentPermissionRequest } from '@/types/agent';

// Reuse the storage fake pattern from the other AgentContext tests.
vi.mock('../services/storageService', () => {
  const store = new Map<string, unknown>();
  const fake = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      if (value === null || value === undefined) store.delete(key);
      else store.set(key, value);
    }),
    __store: store,
    __reset: () => { store.clear(); },
  };
  return { default: fake, isElectronRuntime: () => false };
});

let currentWorkspacePath: string | null = '/foo';

vi.mock('../context/FileSystemContext', () => ({
  useFileSystem: () => ({ workspacePath: currentWorkspacePath }),
}));

vi.mock('../context/RepoContext', () => ({
  useRepo: () => ({
    cloneRepoForAgent: vi.fn(async () => '/fake/clone'),
    repos: [],
  }),
}));

vi.mock('../context/TabContext', () => ({
  useTab: () => ({ renameTabsByPath: vi.fn() }),
}));

const showToast = vi.fn();
vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ showToast }),
}));

// Stub the agentRuntime module: pretend Electron is available, and have
// startSession return a handle whose respondToPermission we can spy on.
const respondToPermissionSpy = vi.fn();
const startSessionSpy = vi.fn(async () => ({
  sessionKey: 'sk-1',
  sendUserMessage: vi.fn(),
  respondToPermission: respondToPermissionSpy,
  stop: vi.fn(async () => {}),
}));
vi.mock('../services/agentRuntime', () => ({
  isElectronAgentRuntime: () => true,
  startSession: () => startSessionSpy(),
}));

import storageService from '../services/storageService';
import { migrationFlagKey, agentSessionsKey } from '../services/workspaceKeys';
import { AgentProvider, useAgent } from '../context/AgentContext';

const fakeStorage = storageService as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  __store: Map<string, unknown>;
  __reset: () => void;
};

interface ApiHandle {
  respondToPermission: ReturnType<typeof useAgent>['respondToPermission'];
  resumeSession: ReturnType<typeof useAgent>['resumeSession'];
  upsertAgent: ReturnType<typeof useAgent>['upsertAgent'];
}

let api: ApiHandle | null = null;

function ApiProbe() {
  const ctx = useAgent();
  React.useEffect(() => {
    api = {
      respondToPermission: ctx.respondToPermission,
      resumeSession: ctx.resumeSession,
      upsertAgent: ctx.upsertAgent,
    };
  });
  return <div data-testid="isLoaded">{String(ctx.isLoaded)}</div>;
}

function Harness({ children }: { children: React.ReactNode }) {
  const [path] = useState<string | null>('/foo');
  currentWorkspacePath = path;
  return <AgentProvider>{children}</AgentProvider>;
}

const AGENT_ID = 'agent-1';
const MESSAGE_ID = 'msg-1';

function seedAgentAndPendingRequest() {
  // Pre-seed agents storage so the AgentProvider load resolves with this
  // agent already in memory; pre-seed sessions with a pending permission
  // request keyed to MESSAGE_ID.
  fakeStorage.__store.set(`agents:/foo`, [{
    id: AGENT_ID,
    name: 'Test agent',
    kind: 'agent',
    systemPrompt: '',
    model: 'claude-sonnet-4-5',
    bindings: [],
    permissionMode: 'default',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }]);
  const pendingReq: AgentPermissionRequest = {
    toolUseId: 'tu-1',
    toolName: 'AskUserQuestion',
    action: 'AskUserQuestion',
    input: { questions: [{ question: 'Q', options: [{ label: 'A' }] }] },
    status: 'pending',
  };
  const msg: AgentMessage = {
    id: MESSAGE_ID,
    role: 'permission-request',
    body: '',
    createdAt: '2026-01-01T00:00:00Z',
    permissionRequest: pendingReq,
  };
  fakeStorage.__store.set(agentSessionsKey('/foo'), {
    [AGENT_ID]: {
      agentId: AGENT_ID,
      messages: [msg],
      updatedAt: '2026-01-01T00:00:00Z',
    },
  });
}

async function renderAndWaitLoaded() {
  const renderResult = render(
    <Harness>
      <ApiProbe />
    </Harness>,
  );
  await waitFor(() => {
    expect(renderResult.getByTestId('isLoaded').textContent).toBe('true');
  });
  // Warm up the Claude session handle so respondToPermission can forward.
  await act(async () => {
    await api!.resumeSession(AGENT_ID);
  });
  return renderResult;
}

beforeEach(() => {
  fakeStorage.__reset();
  fakeStorage.get.mockClear();
  fakeStorage.set.mockClear();
  respondToPermissionSpy.mockClear();
  startSessionSpy.mockClear();
  showToast.mockClear();
  currentWorkspacePath = '/foo';
  api = null;
  fakeStorage.__store.set(migrationFlagKey(), true);
});

describe('AgentContext.respondToPermission — extended opts', () => {
  it('forwards { message } to the runtime handle on deny', async () => {
    seedAgentAndPendingRequest();
    await renderAndWaitLoaded();
    expect(startSessionSpy).toHaveBeenCalled();

    const payload = JSON.stringify({ answers: [{ question: 'Q', answer: 'A' }] });
    await act(async () => {
      api!.respondToPermission(AGENT_ID, MESSAGE_ID, 'deny', { message: payload });
    });

    expect(respondToPermissionSpy).toHaveBeenCalledTimes(1);
    expect(respondToPermissionSpy).toHaveBeenCalledWith('tu-1', 'deny', { message: payload });
  });

  it('forwards { updatedInput } to the runtime handle on allow', async () => {
    seedAgentAndPendingRequest();
    await renderAndWaitLoaded();

    await act(async () => {
      api!.respondToPermission(AGENT_ID, MESSAGE_ID, 'allow', { updatedInput: { foo: 'bar' } });
    });

    expect(respondToPermissionSpy).toHaveBeenCalledTimes(1);
    expect(respondToPermissionSpy).toHaveBeenCalledWith('tu-1', 'allow', { updatedInput: { foo: 'bar' } });
  });

  it('omits opts entirely when caller does not pass them (legacy behavior preserved)', async () => {
    seedAgentAndPendingRequest();
    await renderAndWaitLoaded();

    await act(async () => {
      api!.respondToPermission(AGENT_ID, MESSAGE_ID, 'allow');
    });

    expect(respondToPermissionSpy).toHaveBeenCalledTimes(1);
    expect(respondToPermissionSpy).toHaveBeenCalledWith('tu-1', 'allow', undefined);
  });

  it('does nothing when the request is no longer pending (idempotent on double-click)', async () => {
    seedAgentAndPendingRequest();
    await renderAndWaitLoaded();

    // First click flips status to 'denied'.
    await act(async () => {
      api!.respondToPermission(AGENT_ID, MESSAGE_ID, 'deny', { message: 'x' });
    });
    expect(respondToPermissionSpy).toHaveBeenCalledTimes(1);

    // Second click on the same already-decided request is a no-op.
    await act(async () => {
      api!.respondToPermission(AGENT_ID, MESSAGE_ID, 'deny', { message: 'y' });
    });
    expect(respondToPermissionSpy).toHaveBeenCalledTimes(1);
  });
});
