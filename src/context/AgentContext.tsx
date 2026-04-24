import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import storage from '../services/storageService';
import fs from '../services/fileSystem';
import { startSession, isElectronAgentRuntime, type AgentSessionHandle } from '../services/agentRuntime';
import { useFileSystem } from './FileSystemContext';
import { useRepo } from './RepoContext';
import { useTab } from './TabContext';
import { useToast } from '../components/ui/Toast';
import type { Agent, AgentMessage, AgentSession, AgentToolCall, AgentPermissionRequest } from '@/types/agent';

const AGENTS_KEY = 'agents';
const SESSIONS_KEY = 'agent-sessions';
const FOLDERS_KEY = 'agent-folders';

type SessionMap = Record<string, AgentSession>;

/** Declared folder names per kind — lets users keep empty folders. */
export interface AgentFolders {
  chats: string[];
  agents: string[];
}

const EMPTY_FOLDERS: AgentFolders = { chats: [], agents: [] };

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
  sendMessage: (agentId: string, body: string) => Promise<void>;
  cancelTurn: (agentId: string) => Promise<void>;
  isTurnActive: (agentId: string) => boolean;
  respondToPermission: (agentId: string, messageId: string, decision: 'allow' | 'deny') => void;
  runtimeAvailable: boolean;
}

const AgentContext = createContext<AgentContextValue | null>(null);

