// One-shot migration of pre-workspace-scoped global storage keys into the
// first workspace the user opens after upgrading. After migration runs, a
// flag is written so subsequent calls (including for other workspaces) are
// no-ops — only the first workspace receives the data.
//
// The migration is intentionally conservative:
// - If a workspace-scoped key already has data, the corresponding global is
//   NOT copied on top of it. The flag is still set and the global is still
//   cleared (the user has manually re-keyed already; orphaned globals are
//   discarded).
// - `storageService` exposes no `delete`; clearing a key means writing `null`.

import storageService from './storageService';
import {
  GLOBAL_AGENTS_KEY,
  GLOBAL_AGENT_SESSIONS_KEY,
  GLOBAL_AGENT_FOLDERS_KEY,
  GLOBAL_REPOS_KEY,
  agentsKey,
  agentSessionsKey,
  agentFoldersKey,
  reposKey,
  migrationFlagKey,
} from './workspaceKeys';

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  // Primitives are treated as "non-empty" only if truthy. The legacy keys
  // store arrays/objects, so this branch is mostly defensive.
  return Boolean(value);
}

export async function migrateGlobalKeysIfNeeded(workspacePath: string): Promise<void> {
  const flag = await storageService.get(migrationFlagKey());
  if (flag) return;

  const [globalAgents, globalSessions, globalFolders, globalRepos] = await Promise.all([
    storageService.get(GLOBAL_AGENTS_KEY),
    storageService.get(GLOBAL_AGENT_SESSIONS_KEY),
    storageService.get(GLOBAL_AGENT_FOLDERS_KEY),
    storageService.get(GLOBAL_REPOS_KEY),
  ]);

  const pairs: Array<{ global: unknown; scopedKey: string; globalKey: string }> = [
    { global: globalAgents, scopedKey: agentsKey(workspacePath), globalKey: GLOBAL_AGENTS_KEY },
    { global: globalSessions, scopedKey: agentSessionsKey(workspacePath), globalKey: GLOBAL_AGENT_SESSIONS_KEY },
    { global: globalFolders, scopedKey: agentFoldersKey(workspacePath), globalKey: GLOBAL_AGENT_FOLDERS_KEY },
    { global: globalRepos, scopedKey: reposKey(workspacePath), globalKey: GLOBAL_REPOS_KEY },
  ];

  const hasAnyGlobal = pairs.some(p => isNonEmpty(p.global));

  if (!hasAnyGlobal) {
    // Nothing to copy, but still set the flag so the no-op fast-path is
    // taken on subsequent calls.
    await storageService.set(migrationFlagKey(), true);
    return;
  }

  for (const { global, scopedKey, globalKey } of pairs) {
    if (!isNonEmpty(global)) {
      // Still clear the global key for tidiness, even if it was empty/null
      // — defensively normalizes the post-migration state.
      if (global !== null && global !== undefined) {
        await storageService.set(globalKey, null);
      }
      continue;
    }

    const existingScoped = await storageService.get(scopedKey);
    if (!isNonEmpty(existingScoped)) {
      await storageService.set(scopedKey, global);
    }
    // Either way, drop the global so it can't be re-migrated by accident.
    await storageService.set(globalKey, null);
  }

  await storageService.set(migrationFlagKey(), true);
}
