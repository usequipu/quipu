import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { startSession, isElectronAgentRuntime, type AgentSessionHandle } from '../services/agentRuntime';
import { useFileSystem } from './FileSystemContext';
import { useRepo } from './RepoContext';
import { useTab } from './TabContext';
import { useToast } from '../components/ui/Toast';
import * as agentFileStore from '../services/agentFileStore';
import * as sessionCache from '../services/sessionCache';
import { watchDirRecursive } from '../services/quipuFileStore';
import { importLegacyDataForWorkspace } from '../services/legacyImport';
import { migrateLegacyAgentIds } from '../services/agentMigration';
import { slugify, normalizeFolder, disambiguateSlug, joinId } from '../services/slug';
import type { Agent, AgentMessage, AgentSession, AgentToolCall, AgentPermissionRequest, AgentImageAttachment } from '@/types/agent';

type SessionMap = Record<string, AgentSession>;

/** Declared folder names per kind — lets users keep empty folders.
 *
 *  Derived now from the file store (`loadAllFolders` + the loaded agents'
 *  kinds). The `chats`/`agents` partition keeps the existing public API
 *  shape stable for Unit 9's panels — folders containing no agents at all
 *  appear in both lists (treated as "declared but empty"). */
export interface AgentFolders {
  chats: string[];
  agents: string[];
}

const EMPTY_FOLDERS: AgentFolders = { chats: [], agents: [] };

/** How long a path written by THIS window suppresses a watcher reload.
 *  Echo storms surface as a watcher event firing milliseconds after our
 *  own write completes; longer than ~300ms and we're outside the OS
 *  buffer for coalesced inotify events. */
const ECHO_TTL_MS = 300;

/** Debounce window for session-cache writes during a streaming turn. The
 *  cache is durability, not correctness — saving on every token would
 *  thrash the disk for no observable benefit. */
const SESSION_SAVE_DEBOUNCE_MS = 500;

/** Composer draft state carried per-agent across tab switches. */
export interface AgentDraft {
  input: string;
  attachments: AgentImageAttachment[];
}

interface AgentContextValue {
  agents: Agent[];
  folders: AgentFolders;
  isLoaded: boolean;
  getAgent: (id: string) => Agent | undefined;
  upsertAgent: (agent: Agent) => void;
  /** Create a lightweight chat record (no editor form) and return its id. */
  createChat: (opts?: { folder?: string; name?: string }) => Agent;
  deleteAgent: (id: string) => void;
  /** Move an agent/chat into a folder (empty string = root). Also switches kind if asked. */
  moveAgent: (id: string, patch: { folder?: string; kind?: 'agent' | 'chat' }) => void;
  /** Eagerly clone every repo this agent binds into its scratch dir. Idempotent. */
  ensureAgentClones: (agentId: string) => Promise<void>;
  /** Declare a folder for the given kind so it persists even without items. */
  createFolder: (kind: 'agent' | 'chat', name: string) => void;
  /** Remove a folder declaration; items in it are moved to root. */
  deleteFolder: (kind: 'agent' | 'chat', name: string) => void;
  /** Rename a folder — updates both the declared list and every item referencing it. */
  renameFolder: (kind: 'agent' | 'chat', oldName: string, newName: string) => void;

  // Sessions
  getSession: (agentId: string) => AgentSession | undefined;
  clearSession: (agentId: string) => void;
  sendMessage: (agentId: string, body: string, attachments?: AgentImageAttachment[]) => Promise<void>;
  cancelTurn: (agentId: string) => Promise<void>;
  isTurnActive: (agentId: string) => boolean;
  /**
   * Respond to a pending permission request. The optional `opts` plumbs through
   * to the runtime's `respondToPermission` helper:
   *   - `decision: 'allow'` with `opts.updatedInput` becomes
   *     `{ behavior: 'allow', updatedInput }` on the wire.
   *   - `decision: 'deny'` with `opts.message` becomes
   *     `{ behavior: 'deny', message }` — used by the AskUserQuestion flow to
   *     surface the user's chosen answer to the agent as the "denial reason"
   *     so the tool stops re-asking and the agent reads the answer in its
   *     next turn.
   */
  respondToPermission: (
    agentId: string,
    messageId: string,
    decision: 'allow' | 'deny',
    opts?: { message?: string; updatedInput?: Record<string, unknown> },
  ) => void;
  /** Eagerly start (or resume) the Claude subprocess for the given agent so a
   *  reopened chat tab is ready before the user types. Idempotent — bails out
   *  if a session handle already exists; surfaces spawn errors as an
   *  error-role message in the agent's session rather than throwing. */
  resumeSession: (agentId: string) => Promise<void>;
  runtimeAvailable: boolean;

  // Per-chat composer drafts (in-memory only, transient — not persisted).
  /** Read the agent's draft. Returns a stable empty default if none is stored —
   *  callers that compare references frame-to-frame can rely on that stability. */
  getDraft: (agentId: string) => AgentDraft;
  /** Merge a patch into the agent's draft. If the resulting draft is empty
   *  (no input AND no attachments), the entry is removed from the Map. */
  setDraft: (agentId: string, patch: Partial<AgentDraft>) => void;
}

/** Stable empty draft default — returned by `getDraft` when no entry exists. */
const EMPTY_DRAFT: AgentDraft = Object.freeze({ input: '', attachments: [] as AgentImageAttachment[] }) as AgentDraft;

const AgentContext = createContext<AgentContextValue | null>(null);

/**
 * Strip the workspace prefix from a path; if still too long, collapse to the
 * basename. Matches the path-display convention Claude Code uses.
 */
function shortenPath(path: string, workspacePath: string | null, maxLen = 48): string {
  let out = path;
  if (workspacePath) {
    const base = workspacePath.replace(/\/+$/, '');
    if (out.startsWith(base + '/')) out = out.slice(base.length + 1);
    // Also collapse per-agent tmp/<id>/repos/<name>/ prefix to repos/<name>/ for readability.
    out = out.replace(/^tmp\/[^/]+\/repos\/([^/]+)\//, 'repos/$1/');
  }
  if (out.length > maxLen) {
    const name = out.split('/').pop() ?? out;
    out = name.length <= maxLen ? name : `${name.slice(0, maxLen - 1)}…`;
  }
  return out;
}

function trim(s: string, max = 96): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

interface ToolDescription {
  action: string;
  path?: string;
  detail?: string;
  input?: Record<string, unknown>;
}

function describeToolUse(name: string, rawInput: unknown, workspacePath: string | null): ToolDescription {
  const input = (rawInput && typeof rawInput === 'object') ? (rawInput as Record<string, unknown>) : {};
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const fp = typeof input.file_path === 'string' ? input.file_path : '';
      return { action: name, path: fp ? shortenPath(fp, workspacePath) : undefined, input };
    }
    case 'Bash': {
      const cmd = typeof input.command === 'string' ? input.command.replace(/\s+/g, ' ') : '';
      return { action: 'Bash', detail: cmd ? trim(cmd) : undefined, input };
    }
    case 'Grep': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      const p = typeof input.path === 'string' ? input.path : '';
      const detail = pattern + (p ? ` in ${shortenPath(p, workspacePath, 32)}` : '');
      return { action: 'Grep', detail: detail ? trim(detail) : undefined, input };
    }
    case 'Glob': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      return { action: 'Glob', detail: pattern ? trim(pattern) : undefined, input };
    }
    case 'WebFetch':
    case 'WebSearch': {
      const q = typeof input.url === 'string' ? input.url : (typeof input.query === 'string' ? input.query : '');
      return { action: name, detail: q ? trim(q) : undefined, input };
    }
    case 'TodoWrite':
      return { action: 'TodoWrite', detail: 'Updated todo list', input };
    case 'AskUserQuestion':
      return { action: 'AskUserQuestion', input };
    default:
      return { action: name, input };
  }
}