function summarizeToolUse(name: string, rawInput: unknown): string {
  const input = (rawInput && typeof rawInput === 'object') ? (rawInput as Record<string, unknown>) : {};
  const trim = (s: string, max = 96) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const path = typeof input.file_path === 'string' ? input.file_path : '';
      return path ? `${name} ${trim(path)}` : name;
    }
    case 'Bash': {
      const cmd = typeof input.command === 'string' ? input.command.replace(/\s+/g, ' ') : '';
      return cmd ? `Bash: ${trim(cmd)}` : 'Bash';
    }
    case 'Grep': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      const path = typeof input.path === 'string' ? ` in ${input.path}` : '';
      return pattern ? `Grep ${trim(pattern)}${path}` : 'Grep';
    }
    case 'Glob': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      return pattern ? `Glob ${trim(pattern)}` : 'Glob';
    }
    case 'WebFetch':
    case 'WebSearch': {
      const q = typeof input.url === 'string' ? input.url : (typeof input.query === 'string' ? input.query : '');
      return q ? `${name} ${trim(q)}` : name;
    }
    case 'TodoWrite':
      return 'Updated todo list';
    default:
      return name;
  }
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

  return lines.join('\n');
}

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { workspacePath } = useFileSystem();
  const { cloneRepoForAgent, repos } = useRepo();
  const { renameTabsByPath } = useTab();
  const { showToast } = useToast();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [folders, setFolders] = useState<AgentFolders>(EMPTY_FOLDERS);
  const [sessions, setSessions] = useState<SessionMap>({});
  const [activeTurns, setActiveTurns] = useState<Record<string, boolean>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const runtimeAvailable = isElectronAgentRuntime();

  // Persistent session handles, one per agent.
  const sessionHandlesRef = useRef<Map<string, AgentSessionHandle>>(new Map());
  // Assistant message currently being streamed per agent.
  const streamingMessageRef = useRef<Map<string, { messageId: string; accumulated: string; anthropicMessageId: string | null }>>(new Map());

  const sessionsRef = useRef<SessionMap>(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const agentsRef = useRef<Agent[]>(agents);
  useEffect(() => { agentsRef.current = agents; }, [agents]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      storage.get(AGENTS_KEY).catch(() => null),
      storage.get(SESSIONS_KEY).catch(() => null),
      storage.get(FOLDERS_KEY).catch(() => null),
    ]).then(([savedAgents, savedSessions, savedFolders]) => {
      if (cancelled) return;
      if (savedFolders && typeof savedFolders === 'object') {
        const f = savedFolders as Partial<AgentFolders>;
        setFolders({
          chats: Array.isArray(f.chats) ? f.chats : [],
          agents: Array.isArray(f.agents) ? f.agents : [],
        });
      }
      if (Array.isArray(savedAgents)) {
        const normalized = (savedAgents as Partial<Agent>[]).map((a) => ({
          ...a,
          kind: a.kind ?? 'agent',
          bindings: Array.isArray(a.bindings) ? a.bindings : [],
          permissionMode: a.permissionMode ?? 'default',
          allowedTools: Array.isArray(a.allowedTools) ? a.allowedTools : undefined,
        })) as Agent[];
        setAgents(normalized);
      }
      if (savedSessions && typeof savedSessions === 'object') {
        setSessions(savedSessions as SessionMap);
      }
      setIsLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    storage.set(AGENTS_KEY, agents).catch(() => {});
  }, [agents, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    storage.set(SESSIONS_KEY, sessions).catch(() => {});
  }, [sessions, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    storage.set(FOLDERS_KEY, folders).catch(() => {});
  }, [folders, isLoaded]);

  const getAgent = useCallback((id: string) => agents.find(a => a.id === id), [agents]);

  const upsertAgent = useCallback((agent: Agent) => {
    setAgents(prev => {
      const idx = prev.findIndex(a => a.id === agent.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = agent;
        return next;
      }
      return [...prev, agent];
    });
  }, []);

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

  const moveAgent = useCallback((id: string, patch: { folder?: string; kind?: 'agent' | 'chat' }) => {
    const now = new Date().toISOString();
    setAgents(prev => prev.map(a => a.id !== id ? a : ({
      ...a,
      folder: patch.folder !== undefined ? (patch.folder || undefined) : a.folder,
      kind: patch.kind ?? a.kind,
      updatedAt: now,
    })));
  }, []);

  const createFolder = useCallback((kind: 'agent' | 'chat', name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setFolders(prev => {
      const key = kind === 'agent' ? 'agents' : 'chats';
      if (prev[key].includes(trimmed)) return prev;
      return { ...prev, [key]: [...prev[key], trimmed] };
    });
  }, []);

  const deleteFolder = useCallback((kind: 'agent' | 'chat', name: string) => {
    const key = kind === 'agent' ? 'agents' : 'chats';
    setFolders(prev => ({ ...prev, [key]: prev[key].filter(f => f !== name) }));
    // Move any items of that kind+folder back to root.
    setAgents(prev => prev.map(a => {
      if (a.kind !== kind || a.folder !== name) return a;
      return { ...a, folder: undefined, updatedAt: new Date().toISOString() };
    }));
  }, []);

  const renameFolder = useCallback((kind: 'agent' | 'chat', oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const key = kind === 'agent' ? 'agents' : 'chats';
    setFolders(prev => ({ ...prev, [key]: prev[key].map(f => f === oldName ? trimmed : f) }));
    setAgents(prev => prev.map(a => {
      if (a.kind !== kind || a.folder !== oldName) return a;
      return { ...a, folder: trimmed, updatedAt: new Date().toISOString() };
    }));
  }, []);

  const createChat = useCallback((opts?: { folder?: string; name?: string }): Agent => {
    const now = new Date().toISOString();
    const chat: Agent = {
      id: crypto.randomUUID(),
      name: opts?.name ?? 'New chat',
      kind: 'chat',
      systemPrompt: '',
      model: 'claude-sonnet-4-5',
      bindings: [],
      permissionMode: 'default',
      folder: opts?.folder,
      createdAt: now,
      updatedAt: now,
    };
    setAgents(prev => [...prev, chat]);
    return chat;
  }, []);

  const killSession = useCallback(async (agentId: string) => {
    const handle = sessionHandlesRef.current.get(agentId);
    if (handle) {
      sessionHandlesRef.current.delete(agentId);
      try { await handle.stop(); } catch { /* ignore */ }
    }
  }, []);

  const deleteAgent = useCallback((id: string) => {
    void killSession(id);
    setAgents(prev => prev.filter(a => a.id !== id));
    setSessions(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [killSession]);

  const getSession = useCallback((agentId: string) => sessions[agentId], [sessions]);

  const clearSession = useCallback((agentId: string) => {
    void killSession(agentId);
    setSessions(prev => {
      if (!prev[agentId]) return prev;
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
  }, [killSession]);

  const isTurnActive = useCallback((agentId: string) => !!activeTurns[agentId], [activeTurns]);

  const setTurnActive = useCallback((agentId: string, active: boolean) => {
    setActiveTurns(prev => {
      if (!!prev[agentId] === active) return prev;
      const next = { ...prev };
      if (active) next[agentId] = true; else delete next[agentId];
      return next;
    });
  }, []);

  const appendMessage = useCallback((agentId: string, message: AgentMessage) => {
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
  }, []);

  const updateMessage = useCallback((agentId: string, messageId: string, patch: Partial<AgentMessage>) => {
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
  }, []);

  const setSessionId = useCallback((agentId: string, claudeSessionId: string) => {
    setSessions(prev => {
      const existing = prev[agentId] ?? { agentId, messages: [], updatedAt: new Date().toISOString() };
      if (existing.claudeSessionId === claudeSessionId) return prev;
      return {
        ...prev,
        [agentId]: { ...existing, claudeSessionId, updatedAt: new Date().toISOString() },
      };
    });
  }, []);

  const handleEvent = useCallback((agentId: string, event: Record<string, unknown>) => {
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
          newToolCalls.push({
            id: block.id,
            name: block.name,
            summary: summarizeToolUse(block.name, block.input),
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
          return `• ${summarizeToolUse(toolName, obj.tool_input)}`;
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
        const input = (inner.input && typeof inner.input === 'object') ? inner.input : {};
        const request: AgentPermissionRequest = {
          toolUseId: requestId,
          toolName,
          summary: summarizeToolUse(toolName, input),
          inputJson: (() => { try { return JSON.stringify(input, null, 2); } catch { return ''; } })(),
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
  }, [appendMessage, updateMessage, setSessionId, setTurnActive]);

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

  const sendMessage = useCallback(async (agentId: string, body: string) => {
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
    });

    // Auto-name fresh chat records from the first user message. Keeps row
    // titles useful without forcing a config form.
    const existingMessageCount = sessionsRef.current[agentId]?.messages.length ?? 0;
    if (agent.kind === 'chat' && agent.name === 'New chat' && existingMessageCount <= 1) {
      const snippet = body.trim().replace(/\s+/g, ' ').slice(0, 48);
      if (snippet.length > 0) {
        const name = snippet.length < body.trim().length ? `${snippet}…` : snippet;
        setAgents(prev => prev.map(a => a.id === agentId ? { ...a, name, updatedAt: new Date().toISOString() } : a));
        // Keep any open chat tab in sync with the new name.
        renameTabsByPath(`agent://${agentId}`, name);
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
      handle.sendUserMessage(body);
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
  }, [runtimeAvailable, activeTurns, appendMessage, updateMessage, setTurnActive, ensureSession]);

  const cancelTurn = useCallback(async (agentId: string) => {
    await killSession(agentId);
    streamingMessageRef.current.delete(agentId);
    setTurnActive(agentId, false);
  }, [killSession, setTurnActive]);

  const respondToPermission = useCallback((agentId: string, messageId: string, decision: 'allow' | 'deny') => {
    const session = sessionsRef.current[agentId];
    const message = session?.messages.find(m => m.id === messageId);
    const req = message?.permissionRequest;
    if (!req || req.status !== 'pending') return;

    const handle = sessionHandlesRef.current.get(agentId);
    if (!handle) {
      showToast('No active session — restart the agent and try again.', 'warning');
      return;
    }
    handle.respondToPermission(req.toolUseId, decision);
    updateMessage(agentId, messageId, {
      permissionRequest: { ...req, status: decision === 'allow' ? 'allowed' : 'denied', decidedAt: new Date().toISOString() },
    });
  }, [showToast, updateMessage]);

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
    runtimeAvailable,
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
