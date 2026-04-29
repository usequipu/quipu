import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import type { AgentImageAttachment } from '@/types/agent';

// In-memory storage fake. Mirrors the harness from AgentContext.test.tsx so
// the AgentProvider load path resolves cleanly without poking real IPC.
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

vi.mock('../services/agentRuntime', () => {
  return {
    isElectronAgentRuntime: () => false,
    startSession: vi.fn(),
  };
});

import storageService from '../services/storageService';
import { migrationFlagKey } from '../services/workspaceKeys';
import { AgentProvider, useAgent, type AgentDraft } from '../context/AgentContext';

const fakeStorage = storageService as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  __store: Map<string, unknown>;
  __reset: () => void;
};

interface DraftsApi {
  getDraft: (id: string) => AgentDraft;
  setDraft: (id: string, patch: Partial<AgentDraft>) => void;
  upsertAgent: (id: string) => void;
  deleteAgent: (id: string) => void;
}

let api: DraftsApi | null = null;

function ApiProbe() {
  const ctx = useAgent();
  React.useEffect(() => {
    api = {
      getDraft: ctx.getDraft,
      setDraft: ctx.setDraft,
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
      deleteAgent: (id: string) => ctx.deleteAgent(id),
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

const img = (id: string): AgentImageAttachment => ({
  id,
  mediaType: 'image/png',
  base64: 'AAAA',
  name: `${id}.png`,
});

beforeEach(() => {
  fakeStorage.__reset();
  fakeStorage.get.mockClear();
  fakeStorage.set.mockClear();
  api = null;
  currentWorkspacePath = '/foo';
  // Skip migration noise — most draft tests don't care about workspace storage.
  fakeStorage.__store.set(migrationFlagKey(), true);
});

async function renderProvider() {
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

describe('AgentContext drafts', () => {
  it('returns the empty default for an unknown agent id', async () => {
    await renderProvider();
    const d = api!.getDraft('nope');
    expect(d.input).toBe('');
    expect(d.attachments).toEqual([]);
  });

  it('returns the SAME empty-default reference across calls (stable for memoization)', async () => {
    await renderProvider();
    const a = api!.getDraft('agent-x');
    const b = api!.getDraft('agent-y');
    // Both unknown agents must share the stable empty default; otherwise any
    // consumer using the returned draft as an effect dep would re-fire on every
    // render.
    expect(a).toBe(b);
  });

  it('happy path: setDraft on A then getDraft on A returns A; getDraft on B is empty', async () => {
    await renderProvider();
    await act(async () => {
      api!.setDraft('A', { input: 'hello A' });
    });
    expect(api!.getDraft('A')).toEqual({ input: 'hello A', attachments: [] });
    expect(api!.getDraft('B')).toEqual({ input: '', attachments: [] });
  });

  it('preserves both agents independently when text is set on each', async () => {
    await renderProvider();
    await act(async () => {
      api!.setDraft('A', { input: 'draft for A' });
      api!.setDraft('B', { input: 'draft for B' });
    });
    expect(api!.getDraft('A').input).toBe('draft for A');
    expect(api!.getDraft('B').input).toBe('draft for B');
  });

  it('merges patches: setting input then attachments preserves both', async () => {
    await renderProvider();
    await act(async () => {
      api!.setDraft('A', { input: 'partial' });
      api!.setDraft('A', { attachments: [img('p1')] });
    });
    const d = api!.getDraft('A');
    expect(d.input).toBe('partial');
    expect(d.attachments).toHaveLength(1);
    expect(d.attachments[0].id).toBe('p1');
  });

  it('clearing both fields removes the entry (returns the empty default)', async () => {
    await renderProvider();
    await act(async () => {
      api!.setDraft('A', { input: 'something' });
    });
    expect(api!.getDraft('A').input).toBe('something');

    await act(async () => {
      api!.setDraft('A', { input: '', attachments: [] });
    });
    // Cleared draft falls back to the stable empty default.
    expect(api!.getDraft('A')).toBe(api!.getDraft('B'));
  });

  it('attachments only (no text): set, retrieve, clear, all behave', async () => {
    await renderProvider();
    await act(async () => {
      api!.setDraft('A', { attachments: [img('att-1'), img('att-2')] });
    });
    const d = api!.getDraft('A');
    expect(d.input).toBe('');
    expect(d.attachments.map(a => a.id)).toEqual(['att-1', 'att-2']);

    await act(async () => {
      api!.setDraft('A', { attachments: [] });
    });
    // Empty attachments + empty input -> entry removed.
    expect(api!.getDraft('A')).toBe(api!.getDraft('unknown'));
  });

  it('deleting an agent drops its draft entry', async () => {
    await renderProvider();
    await act(async () => {
      api!.upsertAgent('A');
      api!.setDraft('A', { input: 'about to be deleted' });
    });
    expect(api!.getDraft('A').input).toBe('about to be deleted');

    await act(async () => {
      api!.deleteAgent('A');
    });
    // After delete, the draft is gone — the empty default is returned again.
    expect(api!.getDraft('A')).toBe(api!.getDraft('unknown'));
  });

  it('deleting an agent that has only attachment drafts also drops them', async () => {
    await renderProvider();
    await act(async () => {
      api!.upsertAgent('A');
      api!.setDraft('A', { attachments: [img('only-att')] });
    });
    expect(api!.getDraft('A').attachments).toHaveLength(1);

    await act(async () => {
      api!.deleteAgent('A');
    });
    expect(api!.getDraft('A').attachments).toHaveLength(0);
  });

  it('integration: simulated tab-switch flow — type in A, switch to B (empty), switch back to A (restored)', async () => {
    await renderProvider();
    // Mount of ChatView for A: seed from getDraft('A') -> empty.
    let aSeed = api!.getDraft('A');
    expect(aSeed.input).toBe('');

    // Type "hello" — ChatView's onChange fires setDraft eagerly.
    await act(async () => {
      api!.setDraft('A', { input: 'hello' });
    });

    // Switch to B: ChatView's agentId effect re-seeds from getDraft('B').
    let bSeed = api!.getDraft('B');
    expect(bSeed.input).toBe('');

    // Type something in B.
    await act(async () => {
      api!.setDraft('B', { input: 'B draft' });
    });

    // Switch back to A: re-seed from getDraft('A') — original text is back.
    aSeed = api!.getDraft('A');
    expect(aSeed.input).toBe('hello');

    // And B is still preserved if we go back.
    bSeed = api!.getDraft('B');
    expect(bSeed.input).toBe('B draft');
  });
});
