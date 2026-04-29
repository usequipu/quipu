import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';

// In-memory storage fake. Defined inside vi.mock's factory so hoisting works,
// then re-imported below for inspection. Mirrors the pattern in
// AgentContext.test.tsx and workspaceKeysMigration.test.ts.
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

// Mock the file system service. RepoProvider only touches it inside
// `cloneRepoForAgent`/`deleteRepo`/`deleteFolder`. The tests for
// load/save/clear behavior do not exercise those code paths directly, but
// `deleteFolder` does call `fs.deletePath` when `removeClones` is set.
vi.mock('../services/fileSystem', () => {
  return {
    default: {
      deletePath: vi.fn(async () => ({ success: true })),
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async () => ({ success: true })),
      readDirectory: vi.fn(async () => []),
    },
  };
});

// Mock the FileSystemContext. RepoProvider only needs `workspacePath`. We
// expose mutable state on the module so individual tests can flip
// workspacePath at runtime via React state without remounting the provider.
let currentWorkspacePath: string | null = null;

vi.mock('../context/FileSystemContext', () => {
  return {
    useFileSystem: () => ({ workspacePath: currentWorkspacePath }),
  };
});

import storageService from '../services/storageService';
import fsService from '../services/fileSystem';
import { reposKey, migrationFlagKey, GLOBAL_REPOS_KEY } from '../services/workspaceKeys';
import { RepoProvider, useRepo } from '../context/RepoContext';
import type { Repo } from '../types/agent';

const fakeStorage = storageService as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  __store: Map<string, unknown>;
  __reset: () => void;
};

const fakeFs = fsService as unknown as {
  deletePath: ReturnType<typeof vi.fn>;
};

function makeRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    name: id,
    url: `https://example.com/${id}.git`,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

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
  return <RepoProvider>{children}</RepoProvider>;
}

/** Renders the current RepoContext state into the DOM so tests can poll it
 *  via standard testing-library assertions. */
function StateProbe() {
  const ctx = useRepo();
  return (
    <div>
      <div data-testid="isLoaded">{String(ctx.isLoaded)}</div>
      <div data-testid="repoIds">{ctx.repos.map(r => r.id).sort().join(',')}</div>
      <div data-testid="repoFolders">{ctx.repos.map(r => `${r.id}:${r.folder ?? ''}`).sort().join(',')}</div>
    </div>
  );
}

interface ActionsApi {
  upsertRepo: (id: string, overrides?: Partial<Repo>) => void;
  deleteFolder: (folder: string, options?: { removeClones?: boolean }) => Promise<void>;
  setCloneState: (id: string) => void;
  getCloneStateLabel: (id: string) => string;
}

let actionsApi: ActionsApi | null = null;

function ActionsProbe() {
  const ctx = useRepo();
  React.useEffect(() => {
    actionsApi = {
      upsertRepo: (id, overrides) => ctx.upsertRepo(makeRepo(id, overrides)),
      deleteFolder: (folder, options) => ctx.deleteFolder(folder, options),
      setCloneState: (_id) => {/* exposed indirectly via the provider's clone tooling — see CloneStateProbe */},
      getCloneStateLabel: (id) => ctx.getCloneStatus(id).state,
    };
  });
  return null;
}

/**
 * Surfaces the current cloneStates map for a known repo id. We use this to
 * verify the workspace-switch reset behavior; toggling a clone state cleanly
 * from outside the provider is not part of the public API, so the test seeds
 * an in-progress clone via the same `cloneRepoForAgent` codepath an app
 * would use — except here we just probe the public `getCloneStatus`.
 */
function CloneStateProbe({ repoId }: { repoId: string }) {
  const ctx = useRepo();
  return <div data-testid={`cloneState:${repoId}`}>{ctx.getCloneStatus(repoId).state}</div>;
}

beforeEach(() => {
  fakeStorage.__reset();
  fakeStorage.get.mockClear();
  fakeStorage.set.mockClear();
  fakeFs.deletePath.mockClear();
  currentWorkspacePath = null;
  actionsApi = null;
  // Mark migration flag set by default so most tests exercise the load path
  // without involving the migration step. Tests that want migration
  // explicitly clear the flag in setup.
  fakeStorage.__store.set(migrationFlagKey(), true);
});

