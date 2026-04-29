// Centralized helpers for the workspace-scoped storage key naming convention.
//
// Storage keys for workspace-bound data follow the `<base>:<workspacePath>`
// pattern, mirroring the existing `session:<workspacePath>` convention used by
// `WorkspaceContext.tsx` and `TabContext.tsx`. This keeps each workspace's
// data at its own JSON path so that two windows operating on different
// workspaces never read or write the same key.
//
// Path normalization: trailing slashes are stripped so that `/foo` and `/foo/`
// produce the same key. We deliberately do NOT collapse internal slashes,
// URL-encode, or lowercase the path — the path is the unique identity of the
// workspace and any further mangling would risk collisions or false negatives.

const AGENTS_BASE = 'agents';
const AGENT_SESSIONS_BASE = 'agent-sessions';
const AGENT_FOLDERS_BASE = 'agent-folders';
const REPOS_BASE = 'repos';
const MIGRATION_FLAG = 'migration:agents-workspace-scoped:v1';

function normalizePath(path: string): string {
  return path.replace(/\/+$/, '');
}

export function agentsKey(path: string): string {
  return `${AGENTS_BASE}:${normalizePath(path)}`;
}

export function agentSessionsKey(path: string): string {
  return `${AGENT_SESSIONS_BASE}:${normalizePath(path)}`;
}

export function agentFoldersKey(path: string): string {
  return `${AGENT_FOLDERS_BASE}:${normalizePath(path)}`;
}

export function reposKey(path: string): string {
  return `${REPOS_BASE}:${normalizePath(path)}`;
}

export function migrationFlagKey(): string {
  return MIGRATION_FLAG;
}

// Exposed for the migration utility — it needs the un-suffixed global key
// names so it can read the legacy data and clear it post-copy.
export const GLOBAL_AGENTS_KEY = AGENTS_BASE;
export const GLOBAL_AGENT_SESSIONS_KEY = AGENT_SESSIONS_BASE;
export const GLOBAL_AGENT_FOLDERS_KEY = AGENT_FOLDERS_BASE;
export const GLOBAL_REPOS_KEY = REPOS_BASE;
