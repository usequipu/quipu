import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

// In-memory storage fake. Defined inside vi.mock's factory so hoisting works,
// then re-imported below for inspection. Mirrors the pattern in
// AgentContext.test.tsx and RepoContext.test.tsx.
vi.mock('../services/storageService', () => {
  const store = new Map<string, unknown>();
  const fake = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      if (value === null || value === undefined) {
        store.delete(key);
      } else {
        // Clone arrays so callers reading back later don't see references
        // mutated by subsequent setters in another window.
        store.set(key, Array.isArray(value) ? [...value] : value);
      }
    }),
    __store: store,
    __reset: () => { store.clear(); },
  };
  return { default: fake, isElectronRuntime: () => false };
});

// Mock the file system service. FileSystemProvider's mount effect calls
// fs.readDirectory inside `validateAndPruneWorkspaces` for each entry; we
// resolve successfully so no entries are pruned during these tests.
vi.mock('../services/fileSystem', () => {
  return {
    default: {
      readDirectory: vi.fn(async () => []),
      openFolderDialog: vi.fn(async () => null),
      createFile: vi.fn(async () => ({ success: true })),
      createFolder: vi.fn(async () => ({ success: true })),
      deletePath: vi.fn(async () => ({ success: true })),
      renamePath: vi.fn(async () => ({ success: true })),
    },
  };
});

vi.mock('../services/claudeInstaller', () => {
  return {
    default: {
      installFrameSkills: vi.fn(async () => undefined),
    },
  };
});

vi.mock('../components/ui/Toast', () => {
  return {
    useToast: () => ({ showToast: vi.fn() }),
  };
});

import storageService from '../services/storageService';
import fsService from '../services/fileSystem';
import { FileSystemProvider, useFileSystem } from '../context/FileSystemContext';
import type { RecentWorkspace } from '../types/workspace';

const fakeStorage = storageService as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  __store: Map<string, unknown>;
  __reset: () => void;
};

const fakeFs = fsService as unknown as {
  readDirectory: ReturnType<typeof vi.fn>;
};

function makeRecent(path: string, name?: string): RecentWorkspace {
  return {
    path,
    name: name ?? path.split('/').filter(Boolean).pop() ?? path,
    lastOpened: '2026-01-01T00:00:00Z',
  };
}

interface ActionsApi {
  update: (folderPath: string) => Promise<void>;
  clear: () => Promise<void>;
  remove: (folderPath: string) => Promise<void>;
  selectFolder: (folderPath: string) => Promise<void>;
  getRecents: () => RecentWorkspace[];
}

function makeProbe(label: string, apiSink: { current: ActionsApi | null }) {
  return function ActionsProbe() {
    const ctx = useFileSystem();
    const recentsRef = React.useRef<RecentWorkspace[]>([]);
    recentsRef.current = ctx.recentWorkspaces;
    React.useEffect(() => {
      apiSink.current = {
        update: (p) => ctx.updateRecentWorkspaces(p),
        clear: () => ctx.clearRecentWorkspaces(),
        remove: (p) => ctx.removeFromRecentWorkspaces(p),
        selectFolder: (p) => ctx.selectFolder(p),
        getRecents: () => recentsRef.current,
      };
    });
    return (
      <div>
        <div data-testid={`recents:${label}`}>
          {ctx.recentWorkspaces.map(r => r.path).join(',')}
        </div>
      </div>
    );
  };
}

beforeEach(() => {
  fakeStorage.__reset();
  fakeStorage.get.mockClear();
  fakeStorage.set.mockClear();
  fakeFs.readDirectory.mockClear();
  fakeFs.readDirectory.mockImplementation(async () => []);
});