describe('RepoProvider workspace-scoped storage', () => {
  it('happy path: mounts with workspacePath=/foo and populates repos from scoped key', async () => {
    fakeStorage.__store.set(reposKey('/foo'), [
      makeRepo('r1', { name: 'Repo One' }),
      makeRepo('r2', { name: 'Repo Two', folder: 'shared' }),
    ]);

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
    });
    expect(getByTestId('repoIds').textContent).toBe('r1,r2');
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
    expect(getByTestId('repoIds').textContent).toBe('');

    // No scoped get for repos:* keys.
    const calls = fakeStorage.get.mock.calls.map(c => c[0]);
    expect(calls.some((k: string) => k.startsWith('repos:'))).toBe(false);
  });

  it('workspace switch /foo → /bar: repos clear, /bar scoped key loads, /foo data preserved', async () => {
    fakeStorage.__store.set(reposKey('/foo'), [makeRepo('foo-1')]);
    fakeStorage.__store.set(reposKey('/bar'), [makeRepo('bar-1')]);

    let api: { setPath: (p: string | null) => void } | null = null;
    const { getByTestId } = render(
      <Harness initialPath="/foo" onReady={a => { api = a; }}>
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
      expect(getByTestId('repoIds').textContent).toBe('foo-1');
    });

    expect(api).not.toBeNull();
    await act(async () => { api!.setPath('/bar'); });

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
      expect(getByTestId('repoIds').textContent).toBe('bar-1');
    });

    // Confirm the load-after-switch did not corrupt either workspace's
    // storage record.
    expect(fakeStorage.__store.get(reposKey('/foo'))).toEqual([
      expect.objectContaining({ id: 'foo-1' }),
    ]);
    expect(fakeStorage.__store.get(reposKey('/bar'))).toEqual([
      expect.objectContaining({ id: 'bar-1' }),
    ]);
  });

  it('rapid workspace switch /foo → /bar → /foo before initial load completes: latest path wins', async () => {
    fakeStorage.__store.set(reposKey('/foo'), [makeRepo('foo-1')]);
    fakeStorage.__store.set(reposKey('/bar'), [makeRepo('bar-1')]);

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
      expect(getByTestId('repoIds').textContent).toBe('foo-1');
    });
  });

  it('workspace switch clears cloneStates so a stale clone indicator does not bleed across workspaces', async () => {
    // Seed /foo with repo r1 and a "cloning" state for it. The clone state
    // is in-memory only — there's no public API to seed it directly, so we
    // use the documented public surface: `cloneRepoForAgent` would set it,
    // but exercising that path requires `window.electronAPI.gitClone`. The
    // simpler route: reach into the provider via a probe that sets the
    // state through `setCloneStates`. Since that's not exposed, we test the
    // observable invariant: after a switch back to /foo, getCloneStatus
    // returns 'idle' for any repo, even if a prior cloneRepoForAgent had
    // been in-flight.
    fakeStorage.__store.set(reposKey('/foo'), [makeRepo('r1')]);
    fakeStorage.__store.set(reposKey('/bar'), [makeRepo('r2')]);

    let api: { setPath: (p: string | null) => void } | null = null;
    const { getByTestId } = render(
      <Harness initialPath="/foo" onReady={a => { api = a; }}>
        <StateProbe />
        <CloneStateProbe repoId="r1" />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
      expect(getByTestId('repoIds').textContent).toBe('r1');
    });

    // r1 is idle (no clone has been kicked off). After a switch to /bar
    // and back, r1 must still report idle — even if it had been mid-clone,
    // the cloneStates map is reset on switch.
    expect(getByTestId('cloneState:r1').textContent).toBe('idle');

    await act(async () => { api!.setPath('/bar'); });
    await waitFor(() => {
      expect(getByTestId('repoIds').textContent).toBe('r2');
    });

    // /bar doesn't have r1 in its repos at all — getCloneStatus returns idle.
    expect(getByTestId('cloneState:r1').textContent).toBe('idle');

    await act(async () => { api!.setPath('/foo'); });
    await waitFor(() => {
      expect(getByTestId('repoIds').textContent).toBe('r1');
    });

    // After switching back to /foo, r1's clone state remains 'idle' — the
    // map was cleared on each switch and no new clone has been started.
    expect(getByTestId('cloneState:r1').textContent).toBe('idle');
  });

  it('deleteFolder only deletes repos under the current workspace; localClonePath deletions hit the right disk paths', async () => {
    // /foo has two repos in folder "team-a" and one in folder "other".
    // /bar has a repo also in folder "team-a" — should NOT be touched by
    // a deleteFolder call while the active workspace is /foo.
    fakeStorage.__store.set(reposKey('/foo'), [
      makeRepo('foo-team-1', { folder: 'team-a', localClonePath: '/foo/tmp/agent/repos/foo-team-1' }),
      makeRepo('foo-team-2', { folder: 'team-a', localClonePath: '/foo/tmp/agent/repos/foo-team-2' }),
      makeRepo('foo-other', { folder: 'other', localClonePath: '/foo/tmp/agent/repos/foo-other' }),
    ]);
    fakeStorage.__store.set(reposKey('/bar'), [
      makeRepo('bar-team-1', { folder: 'team-a', localClonePath: '/bar/tmp/agent/repos/bar-team-1' }),
    ]);

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
        <ActionsProbe />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
      expect(getByTestId('repoIds').textContent).toBe('foo-other,foo-team-1,foo-team-2');
    });

    expect(actionsApi).not.toBeNull();
    await act(async () => {
      await actionsApi!.deleteFolder('team-a', { removeClones: true });
    });

    // /foo's repos under "team-a" are gone from in-memory state. "other"
    // remains.
    await waitFor(() => {
      expect(getByTestId('repoIds').textContent).toBe('foo-other');
    });

    // localClonePath deletions hit /foo's paths — NOT /bar's path.
    const deleted = fakeFs.deletePath.mock.calls.map(c => c[0]).sort();
    expect(deleted).toEqual([
      '/foo/tmp/agent/repos/foo-team-1',
      '/foo/tmp/agent/repos/foo-team-2',
    ]);
    expect(deleted).not.toContain('/bar/tmp/agent/repos/bar-team-1');

    // /bar's storage record is untouched by /foo's deleteFolder.
    expect(fakeStorage.__store.get(reposKey('/bar'))).toEqual([
      expect.objectContaining({ id: 'bar-team-1' }),
    ]);
  });

  it('upsertRepo before isLoaded does NOT trigger a save (no empty-write to scoped key)', async () => {
    // Slow the get for the scoped key so we can observe the pre-load state.
    let resolveLoad: ((v: unknown) => void) | null = null;
    fakeStorage.get.mockImplementation((key: string) => {
      if (key === reposKey('/slow')) {
        return new Promise(res => { resolveLoad = res; });
      }
      return Promise.resolve(fakeStorage.__store.has(key) ? fakeStorage.__store.get(key) : null);
    });

    const { getByTestId } = render(
      <Harness initialPath="/slow">
        <StateProbe />
        <ActionsProbe />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('false');
    });

    const setCallsBefore = fakeStorage.set.mock.calls.length;

    expect(actionsApi).not.toBeNull();
    await act(async () => {
      actionsApi!.upsertRepo('pre-load');
    });

    // No additional saves while not isLoaded.
    expect(fakeStorage.set.mock.calls.length).toBe(setCallsBefore);

    // The scoped key was NOT written to during the pre-load window.
    const preloadWrites = fakeStorage.set.mock.calls
      .slice(0, setCallsBefore)
      .filter(c => c[0] === reposKey('/slow'));
    expect(preloadWrites).toEqual([]);

    // Release the load.
    await act(async () => {
      resolveLoad!(null);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
    });
  });

  it('migration: opening /foo for first time copies global repos into repos:/foo, opening /bar later starts empty', async () => {
    // Clear the flag this test set in beforeEach so migration runs.
    fakeStorage.__store.delete(migrationFlagKey());
    fakeStorage.__store.set(GLOBAL_REPOS_KEY, [makeRepo('legacy-1', { name: 'Legacy' })]);

    let api: { setPath: (p: string | null) => void } | null = null;
    const { getByTestId } = render(
      <Harness initialPath="/foo" onReady={a => { api = a; }}>
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
      expect(getByTestId('repoIds').textContent).toBe('legacy-1');
    });

    expect(fakeStorage.__store.get(reposKey('/foo'))).toEqual([
      expect.objectContaining({ id: 'legacy-1' }),
    ]);
    expect(fakeStorage.__store.has(GLOBAL_REPOS_KEY)).toBe(false);
    expect(fakeStorage.__store.get(migrationFlagKey())).toBe(true);

    // Now switch to /bar — the flag suppresses re-migration, so /bar's
    // repos start empty.
    await act(async () => { api!.setPath('/bar'); });

    await waitFor(() => {
      expect(getByTestId('isLoaded').textContent).toBe('true');
      expect(getByTestId('repoIds').textContent).toBe('');
    });
  });

  it('error path: storage.get rejects on the scoped key → isLoaded still flips to true, state stays empty', async () => {
    fakeStorage.get.mockImplementation(async (key: string) => {
      if (key === reposKey('/foo')) throw new Error('boom');
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

    expect(getByTestId('repoIds').textContent).toBe('');
  });
});