/** Legacy path for the result-event denial renderer. */
function summarizeToolUse(name: string, rawInput: unknown, workspacePath: string | null = null): string {
  const d = describeToolUse(name, rawInput, workspacePath);
  if (d.path) return `${d.action} ${d.path}`;
  if (d.detail) return `${d.action}: ${d.detail}`;
  return d.action;
}

interface ResolvedBinding {
  source: 'workspace' | 'repo';
  /** Label shown to the agent (binding subpath or repo name + subpath). */
  label: string;
  absPath: string;
  documentation?: string;
}

interface SessionContext {
  addDirs: string[];
  resolved: ResolvedBinding[];
}

/**
 * For each binding, resolve its absolute path on disk. Workspace bindings use
 * the workspace path directly. Repo bindings auto-clone into the agent's
 * private scratch directory at `<workspace>/tmp/<agent-id>/repos/<name>/`
 * (idempotent — re-uses an existing clone if present).
 */
async function resolveSessionContext(
  agent: Agent,
  workspacePath: string | null,
  cloneRepoForAgent: (repoId: string, agentId: string) => Promise<string>,
  repos: Array<{ id: string; name: string }>,
): Promise<SessionContext> {
  if (!workspacePath) return { addDirs: [], resolved: [] };
  const base = workspacePath.replace(/\/+$/, '');
  const addDirs: string[] = [];
  const resolved: ResolvedBinding[] = [];
  for (const b of agent.bindings ?? []) {
    if (b.source === 'workspace') {
      const abs = b.subpath
        ? (b.subpath.startsWith('/') ? b.subpath : `${base}/${b.subpath}`)
        : base;
      if (!addDirs.includes(abs)) addDirs.push(abs);
      resolved.push({
        source: 'workspace',
        label: b.subpath ? `workspace/${b.subpath}` : 'workspace',
        absPath: abs,
        documentation: b.documentation?.trim() || undefined,
      });
      continue;
    }
    if (b.source === 'repo' && b.repoId) {
      const repo = repos.find(r => r.id === b.repoId);
      try {
        const cloneRoot = await cloneRepoForAgent(b.repoId, agent.id);
        const abs = b.subpath ? `${cloneRoot.replace(/\/+$/, '')}/${b.subpath}` : cloneRoot;
        if (!addDirs.includes(abs)) addDirs.push(abs);
        resolved.push({
          source: 'repo',
          label: `${repo?.name ?? 'repo'}${b.subpath ? `/${b.subpath}` : ''}`,
          absPath: abs,
          documentation: b.documentation?.trim() || undefined,
        });
      } catch (err) {
        console.warn('[agent] failed to clone repo for binding', b.repoId, err);
      }
    }
  }
  return { addDirs, resolved };
}

/**
 * Build the Quipu-specific system-prompt preamble that tells the agent where
 * it is, where repos were cloned, and which contexts are attached. Prepended
 * to the user-configured system prompt on every session start.
 */
function buildQuipuContextPrompt(
  agent: Agent,
  workspacePath: string,
  resolved: ResolvedBinding[],
): string {
  const lines: string[] = [];
  lines.push('## Quipu workspace context');
  lines.push('');
  lines.push(`You are running inside Quipu — a code editor that spawns you as a Claude Code subprocess.`);
  lines.push('');
  lines.push(`**Workspace layout:**`);
  lines.push(`- Workspace root: \`${workspacePath}\` — the user's primary project.`);
  lines.push(`- Your scratch dir: \`${workspacePath}/tmp/${agent.id}/\` — agent-private, gitignored.`);
  lines.push(`- Bound repo clones: \`${workspacePath}/tmp/${agent.id}/repos/<repo-name>/\` — each agent gets its own isolated clone (worktree-style, but separate copies). Edits here do not affect the user's source repos or other agents.`);
  lines.push('');

  if (resolved.length > 0) {
    lines.push(`**Contexts bound to this agent (exposed via \`--add-dir\`):**`);
    for (const r of resolved) {
      const src = r.source === 'repo' ? 'repo' : 'workspace';
      const doc = r.documentation ? ` — ${r.documentation}` : '';
      lines.push(`- \`${r.absPath}\` (${src} · ${r.label})${doc}`);
    }
    lines.push('');
    lines.push(`When the user names a repo, use the cloned path above. Prefer reading/editing files through these bound paths; reach outside only when the user asks explicitly.`);
  } else {
    lines.push(`**No bound contexts yet.** You can only access the current working directory. Ask the user to bind repos/folders to this agent if needed.`);
  }

  lines.push('');
  lines.push(`When the user asks about annotations or frames, consult the FRAME skill (available via \`/frame\`) — it has the canonical schema and editing rules.`);

  lines.push('');
  lines.push(`## Math rendering`);
  lines.push('');
  lines.push(`Quipu renders LaTeX math in both chat responses and markdown files via KaTeX. You can write:`);
  lines.push(`- Inline math with \`$...$\` — e.g. \`$\\\\int_0^1 x^2 \\\\,dx = 1/3$\``);
  lines.push(`- Block math with \`$$...$$\` on its own paragraph — e.g.`);
  lines.push('');
  lines.push('  ```');
  lines.push('  $$\\\\sum_{i=1}^n i = \\\\frac{n(n+1)}{2}$$');
  lines.push('  ```');
  lines.push('');
  lines.push(`When editing \`.md\` or \`.quipu\` files, you can insert a dedicated LaTeX block node by wrapping the expression in \`$$...$$\` on its own line — Quipu's editor will render it as a KaTeX block. Use proper LaTeX syntax; KaTeX supports the common subset (no \\\\newcommand, etc.).`);

  lines.push('');
  lines.push(`## Rich rendering`);
  lines.push('');
  lines.push(`The chat upgrades two fenced-block languages into live React renders:`);
  lines.push('');
  lines.push(`- \`\`\`mdx — curated MDX surface. Components available: \`Card\`, \`Callout\`, \`Badge\`, \`Stat\`, \`Row\`, \`Col\`, \`LineChart\`, \`BarChart\`, \`AreaChart\`, \`PieChart\`. Charts AND \`<Stat>\` accept inline data or a workspace \`src="path/to.csv"\` (also \`.tsv\`, \`.json\`, \`.jsonl\`, \`.quipudb.jsonl\`, and \`dir:./path\` for directory listings). \`<Stat src=... aggregate="count|sum|avg|min|max" where="col=value">\` computes the value live from disk so dashboards stay current. No \`import\`, no \`export\`, no \`dangerouslySetInnerHTML\`, no \`<script>\`. See the \`mdx\` skill (\`/mdx\`) for the full reference.`);
  lines.push(`- \`\`\`quipudb.jsonl — read-only DatabaseViewer. Line 1 is the schema, subsequent lines are JSON rows with a unique \`_id\`. Column types: \`text\`, \`number\`, \`select\`, \`multi-select\`, \`date\`, \`checkbox\`, \`link\`. See the \`quipudb\` skill (\`/quipudb\`) for the format reference.`);
  lines.push('');
  lines.push(`**Prefer \`\`\`quipudb.jsonl over markdown tables for any tabular data with more than three columns or typed values** — it stays explorable past the point where markdown tables become illegible. Prefer \`\`\`mdx over plain markdown when the response benefits from visual chrome (status callouts, side-by-side comparisons). Don't reach for either when plain markdown communicates the same signal — the simpler tool is the right tool.`);

  lines.push('');
  lines.push(`\`.mdx\` is also a workspace file type. When the user wants a durable artifact (dashboard, runbook, status report) rather than a chat-scoped response, write the MDX to a \`.mdx\` file — opens in a split source/preview editor, charts with \`src="path"\` props auto-refresh from the underlying CSV / JSONL / quipudb.jsonl, and \`.md\` notes can inline-embed it via \`![[notes.mdx]]\`.`);

  return lines.join('\n');
}