describe('FileSystemProvider per-window recentWorkspaces', () => {
  it('happy path: window mounts with stored [a, b], opens c → state [c, a, b], storage [c, a, b]', async () => {
    fakeStorage.__store.set('recentWorkspaces', [makeRecent('/a'), makeRecent('/b')]);

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);

    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/a,/b');
    });
    expect(apiRef.current).not.toBeNull();

    await act(async () => {
      await apiRef.current!.update('/c');
    });

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/c,/a,/b');
    });

    const stored = fakeStorage.__store.get('recentWorkspaces') as RecentWorkspace[];
    expect(stored.map(r => r.path)).toEqual(['/c', '/a', '/b']);
  });

  it('per-window contract: window 1 does not pick up window 2 writes after mount', async () => {
    // Both windows mount against the same shared storage with the same
    // initial snapshot.
    fakeStorage.__store.set('recentWorkspaces', [makeRecent('/a'), makeRecent('/b')]);

    const w1ApiRef: { current: ActionsApi | null } = { current: null };
    const W1Probe = makeProbe('w1', w1ApiRef);
    const win1 = render(
      <FileSystemProvider>
        <W1Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(win1.getByTestId('recents:w1').textContent).toBe('/a,/b');
    });

    // Window 1 opens /c. It writes [c, a, b] back to storage.
    await act(async () => {
      await w1ApiRef.current!.update('/c');
    });
    await waitFor(() => {
      expect(win1.getByTestId('recents:w1').textContent).toBe('/c,/a,/b');
    });

    // Window 2 mounts now — it reads storage once and sees [c, a, b].
    const w2ApiRef: { current: ActionsApi | null } = { current: null };
    const W2Probe = makeProbe('w2', w2ApiRef);
    const win2 = render(
      <FileSystemProvider>
        <W2Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(win2.getByTestId('recents:w2').textContent).toBe('/c,/a,/b');
    });

    // Window 2 opens /d. Its state and storage become [d, c, a, b].
    await act(async () => {
      await w2ApiRef.current!.update('/d');
    });

    await waitFor(() => {
      expect(win2.getByTestId('recents:w2').textContent).toBe('/d,/c,/a,/b');
    });

    // Storage now reflects window 2's last write.
    const stored = fakeStorage.__store.get('recentWorkspaces') as RecentWorkspace[];
    expect(stored.map(r => r.path)).toEqual(['/d', '/c', '/a', '/b']);

    // CRITICAL: window 1 still reflects ONLY its own additions atop the
    // snapshot at its mount time. It does NOT re-read from storage to pick
    // up /d. This is the per-window contract.
    expect(win1.getByTestId('recents:w1').textContent).toBe('/c,/a,/b');
  });

  it('clearRecentWorkspaces in window 1 does not clear window 2\'s in-memory list', async () => {
    fakeStorage.__store.set('recentWorkspaces', [makeRecent('/a'), makeRecent('/b')]);

    const w1ApiRef: { current: ActionsApi | null } = { current: null };
    const W1Probe = makeProbe('w1', w1ApiRef);
    const win1 = render(
      <FileSystemProvider>
        <W1Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(win1.getByTestId('recents:w1').textContent).toBe('/a,/b');
    });

    const w2ApiRef: { current: ActionsApi | null } = { current: null };
    const W2Probe = makeProbe('w2', w2ApiRef);
    const win2 = render(
      <FileSystemProvider>
        <W2Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(win2.getByTestId('recents:w2').textContent).toBe('/a,/b');
    });

    // Window 1 clears.
    await act(async () => {
      await w1ApiRef.current!.clear();
    });

    await waitFor(() => {
      expect(win1.getByTestId('recents:w1').textContent).toBe('');
    });

    // Window 2's in-memory list is unaffected — it only sees the clear if
    // it remounts. (Per-window contract: no reads after mount.)
    expect(win2.getByTestId('recents:w2').textContent).toBe('/a,/b');
  });

  it('removeFromRecentWorkspaces with a path not in local state is a no-op (no spurious storage write)', async () => {
    fakeStorage.__store.set('recentWorkspaces', [makeRecent('/a'), makeRecent('/b')]);

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);
    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/a,/b');
    });

    const setCallsBefore = fakeStorage.set.mock.calls.length;

    await act(async () => {
      await apiRef.current!.remove('/not-in-list');
    });

    // State unchanged.
    expect(getByTestId('recents:w1').textContent).toBe('/a,/b');
    // No new storage write fired.
    expect(fakeStorage.set.mock.calls.length).toBe(setCallsBefore);
  });

  it('updateRecentWorkspaces dedupes when the same path is added twice in a row', async () => {
    fakeStorage.__store.set('recentWorkspaces', [makeRecent('/a')]);

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);
    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/a');
    });

    await act(async () => {
      await apiRef.current!.update('/c');
    });
    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/c,/a');
    });

    await act(async () => {
      await apiRef.current!.update('/c');
    });
    // Re-adding /c should NOT create a duplicate — the new entry replaces
    // the old.
    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/c,/a');
    });

    const recents = apiRef.current!.getRecents();
    expect(recents.filter(r => r.path === '/c').length).toBe(1);
  });

  it('updateRecentWorkspaces enforces the 10-entry cap', async () => {
    // Pre-fill 10 entries.
    const initial = Array.from({ length: 10 }, (_, i) => makeRecent(`/p${i}`));
    fakeStorage.__store.set('recentWorkspaces', initial);

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);
    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe(initial.map(r => r.path).join(','));
    });

    // Add a new entry — the oldest should drop off.
    await act(async () => {
      await apiRef.current!.update('/new');
    });

    await waitFor(() => {
      const recents = apiRef.current!.getRecents();
      expect(recents.length).toBe(10);
      expect(recents[0].path).toBe('/new');
      // The last (oldest) entry /p9 should be evicted.
      expect(recents.some(r => r.path === '/p9')).toBe(false);
      // The previous head /p0 should still be present at index 1.
      expect(recents[1].path).toBe('/p0');
    });

    const stored = fakeStorage.__store.get('recentWorkspaces') as RecentWorkspace[];
    expect(stored.length).toBe(10);
  });

  it('integration: after selectFolder succeeds, the new entry appears at the top of local recents', async () => {
    fakeStorage.__store.set('recentWorkspaces', [makeRecent('/a'), makeRecent('/b')]);

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);
    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/a,/b');
    });

    await act(async () => {
      await apiRef.current!.selectFolder('/c');
    });

    // selectFolder calls updateRecentWorkspaces fire-and-forget. Wait for the
    // state to reflect the update.
    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/c,/a,/b');
    });
  });
});
