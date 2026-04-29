import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory fake for the storageService module. Defined inside the factory
// so vi.mock's hoisting can reach it; the test then imports the same module
// to inspect/reset state.
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
    __reset: () => {
      store.clear();
    },
  };
  return { default: fake, isElectronRuntime: () => false };
});

import storageService from '../services/storageService';
import {
  agentsKey,
  agentSessionsKey,
  agentFoldersKey,
  reposKey,
  migrationFlagKey,
} from '../services/workspaceKeys';
import { migrateGlobalKeysIfNeeded } from '../services/workspaceKeysMigration';

// Cast so we can poke the test-only fields on the mocked module.
const fakeStorage = storageService as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  __store: Map<string, unknown>;
  __reset: () => void;
};

describe('workspaceKeys helpers', () => {
  it('agentsKey concatenates base with workspace path', () => {
    expect(agentsKey('/Users/iago/foo')).toBe('agents:/Users/iago/foo');
  });

  it('agentSessionsKey concatenates base with workspace path', () => {
    expect(agentSessionsKey('/Users/iago/foo')).toBe('agent-sessions:/Users/iago/foo');
  });

  it('agentFoldersKey concatenates base with workspace path', () => {
    expect(agentFoldersKey('/Users/iago/foo')).toBe('agent-folders:/Users/iago/foo');
  });

  it('reposKey concatenates base with workspace path', () => {
    expect(reposKey('/Users/iago/foo')).toBe('repos:/Users/iago/foo');
  });

  it('migrationFlagKey returns the v1 constant', () => {
    expect(migrationFlagKey()).toBe('migration:agents-workspace-scoped:v1');
  });

  it('strips a single trailing slash from the workspace path', () => {
    expect(agentsKey('/foo/')).toBe('agents:/foo');
    expect(reposKey('/foo/')).toBe('repos:/foo');
  });

  it('strips multiple trailing slashes', () => {
    expect(agentsKey('/foo///')).toBe('agents:/foo');
  });

  it('does not collapse internal slashes or alter case', () => {
    expect(agentsKey('/Foo//Bar/Baz')).toBe('agents:/Foo//Bar/Baz');
  });
});