/**
 * Partition the file-store's flat folder list into the legacy `{ chats, agents }`
 * shape consumed by the Agents panel. A folder appears under a kind if at
 * least one of its agents has that kind; folders with no agents (declared
 * via `.folder.json` markers) appear in both, since the file store doesn't
 * track which kind an empty folder "belongs" to.
 */
function partitionFoldersByKind(
  folderPaths: string[],
  agentList: Agent[],
): AgentFolders {
  const chatSet = new Set<string>();
  const agentSet = new Set<string>();
  // Pre-index agents by folder for an O(F+A) walk instead of O(F*A).
  const byFolder = new Map<string, Set<'agent' | 'chat'>>();
  for (const a of agentList) {
    const key = a.folder ?? '';
    let kinds = byFolder.get(key);
    if (!kinds) {
      kinds = new Set();
      byFolder.set(key, kinds);
    }
    kinds.add(a.kind);
  }
  for (const path of folderPaths) {
    if (path === '') continue;
    const kinds = byFolder.get(path);
    if (!kinds || kinds.size === 0) {
      // Empty folder — show in both lists so the UI can declare it
      // under whichever section the user is browsing.
      chatSet.add(path);
      agentSet.add(path);
      continue;
    }
    if (kinds.has('chat')) chatSet.add(path);
    if (kinds.has('agent')) agentSet.add(path);
  }
  // Also surface folders that exist only because of agents (no marker
  // file) — partitionFoldersByKind is called with the file-store output
  // which already includes these, so this is a defensive sweep for any
  // missed cases.
  for (const a of agentList) {
    const key = a.folder ?? '';
    if (key === '') continue;
    if (a.kind === 'chat') chatSet.add(key);
    else agentSet.add(key);
  }
  return {
    chats: Array.from(chatSet).sort(),
    agents: Array.from(agentSet).sort(),
  };
}

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { workspacePath } = useFileSystem();
  const { cloneRepoForAgent, repos } = useRepo();
  const { renameTabsByPath, renameTabPath, openTabs, closeTab } = useTab();
  const { showToast } = useToast();

  // === State (per CLAUDE.md hook ordering: state first, callbacks, effects last) ===

  const [agents, setAgents] = useState<Agent[]>([]);
  const [folderPaths, setFolderPaths] = useState<string[]>([]);
  const [folders, setFolders] = useState<AgentFolders>(EMPTY_FOLDERS);
  const [sessions, setSessions] = useState<SessionMap>({});
  const [activeTurns, setActiveTurns] = useState<Record<string, boolean>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const runtimeAvailable = isElectronAgentRuntime();

  // Persistent session handles, one per agent.
  const sessionHandlesRef = useRef<Map<string, AgentSessionHandle>>(new Map());
  // Assistant message currently being streamed per agent.
  const streamingMessageRef = useRef<Map<string, { messageId: string; accumulated: string; anthropicMessageId: string | null }>>(new Map());
  // Per-chat composer drafts. Refs (not state) so a keystroke does not re-render
  // every consumer; ChatView holds its own local React state for the live
  // textarea value and pushes back here on each change. Lives only for the
  // lifetime of the AgentProvider — drafts are intentionally NOT persisted.
  const draftsRef = useRef<Map<string, AgentDraft>>(new Map());

  const sessionsRef = useRef<SessionMap>(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const agentsRef = useRef<Agent[]>(agents);
  useEffect(() => { agentsRef.current = agents; }, [agents]);

  const folderPathsRef = useRef<string[]>(folderPaths);
  useEffect(() => { folderPathsRef.current = folderPaths; }, [folderPaths]);

  // Per-agent debounce timers for the session-cache write. Clearing the
  // pending timer on overwrite means rapid token streams collapse to a
  // single write at the end of a quiet ~500ms window.
  const sessionSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Echo-suppression: when this window writes to a path, the watcher
  // immediately fires for that path. Tracking expiry timestamps lets us
  // ignore those self-induced events without blocking real cross-window
  // writes for more than a few hundred milliseconds.
  const recentWriteTimesRef = useRef<Map<string, number>>(new Map());

  /** Mark the given absolute path as "just written by us" for ECHO_TTL_MS.
   *  Garbage-collects any expired entries on the way in. */
  const markRecentWrite = useCallback((absPath: string): void => {
    const now = Date.now();
    const map = recentWriteTimesRef.current;
    // Periodic GC of stale entries — cheap because the map only grows
    // by O(workspace mutations / second).
    for (const [k, expiry] of map) {
      if (expiry <= now) map.delete(k);
    }
    map.set(absPath, now + ECHO_TTL_MS);
  }, []);

  /** True if `absPath` is one we wrote within ECHO_TTL_MS. Consumes the entry
   *  on hit so a single write only suppresses one watcher event. */
  const isRecentEcho = useCallback((absPath: string): boolean => {
    const expiry = recentWriteTimesRef.current.get(absPath);
    if (expiry === undefined) return false;
    if (expiry <= Date.now()) {
      recentWriteTimesRef.current.delete(absPath);
      return false;
    }
    recentWriteTimesRef.current.delete(absPath);
    return true;
  }, []);

  // Tracks which workspacePath the in-memory state belongs to. Used by the
  // file watcher reload to bail out if we've moved on to another workspace
  // since the event arrived. Set inside the load effect, never read by
  // saves (saves are imperative now and happen synchronously, so they
  // can't outlive the workspace they ran under).
  const loadedWorkspaceRef = useRef<string | null>(null);

  // === Leaf callbacks ===

  const getAgent = useCallback((id: string) => agents.find(a => a.id === id), [agents]);

  /**
   * Compute a slug for `agent` that won't collide with any sibling under the
   * same folder. Used by `upsertAgent` whenever a slug isn't supplied or
   * supplied-but-colliding (e.g. on a rename into an existing folder).
   *
   * `selfId` is the id we should ignore when checking for collisions —
   * critical when re-saving an agent in place (its own previous slug
   * shouldn't be considered a collision against itself).
   */
  const resolveSlugForFolder = useCallback((
    agentList: Agent[],
    folder: string,
    desiredSlug: string,
    fallbackName: string,
    fallbackKind: 'agent' | 'chat',
    selfId: string | null,
  ): string => {
    const cleaned = desiredSlug.trim() || slugify(fallbackName, fallbackKind);
    const used = new Set<string>();
    for (const other of agentList) {
      if (other.id === selfId) continue;
      const otherFolder = other.folder ?? '';
      if (otherFolder !== folder) continue;
      const otherSlug = other.slug ?? '';
      if (otherSlug !== '') used.add(otherSlug);
    }
    return disambiguateSlug(cleaned, used);
  }, []);

  /** Build the next folders snapshot from a (possibly hypothetical) agents
   *  list and the current declared-folder paths. Pure — no setState. */
  const computeFoldersSnapshot = useCallback((agentList: Agent[]): AgentFolders => {
    return partitionFoldersByKind(folderPathsRef.current, agentList);
  }, []);

  // === Imperative file-store ops with state sync ===

  /**
   * Write `agent` to disk and update React state. Slug+folder are
   * normalized + disambiguated against the live agent list before the
   * save, so callers don't have to think about collisions.
   *
   * `previousLocation` is the agent's prior on-disk location
   * (`joinId(prevFolder, prevSlug)`) — used by the file store to delete
   * the old file when the user renames a slug or folder. The agent's
   * `id` (UUID) is stable across renames; it is preserved through the
   * save and never recomputed.
   *
   * For brand-new agents, callers may pass an empty `incoming.id`; a
   * UUID is generated here.
   */
  const persistAgent = useCallback(async (
    workspace: string,
    incoming: Agent,
    previousLocation: string | null,
  ): Promise<Agent | null> => {
    const folder = normalizeFolder(incoming.folder ?? '');
    const desiredSlug = (incoming.slug ?? '').trim() || slugify(incoming.name, incoming.kind);
    const stableId = incoming.id && incoming.id.length > 0 ? incoming.id : crypto.randomUUID();
    const slug = resolveSlugForFolder(
      agentsRef.current,
      folder,
      desiredSlug,
      incoming.name,
      incoming.kind,
      stableId,
    );
    const newLocation = joinId(folder, slug);
    const persisted: Agent = {
      ...incoming,
      id: stableId,
      slug,
      folder: folder === '' ? undefined : folder,
    };

    try {
      // Mark BOTH the new file (we're about to write it) and the old
      // file (we may delete it) as recent echoes — the watcher fires
      // for both create and unlink events.
      const newAbs = `${workspace}/.quipu/agents/${newLocation}.json`;
      markRecentWrite(newAbs);
      if (previousLocation !== null && previousLocation !== newLocation) {
        const oldAbs = `${workspace}/.quipu/agents/${previousLocation}.json`;
        markRecentWrite(oldAbs);
      }
      await agentFileStore.saveAgent(workspace, persisted, previousLocation ?? undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to save agent: ${message}`, 'error');
      return null;
    }

    // State update — replace by stable id. Use the freshest agentsRef
    // snapshot so we don't lose interleaved updates between the save
    // call and the setState.
    setAgents(prev => {
      let replaced = false;
      const next: Agent[] = [];
      for (const a of prev) {
        if (a.id === stableId) {
          if (!replaced) {
            next.push(persisted);
            replaced = true;
          }
          continue;
        }
        next.push(a);
      }
      if (!replaced) next.push(persisted);
      return next;
    });

    // Sync any open tabs' visible names. The tab path `agent://<id>`
    // stays valid because id is stable across folder/slug renames.
    renameTabsByPath(`agent://${stableId}`, persisted.name);

    return persisted;
  }, [markRecentWrite, renameTabsByPath, resolveSlugForFolder, showToast]);

  const upsertAgent = useCallback((agent: Agent): void => {
    if (!workspacePath) return;
    const previous = agentsRef.current.find(a => a.id === agent.id);
    const previousLocation = previous
      ? joinId(previous.folder ?? '', previous.slug)
      : null;
    // Optimistic ref update so callers that immediately read agentsRef
    // (sendMessage → ensureSession) see the new model/effort BEFORE the
    // async file write completes. Without this, model swaps silently
    // applied to the next-but-one message instead of the next one.
    if (previous) {
      agentsRef.current = agentsRef.current.map(a => a.id === agent.id ? agent : a);
    } else {
      agentsRef.current = [...agentsRef.current, agent];
    }
    void persistAgent(workspacePath, agent, previousLocation);
  }, [persistAgent, workspacePath]);

  const ensureAgentClones = useCallback(async (agentId: string): Promise<void> => {
    const agent = agentsRef.current.find(a => a.id === agentId);
    if (!agent) return;
    const repoBindings = (agent.bindings ?? []).filter(b => b.source === 'repo' && b.repoId);
    if (repoBindings.length === 0) return;

    let failed = 0;
    await Promise.all(repoBindings.map(async (b) => {
      try {
        await cloneRepoForAgent(b.repoId!, agentId);
      } catch (err) {
        failed++;
        console.warn('[agent] ensureAgentClones: clone failed', b.repoId, err);
      }
    }));
    if (failed > 0) {
      showToast(`${failed} repo clone${failed === 1 ? '' : 's'} failed — check the Repos panel.`, 'warning');
    }
  }, [cloneRepoForAgent, showToast]);

  const moveAgent = useCallback((id: string, patch: { folder?: string; kind?: 'agent' | 'chat' }): void => {
    if (!workspacePath) return;
    const existing = agentsRef.current.find(a => a.id === id);
    if (!existing) return;
    const now = new Date().toISOString();
    const updated: Agent = {
      ...existing,
      folder: patch.folder !== undefined ? (patch.folder || undefined) : existing.folder,
      kind: patch.kind ?? existing.kind,
      updatedAt: now,
    };
    const previousLocation = joinId(existing.folder ?? '', existing.slug);
    void persistAgent(workspacePath, updated, previousLocation);
  }, [persistAgent, workspacePath]);

  const createChat = useCallback((opts?: { folder?: string; name?: string }): Agent => {
    const now = new Date().toISOString();
    const name = opts?.name ?? 'New chat';
    const folder = normalizeFolder(opts?.folder ?? '');
    const slug = resolveSlugForFolder(
      agentsRef.current,
      folder,
      slugify(name, 'chat'),
      name,
      'chat',
      null,
    );
    const id = crypto.randomUUID();
    const chat: Agent = {
      id,
      slug,
      name,
      kind: 'chat',
      systemPrompt: '',
      model: 'claude-sonnet-4-5',
      bindings: [],
      permissionMode: 'default',
      folder: folder === '' ? undefined : folder,
      createdAt: now,
      updatedAt: now,
    };
    if (workspacePath) {
      void persistAgent(workspacePath, chat, null);
    } else {
      // No workspace yet — at least populate state so the in-memory ID is
      // returned to the caller. The next `useEffect([workspacePath])`
      // will reset state, so this is best-effort for the no-workspace
      // edge case (which the panels guard against by hiding the New
      // chat button).
      setAgents(prev => [...prev, chat]);
    }
    return chat;
  }, [persistAgent, resolveSlugForFolder, workspacePath]);

  const killSession = useCallback(async (agentId: string): Promise<void> => {
    const handle = sessionHandlesRef.current.get(agentId);
    if (handle) {
      sessionHandlesRef.current.delete(agentId);
      try { await handle.stop(); } catch { /* ignore */ }
    }
    // Cancel any pending session-cache flush — the agent is going away.
    const t = sessionSaveTimersRef.current.get(agentId);
    if (t !== undefined) {
      clearTimeout(t);
      sessionSaveTimersRef.current.delete(agentId);
    }
  }, []);

  const deleteAgent = useCallback((id: string): void => {
    if (!workspacePath) return;
    void killSession(id);
    // Drop any in-memory composer draft for this agent so a future agent
    // that somehow reuses the id (or just to free the entry) doesn't see
    // stale text.
    draftsRef.current.delete(id);

    // Mark the about-to-be-deleted file for echo suppression.
    const abs = `${workspacePath}/.quipu/agents/${id}.json`;
    markRecentWrite(abs);

    // Persist deletion before flipping local state so a watcher fire-back
    // doesn't re-introduce the agent. Use Promise chaining rather than
    // await so the public method stays synchronous.
    void (async () => {
      try {
        await agentFileStore.deleteAgent(workspacePath, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showToast(`Failed to delete agent: ${message}`, 'error');
        return;
      }
      try {
        await sessionCache.deleteSession(workspacePath, id);
      } catch (err) {
        // Session-cache deletion is best-effort — a missing/lock-held
        // file shouldn't block the agent removal.
        console.warn('[agent] deleteAgent: deleteSession failed', err);
      }
    })();

    setAgents(prev => prev.filter(a => a.id !== id));
    setSessions(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [killSession, markRecentWrite, showToast, workspacePath]);

  /** Reload agents + folder paths from disk. Used both at workspace open
   *  and after the file watcher reports a change. The `cancelled` flag
   *  protects against a workspace switch firing mid-reload — caller
   *  passes its own cancellation token. */
  const reloadAgentsAndFolders = useCallback(async (
    workspace: string,
    isCancelled: () => boolean,
  ): Promise<{ agents: Agent[]; folders: string[] } | null> => {
    try {
      const [loadedAgents, loadedFolders] = await Promise.all([
        agentFileStore.loadAllAgents(workspace),
        agentFileStore.loadAllFolders(workspace),
      ]);
      if (isCancelled()) return null;
      return {
        agents: loadedAgents,
        folders: loadedFolders.map(f => f.path),
      };
    } catch (err) {
      console.warn('[agent] reload failed', err);
      return null;
    }
  }, []);

  const createFolder = useCallback((kind: 'agent' | 'chat', name: string): void => {
    if (!workspacePath) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    let folderPath: string;
    try {
      folderPath = normalizeFolder(trimmed);
    } catch {
      showToast(`"${trimmed}" is not a valid folder name.`, 'error');
      return;
    }
    if (folderPath === '') return;

    void (async () => {
      try {
        const markerAbs = `${workspacePath}/.quipu/agents/${folderPath}/.folder.json`;
        markRecentWrite(markerAbs);
        await agentFileStore.createFolder(workspacePath, folderPath, trimmed);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showToast(`Failed to create folder: ${message}`, 'error');
        return;
      }
      // Reload folders state so the newly-declared folder shows up.
      // Agents don't change, but loadAllFolders is the source of truth
      // for the declared list.
      const result = await reloadAgentsAndFolders(workspacePath, () => loadedWorkspaceRef.current !== workspacePath);
      if (!result) return;
      setAgents(result.agents);
      setFolderPaths(result.folders);
      // The kind argument is currently unused — both lists derive from
      // agent contents and the declared-paths set. We keep it in the
      // signature for Unit 9's UI, which may want to bias an empty
      // folder toward one section.
      void kind;
    })();
  }, [markRecentWrite, reloadAgentsAndFolders, showToast, workspacePath]);

  const deleteFolder = useCallback((kind: 'agent' | 'chat', name: string): void => {
    if (!workspacePath) return;
    let folderPath: string;
    try {
      folderPath = normalizeFolder(name);
    } catch {
      showToast(`"${name}" is not a valid folder name.`, 'error');
      return;
    }
    if (folderPath === '') return;

    void (async () => {
      try {
        await agentFileStore.deleteFolder(workspacePath, folderPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showToast(`Failed to delete folder: ${message}`, 'error');
        return;
      }
      const result = await reloadAgentsAndFolders(workspacePath, () => loadedWorkspaceRef.current !== workspacePath);
      if (!result) return;
      setAgents(result.agents);
      setFolderPaths(result.folders);
      void kind;
    })();
  }, [reloadAgentsAndFolders, showToast, workspacePath]);

  const renameFolder = useCallback((kind: 'agent' | 'chat', oldName: string, newName: string): void => {
    if (!workspacePath) return;
    let oldPath: string;
    let newPath: string;
    try {
      oldPath = normalizeFolder(oldName);
      newPath = normalizeFolder(newName);
    } catch {
      showToast('Invalid folder name.', 'error');
      return;
    }
    if (oldPath === '' || newPath === '' || oldPath === newPath) return;

    void (async () => {
      try {
        await agentFileStore.renameFolder(workspacePath, oldPath, newPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showToast(`Failed to rename folder: ${message}`, 'error');
        return;
      }
      const result = await reloadAgentsAndFolders(workspacePath, () => loadedWorkspaceRef.current !== workspacePath);
      if (!result) return;
      setAgents(result.agents);
      setFolderPaths(result.folders);
      void kind;
    })();
  }, [reloadAgentsAndFolders, showToast, workspacePath]);

  const getSession = useCallback((agentId: string) => sessions[agentId], [sessions]);

  const clearSession = useCallback((agentId: string): void => {
    void killSession(agentId);
    setSessions(prev => {
      if (!prev[agentId]) return prev;
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
    if (workspacePath) {
      void sessionCache.deleteSession(workspacePath, agentId).catch(err => {
        console.warn('[agent] clearSession: deleteSession failed', err);
      });
    }
  }, [killSession, workspacePath]);

  const isTurnActive = useCallback((agentId: string) => !!activeTurns[agentId], [activeTurns]);

  const setTurnActive = useCallback((agentId: string, active: boolean): void => {
    setActiveTurns(prev => {
      if (!!prev[agentId] === active) return prev;
      const next = { ...prev };
      if (active) next[agentId] = true; else delete next[agentId];
      return next;
    });
  }, []);

  /** Schedule a debounced session-cache write for `agentId`. Subsequent
   *  calls within SESSION_SAVE_DEBOUNCE_MS reset the timer so a streaming
   *  burst flushes once at the end of the quiet window. */
  const scheduleSessionSave = useCallback((agentId: string): void => {
    if (!workspacePath) return;
    const timers = sessionSaveTimersRef.current;
    const prev = timers.get(agentId);
    if (prev !== undefined) clearTimeout(prev);
    const handle = setTimeout(() => {
      timers.delete(agentId);
      const session = sessionsRef.current[agentId];
      if (!session) return;
      void sessionCache.saveSession(workspacePath, agentId, session).catch(err => {
        console.warn('[agent] saveSession failed', err);
      });
    }, SESSION_SAVE_DEBOUNCE_MS);
    timers.set(agentId, handle);
  }, [workspacePath]);

  const appendMessage = useCallback((agentId: string, message: AgentMessage): void => {
    setSessions(prev => {
      const existing = prev[agentId] ?? { agentId, messages: [], updatedAt: new Date().toISOString() };
      return {
        ...prev,
        [agentId]: {
          ...existing,
          messages: [...existing.messages, message],
          updatedAt: new Date().toISOString(),
        },
      };
    });
    scheduleSessionSave(agentId);
  }, [scheduleSessionSave]);

  const updateMessage = useCallback((agentId: string, messageId: string, patch: Partial<AgentMessage>): void => {
    setSessions(prev => {
      const existing = prev[agentId];
      if (!existing) return prev;
      const idx = existing.messages.findIndex(m => m.id === messageId);
      if (idx < 0) return prev;
      const messages = [...existing.messages];
      messages[idx] = { ...messages[idx], ...patch };
      return {
        ...prev,
        [agentId]: { ...existing, messages, updatedAt: new Date().toISOString() },
      };
    });
    scheduleSessionSave(agentId);
  }, [scheduleSessionSave]);

  const setSessionId = useCallback((agentId: string, claudeSessionId: string): void => {
    setSessions(prev => {
      const existing = prev[agentId] ?? { agentId, messages: [], updatedAt: new Date().toISOString() };
      if (existing.claudeSessionId === claudeSessionId) return prev;
      return {
        ...prev,
        [agentId]: { ...existing, claudeSessionId, updatedAt: new Date().toISOString() },
      };
    });
    scheduleSessionSave(agentId);
  }, [scheduleSessionSave]);

  const handleEvent = useCallback((agentId: string, event: Record<string, unknown>): void => {
    const type = (event as { type?: unknown }).type;

    if (type === 'system' && (event as { subtype?: unknown }).subtype === 'init') {
      const sid = (event as { session_id?: unknown }).session_id;
      if (typeof sid === 'string') setSessionId(agentId, sid);
      return;
    }

    if (type === 'assistant') {
      const msg = (event as { message?: { id?: unknown; content?: Array<Record<string, unknown>> } }).message;
      const content = msg?.content;
      if (!Array.isArray(content)) return;
      const incomingId = typeof msg?.id === 'string' ? msg.id : null;

      let stream = streamingMessageRef.current.get(agentId);
      if (!stream) return; // Assistant event without an active turn; ignore.

      // A new Anthropic message.id means Claude started a fresh response round
      // (e.g. after a tool result). Finalize the previous bubble and start a
      // new one so reasoning rounds render as separate paragraphs instead of
      // piling into a single run-on block.
      if (incomingId && stream.anthropicMessageId && stream.anthropicMessageId !== incomingId) {
        updateMessage(agentId, stream.messageId, { streaming: false });
        const newMessageId = crypto.randomUUID();
        appendMessage(agentId, {
          id: newMessageId,
          role: 'assistant',
          body: '',
          createdAt: new Date().toISOString(),
          streaming: true,
        });
        stream = { messageId: newMessageId, accumulated: '', anthropicMessageId: incomingId };
        streamingMessageRef.current.set(agentId, stream);
      } else if (incomingId && !stream.anthropicMessageId) {
        stream.anthropicMessageId = incomingId;
      }

      let accumulated = stream.accumulated;
      const newToolCalls: AgentToolCall[] = [];

      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          accumulated += block.text;
        }
        if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          const d = describeToolUse(block.name, block.input, workspacePath);
          newToolCalls.push({
            id: block.id,
            name: block.name,
            action: d.action,
            path: d.path,
            detail: d.detail,
            input: d.input,
          });
        }
      }

      streamingMessageRef.current.set(agentId, {
        messageId: stream.messageId,
        accumulated,
        anthropicMessageId: stream.anthropicMessageId,
      });
      const patch: Partial<AgentMessage> = { body: accumulated };
      if (newToolCalls.length > 0) {
        const existing = sessionsRef.current[agentId]?.messages.find(m => m.id === stream.messageId)?.toolCalls ?? [];
        const known = new Set(existing.map(c => c.id));
        const merged = [...existing];
        for (const c of newToolCalls) if (!known.has(c.id)) { merged.push(c); known.add(c.id); }
        patch.toolCalls = merged;
      }
      updateMessage(agentId, stream.messageId, patch);
      return;
    }

    if (type === 'result') {
      const sid = (event as { session_id?: unknown }).session_id;
      if (typeof sid === 'string') setSessionId(agentId, sid);
      const stream = streamingMessageRef.current.get(agentId);
      if (stream) {
        updateMessage(agentId, stream.messageId, { streaming: false });
        streamingMessageRef.current.delete(agentId);
      }
      setTurnActive(agentId, false);

      const denials = (event as { permission_denials?: unknown }).permission_denials;
      if (Array.isArray(denials) && denials.length > 0) {
        const lines = denials.map((d) => {
          const obj = (d && typeof d === 'object') ? d as Record<string, unknown> : {};
          const toolName = typeof obj.tool_name === 'string' ? obj.tool_name : 'Tool';
          return `• ${summarizeToolUse(toolName, obj.tool_input, workspacePath)}`;
        }).join('\n');
        appendMessage(agentId, {
          id: crypto.randomUUID(),
          role: 'error',
          body: `Tool call${denials.length === 1 ? '' : 's'} denied:\n${lines}`,
          createdAt: new Date().toISOString(),
        });
      }
      return;
    }

    // Permission request — the CLI emits a `control_request` with
    // `request.subtype === 'can_use_tool'` when a tool call needs approval and
    // we enabled `--permission-prompt-tool stdio`.
    if (type === 'control_request') {
      const envelope = (event as { request?: unknown; request_id?: unknown });
      const requestId = typeof envelope.request_id === 'string' ? envelope.request_id : '';
      const inner = (envelope.request && typeof envelope.request === 'object')
        ? envelope.request as Record<string, unknown>
        : {};
      if (inner.subtype === 'can_use_tool' && requestId) {
        const toolName = typeof inner.tool_name === 'string' ? inner.tool_name : 'Tool';
        const input = (inner.input && typeof inner.input === 'object') ? inner.input as Record<string, unknown> : {};
        const d = describeToolUse(toolName, input, workspacePath);
        const request: AgentPermissionRequest = {
          toolUseId: requestId,
          toolName,
          action: d.action,
          path: d.path,
          detail: d.detail,
          input: d.input,
          status: 'pending',
        };
        appendMessage(agentId, {
          id: crypto.randomUUID(),
          role: 'permission-request',
          body: '',
          createdAt: new Date().toISOString(),
          permissionRequest: request,
        });
      }
      return;
    }

    // The CLI also emits `control_response` for our own initialize/control
    // requests — ignore silently.
    if (type === 'control_response') return;

    if (type === 'error') {
      const message = (event as { message?: unknown }).message;
      appendMessage(agentId, {
        id: crypto.randomUUID(),
        role: 'error',
        body: typeof message === 'string' ? message : 'Agent error',
        createdAt: new Date().toISOString(),
      });
      setTurnActive(agentId, false);
      streamingMessageRef.current.delete(agentId);
    }
  }, [appendMessage, updateMessage, setSessionId, setTurnActive, workspacePath]);

  const ensureSession = useCallback(async (agent: Agent): Promise<AgentSessionHandle | null> => {
    if (!runtimeAvailable) return null;
    const existing = sessionHandlesRef.current.get(agent.id);
    if (existing) return existing;

    const { addDirs, resolved } = await resolveSessionContext(agent, workspacePath, cloneRepoForAgent, repos);
    const existingSession = sessionsRef.current[agent.id];

    const quipuPreamble = workspacePath ? buildQuipuContextPrompt(agent, workspacePath, resolved) : '';
    const userPrompt = (agent.systemPrompt ?? '').trim();
    const combinedSystemPrompt = [quipuPreamble, userPrompt].filter(Boolean).join('\n\n');

    const handle = await startSession(agent.id, {
      systemPrompt: combinedSystemPrompt,
      model: agent.model,
      effort: agent.effort,
      addDirs,
      cwd: workspacePath ?? undefined,
      resumeSessionId: existingSession?.claudeSessionId,
      permissionMode: agent.permissionMode ?? 'default',
      allowedTools: agent.allowedTools,
    }, {
      onEvent: (ev) => handleEvent(agent.id, ev),
      onExit: () => {
        sessionHandlesRef.current.delete(agent.id);
        const stream = streamingMessageRef.current.get(agent.id);
        if (stream) {
          updateMessage(agent.id, stream.messageId, { streaming: false });
          streamingMessageRef.current.delete(agent.id);
        }
        setTurnActive(agent.id, false);
      },
      onError: (message) => {
        appendMessage(agent.id, {
          id: crypto.randomUUID(),
          role: 'error',
          body: message,
          createdAt: new Date().toISOString(),
        });
        setTurnActive(agent.id, false);
      },
    });
    sessionHandlesRef.current.set(agent.id, handle);
    return handle;
  }, [runtimeAvailable, workspacePath, cloneRepoForAgent, repos, handleEvent, setTurnActive, appendMessage, updateMessage]);

  // Public wrapper around `ensureSession`. ChatView calls this on mount so the
  // Claude subprocess is ready before the user types — without this, reopening
  // a chat with stored history would leave the agent disconnected until the
  // first send. Errors surface as in-session messages instead of throwing
  // because a failed auto-resume must not crash the chat tab.
  const resumeSession = useCallback(async (agentId: string): Promise<void> => {
    if (!runtimeAvailable) return;
    const agent = agentsRef.current.find(a => a.id === agentId);
    if (!agent) return;
    try {
      await ensureSession(agent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendMessage(agentId, {
        id: crypto.randomUUID(),
        role: 'error',
        body: message,
        createdAt: new Date().toISOString(),
      });
    }
  }, [runtimeAvailable, ensureSession, appendMessage]);

  const sendMessage = useCallback(async (agentId: string, body: string, attachments?: AgentImageAttachment[]): Promise<void> => {
    const agent = agentsRef.current.find(a => a.id === agentId);
    if (!agent) throw new Error('Unknown agent');
    if (!runtimeAvailable) {
      appendMessage(agentId, {
        id: crypto.randomUUID(),
        role: 'error',
        body: 'Agent runtime is only available in Electron for now.',
        createdAt: new Date().toISOString(),
      });
      return;
    }
    if (activeTurns[agentId]) return;

    appendMessage(agentId, {
      id: crypto.randomUUID(),
      role: 'user',
      body,
      createdAt: new Date().toISOString(),
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    });

    // Auto-name fresh chat records from the first user message. Keeps row
    // titles useful without forcing a config form.
    const existingMessageCount = sessionsRef.current[agentId]?.messages.length ?? 0;
    if (agent.kind === 'chat' && agent.name === 'New chat' && existingMessageCount <= 1) {
      const snippet = body.trim().replace(/\s+/g, ' ').slice(0, 48);
      if (snippet.length > 0) {
        const name = snippet.length < body.trim().length ? `${snippet}…` : snippet;
        // Persist the renamed chat. The slug stays the same — auto-rename
        // changes the display name only, so existing tabs and the file
        // location keep working.
        if (workspacePath) {
          void persistAgent(workspacePath, { ...agent, name, updatedAt: new Date().toISOString() }, agent.id);
        } else {
          setAgents(prev => prev.map(a => a.id === agentId ? { ...a, name, updatedAt: new Date().toISOString() } : a));
          renameTabsByPath(`agent://${agentId}`, name);
        }
      }
    }

    // Empty streaming placeholder so the ThinkingIndicator renders while we
    // wait for the first assistant event. Filled in by handleEvent as tokens
    // arrive.
    const assistantId = crypto.randomUUID();
    appendMessage(agentId, {
      id: assistantId,
      role: 'assistant',
      body: '',
      createdAt: new Date().toISOString(),
      streaming: true,
    });
    streamingMessageRef.current.set(agentId, { messageId: assistantId, accumulated: '', anthropicMessageId: null });

    setTurnActive(agentId, true);

    try {
      const handle = await ensureSession(agent);
      if (!handle) throw new Error('No runtime handle.');
      handle.sendUserMessage(
        body,
        attachments?.map(a => ({ mediaType: a.mediaType, base64: a.base64 })),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stream = streamingMessageRef.current.get(agentId);
      if (stream) {
        updateMessage(agentId, stream.messageId, { streaming: false });
        streamingMessageRef.current.delete(agentId);
      }
      appendMessage(agentId, {
        id: crypto.randomUUID(),
        role: 'error',
        body: message,
        createdAt: new Date().toISOString(),
      });
      setTurnActive(agentId, false);
    }
  }, [runtimeAvailable, activeTurns, appendMessage, updateMessage, setTurnActive, ensureSession, persistAgent, renameTabsByPath, workspacePath]);

  const cancelTurn = useCallback(async (agentId: string): Promise<void> => {
    await killSession(agentId);
    streamingMessageRef.current.delete(agentId);
    setTurnActive(agentId, false);
  }, [killSession, setTurnActive]);

  const getDraft = useCallback((agentId: string): AgentDraft => {
    // Return the stable empty default when no entry exists. Allocating a fresh
    // object here would break referential equality across renders and defeat
    // memoization in any consumer that uses the draft as an effect dep.
    return draftsRef.current.get(agentId) ?? EMPTY_DRAFT;
  }, []);

  const setDraft = useCallback((agentId: string, patch: Partial<AgentDraft>): void => {
    const current = draftsRef.current.get(agentId) ?? EMPTY_DRAFT;
    const next: AgentDraft = {
      input: patch.input !== undefined ? patch.input : current.input,
      attachments: patch.attachments !== undefined ? patch.attachments : current.attachments,
    };
    if (next.input === '' && next.attachments.length === 0) {
      // Empty drafts don't need a Map entry — saves memory and prevents key
      // accumulation for sent-and-cleared chats.
      draftsRef.current.delete(agentId);
      return;
    }
    draftsRef.current.set(agentId, next);
  }, []);

  const respondToPermission = useCallback((
    agentId: string,
    messageId: string,
    decision: 'allow' | 'deny',
    opts?: { message?: string; updatedInput?: Record<string, unknown> },
  ): void => {
    const session = sessionsRef.current[agentId];
    const message = session?.messages.find(m => m.id === messageId);
    const req = message?.permissionRequest;
    if (!req || req.status !== 'pending') return;

    const handle = sessionHandlesRef.current.get(agentId);
    if (!handle) {
      showToast('No active session — restart the agent and try again.', 'warning');
      return;
    }
    handle.respondToPermission(req.toolUseId, decision, opts);
    updateMessage(agentId, messageId, {
      permissionRequest: { ...req, status: decision === 'allow' ? 'allowed' : 'denied', decidedAt: new Date().toISOString() },
    });
  }, [showToast, updateMessage]);

  // === Effects (last) ===

  // Folders snapshot stays in sync with agents + folder paths. Pure function
  // of two inputs, so a single effect that watches both is the right shape
  // (the alternative — recomputing inside both setters — duplicates logic
  // and risks drifting whenever a new mutator is added).
  useEffect(() => {
    setFolders(computeFoldersSnapshot(agents));
  }, [agents, folderPaths, computeFoldersSnapshot]);

  // After agents load (or reload), drop any open `agent://<id>` tab whose
  // id no longer resolves to a file. Two scenarios produce stale tabs:
  //   1. A persisted session restore from the legacy UUID-based scheme
  //      points at a UUID that no longer matches any agent.
  //   2. The agent file was deleted in another window and our watcher
  //      reloaded into a smaller agent set.
  // Bail out until isLoaded — during the brief reset->load window
  // `agents` is empty even though tabs may legitimately reference real
  // (about-to-load) agents, and pruning then would close every chat
  // tab on every workspace open.
  useEffect(() => {
    if (!isLoaded) return;
    const validIds = new Set(agents.map(a => a.id));
    const stale: string[] = [];
    for (const tab of openTabs) {
      if (tab.type !== 'agent') continue;
      const id = tab.path.replace(/^agent:\/\//, '');
      if (!validIds.has(id)) stale.push(tab.id);
    }
    if (stale.length === 0) return;
    for (const tabId of stale) closeTab(tabId);
  }, [agents, isLoaded, openTabs, closeTab]);

  // Load (and reload on workspace switch). Each branch operates on its own
  // captured `workspace` so a stale resolution that lands after we've
  // moved on to another workspace can be detected and discarded via the
  // `cancelled` flag + the loadedWorkspaceRef comparison.
  useEffect(() => {
    let cancelled = false;
    loadedWorkspaceRef.current = null;

    // Reset on every workspace change. Sessions are killed because their
    // handles point at the previous workspace's `cwd` and would mutate the
    // wrong tree if the user resumed them.
    setIsLoaded(false);
    setAgents([]);
    setFolderPaths([]);
    setFolders(EMPTY_FOLDERS);
    setSessions({});
    setActiveTurns({});
    streamingMessageRef.current.clear();
    // Per-chat drafts belong to the previous workspace's agents; drop them so
    // the new workspace's chats start with empty composers.
    draftsRef.current.clear();
    // Clear any pending session-cache flushes — they target the previous
    // workspace and there's nothing to flush in the new one yet.
    for (const t of sessionSaveTimersRef.current.values()) clearTimeout(t);
    sessionSaveTimersRef.current.clear();
    // Echo-suppression entries are workspace-scoped paths; abandon them.
    recentWriteTimesRef.current.clear();

    const handles = sessionHandlesRef.current;
    sessionHandlesRef.current = new Map();
    for (const handle of handles.values()) {
      try { void handle.stop(); } catch { /* ignore */ }
    }

    if (!workspacePath) {
      return () => { cancelled = true; };
    }

    const workspace = workspacePath;
    let unwatch: (() => void) | null = null;

    (async () => {
      // Drain any data still living in the legacy quipu-state.json into
      // the file-based store before we read from disk. Idempotent — a
      // workspace that has already been imported short-circuits to a
      // no-op. Concurrent calls (RepoContext also runs this) share a
      // single in-flight promise via the module's re-entry cache.
      try {
        await importLegacyDataForWorkspace(workspace);
      } catch (err) {
        console.warn('[legacy-import] failed:', err);
        // Continue — load whatever's already in files.
      }
      if (cancelled) return;

      // Assign stable UUIDs to any legacy agents whose id is still
      // path-derived. Moves their bound scratch dir + session cache to
      // the new UUID-keyed paths. Idempotent — already-migrated agents
      // are skipped.
      let migratedIds = new Map<string, string>();
      try {
        migratedIds = await migrateLegacyAgentIds(workspace);
      } catch (err) {
        console.warn('[agent-migration] failed:', err);
      }
      if (cancelled) return;

      const result = await reloadAgentsAndFolders(workspace, () => cancelled);
      if (cancelled) return;
      if (!result) {
        // Even on failure, mark loaded so the UI flips out of its
        // skeleton state. Empty + isLoaded=true is the right "fresh
        // workspace, nothing here yet" presentation.
        loadedWorkspaceRef.current = workspace;
        setIsLoaded(true);
        return;
      }

      setAgents(result.agents);
      setFolderPaths(result.folders);

      // Repath any open tabs that reference a migrated agent's old id.
      // The visible name comes from the now-loaded agent record. Both
      // chat (`agent://`) and editor (`agent-editor://`) tab paths are
      // updated.
      if (migratedIds.size > 0) {
        const byUuid = new Map(result.agents.map(a => [a.id, a.name] as const));
        for (const [legacyId, uuid] of migratedIds) {
          const name = byUuid.get(uuid);
          if (name === undefined) continue;
          renameTabPath(`agent://${legacyId}`, `agent://${uuid}`, name);
          renameTabPath(`agent-editor://${legacyId}`, `agent-editor://${uuid}`, name);
        }
      }

      // Hydrate session cache for any agent that has a persisted transcript.
      // This is fire-and-forget per agent — a missing/corrupt cache file
      // for one agent shouldn't block the others.
      const sessionEntries = await Promise.all(result.agents.map(async (a) => {
        try {
          const s = await sessionCache.loadSession(workspace, a.id);
          return s ? [a.id, s] as const : null;
        } catch (err) {
          console.warn('[agent] loadSession failed', a.id, err);
          return null;
        }
      }));
      if (cancelled) return;

      const merged: SessionMap = {};
      for (const entry of sessionEntries) {
        if (entry === null) continue;
        merged[entry[0]] = entry[1];
      }
      setSessions(merged);

      loadedWorkspaceRef.current = workspace;
      setIsLoaded(true);
    })();

    // Subscribe to file changes under .quipu/ so cross-window mutations
    // hydrate this window. Echo-suppression filters out our own writes —
    // see markRecentWrite/isRecentEcho. The watcher's debounce upstream
    // already coalesces rapid bursts.
    unwatch = watchDirRecursive(`${workspace}/.quipu`, (event) => {
      if (loadedWorkspaceRef.current !== workspace) return;
      if (event.path && isRecentEcho(event.path)) return;
      void (async () => {
        const result = await reloadAgentsAndFolders(workspace, () => loadedWorkspaceRef.current !== workspace);
        if (!result) return;
        if (loadedWorkspaceRef.current !== workspace) return;
        setAgents(result.agents);
        setFolderPaths(result.folders);
      })();
    });

    return () => {
      cancelled = true;
      if (unwatch) unwatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  const value: AgentContextValue = {
    agents,
    isLoaded,
    folders,
    getAgent,
    upsertAgent,
    createChat,
    deleteAgent,
    moveAgent,
    ensureAgentClones,
    createFolder,
    deleteFolder,
    renameFolder,
    getSession,
    clearSession,
    sendMessage,
    cancelTurn,
    isTurnActive,
    respondToPermission,
    resumeSession,
    runtimeAvailable,
    getDraft,
    setDraft,
  };

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) {
    throw new Error('useAgent must be used within an AgentProvider');
  }
  return ctx;
}