describe('migrateGlobalKeysIfNeeded', () => {
  beforeEach(() => {
    fakeStorage.__reset();
    fakeStorage.get.mockClear();
    fakeStorage.set.mockClear();
  });

  it('happy path: copies non-empty globals into scoped keys, clears globals, sets flag', async () => {
    fakeStorage.__store.set('agents', [{ id: 'a1' }]);
    fakeStorage.__store.set('agent-sessions', [{ agentId: 'a1', claudeSessionId: 'c1' }]);
    fakeStorage.__store.set('agent-folders', [{ id: 'f1', name: 'folder' }]);
    fakeStorage.__store.set('repos', [{ id: 'r1' }]);

    await migrateGlobalKeysIfNeeded('/workspace/foo');

    expect(fakeStorage.__store.get(agentsKey('/workspace/foo'))).toEqual([{ id: 'a1' }]);
    expect(fakeStorage.__store.get(agentSessionsKey('/workspace/foo'))).toEqual([
      { agentId: 'a1', claudeSessionId: 'c1' },
    ]);
    expect(fakeStorage.__store.get(agentFoldersKey('/workspace/foo'))).toEqual([
      { id: 'f1', name: 'folder' },
    ]);
    expect(fakeStorage.__store.get(reposKey('/workspace/foo'))).toEqual([{ id: 'r1' }]);

    expect(fakeStorage.__store.has('agents')).toBe(false);
    expect(fakeStorage.__store.has('agent-sessions')).toBe(false);
    expect(fakeStorage.__store.has('agent-folders')).toBe(false);
    expect(fakeStorage.__store.has('repos')).toBe(false);

    expect(fakeStorage.__store.get(migrationFlagKey())).toBe(true);
  });

  it('flag present: migration is a no-op even when globals exist', async () => {
    fakeStorage.__store.set(migrationFlagKey(), true);
    fakeStorage.__store.set('agents', [{ id: 'orphan' }]);
    fakeStorage.__store.set('repos', [{ id: 'orphan-repo' }]);

    await migrateGlobalKeysIfNeeded('/workspace/foo');

    // Globals untouched (treated as user-orphaned data, not auto-migrated).
    expect(fakeStorage.__store.get('agents')).toEqual([{ id: 'orphan' }]);
    expect(fakeStorage.__store.get('repos')).toEqual([{ id: 'orphan-repo' }]);
    // Scoped keys not written.
    expect(fakeStorage.__store.has(agentsKey('/workspace/foo'))).toBe(false);
    expect(fakeStorage.__store.has(reposKey('/workspace/foo'))).toBe(false);
    // No `set` calls at all (only the flag-read).
    expect(fakeStorage.set).not.toHaveBeenCalled();
  });

  it('globals empty/null: sets flag and exits cleanly without copy writes', async () => {
    // No globals seeded — all reads return null.
    await migrateGlobalKeysIfNeeded('/workspace/foo');

    expect(fakeStorage.__store.get(migrationFlagKey())).toBe(true);
    expect(fakeStorage.__store.has(agentsKey('/workspace/foo'))).toBe(false);
    expect(fakeStorage.__store.has(agentSessionsKey('/workspace/foo'))).toBe(false);
    expect(fakeStorage.__store.has(agentFoldersKey('/workspace/foo'))).toBe(false);
    expect(fakeStorage.__store.has(reposKey('/workspace/foo'))).toBe(false);

    // Only the flag write should have happened (one set call).
    expect(fakeStorage.set).toHaveBeenCalledTimes(1);
    expect(fakeStorage.set).toHaveBeenCalledWith(migrationFlagKey(), true);
  });

  it('treats empty arrays and empty objects as empty (no copy)', async () => {
    fakeStorage.__store.set('agents', []);
    fakeStorage.__store.set('agent-sessions', {});
    fakeStorage.__store.set('agent-folders', []);
    fakeStorage.__store.set('repos', []);

    await migrateGlobalKeysIfNeeded('/workspace/foo');

    expect(fakeStorage.__store.has(agentsKey('/workspace/foo'))).toBe(false);
    expect(fakeStorage.__store.has(reposKey('/workspace/foo'))).toBe(false);
    expect(fakeStorage.__store.get(migrationFlagKey())).toBe(true);
  });

  it('scoped keys already have data and globals also non-empty: globals NOT overwritten, flag set, globals cleared', async () => {
    fakeStorage.__store.set(agentsKey('/workspace/foo'), [{ id: 'scoped-keep' }]);
    fakeStorage.__store.set(reposKey('/workspace/foo'), [{ id: 'scoped-keep-repo' }]);
    fakeStorage.__store.set('agents', [{ id: 'should-not-overwrite' }]);
    fakeStorage.__store.set('repos', [{ id: 'should-not-overwrite-repo' }]);

    await migrateGlobalKeysIfNeeded('/workspace/foo');

    // Scoped data preserved.
    expect(fakeStorage.__store.get(agentsKey('/workspace/foo'))).toEqual([{ id: 'scoped-keep' }]);
    expect(fakeStorage.__store.get(reposKey('/workspace/foo'))).toEqual([
      { id: 'scoped-keep-repo' },
    ]);
    // Globals cleared.
    expect(fakeStorage.__store.has('agents')).toBe(false);
    expect(fakeStorage.__store.has('repos')).toBe(false);
    // Flag set.
    expect(fakeStorage.__store.get(migrationFlagKey())).toBe(true);
  });

  it('trailing-slash and non-trailing-slash workspace paths produce the same scoped key', async () => {
    // First migration with trailing-slash path.
    fakeStorage.__store.set('agents', [{ id: 'shared' }]);

    await migrateGlobalKeysIfNeeded('/workspace/foo/');

    // Both forms read from the same scoped key after normalization.
    expect(fakeStorage.__store.get(agentsKey('/workspace/foo'))).toEqual([{ id: 'shared' }]);
    expect(fakeStorage.__store.get(agentsKey('/workspace/foo/'))).toEqual([{ id: 'shared' }]);
    expect(agentsKey('/workspace/foo')).toBe(agentsKey('/workspace/foo/'));
  });

  it('idempotent: running twice with the flag set does not re-migrate', async () => {
    fakeStorage.__store.set('agents', [{ id: 'a1' }]);

    await migrateGlobalKeysIfNeeded('/workspace/foo');
    // Second call: even if some new global appeared, the flag short-circuits.
    fakeStorage.__store.set('agents', [{ id: 'late-arrival' }]);
    fakeStorage.set.mockClear();
    await migrateGlobalKeysIfNeeded('/workspace/foo');

    // The late-arrival global was untouched and not migrated into the
    // scoped key.
    expect(fakeStorage.__store.get('agents')).toEqual([{ id: 'late-arrival' }]);
    expect(fakeStorage.__store.get(agentsKey('/workspace/foo'))).toEqual([{ id: 'a1' }]);
    expect(fakeStorage.set).not.toHaveBeenCalled();
  });

  it('single-shot: a second workspace opened after migration receives no data', async () => {
    fakeStorage.__store.set('agents', [{ id: 'first-only' }]);

    await migrateGlobalKeysIfNeeded('/workspace/foo');
    await migrateGlobalKeysIfNeeded('/workspace/bar');

    expect(fakeStorage.__store.get(agentsKey('/workspace/foo'))).toEqual([{ id: 'first-only' }]);
    expect(fakeStorage.__store.has(agentsKey('/workspace/bar'))).toBe(false);
  });
});
