export interface AgentBinding {
  id: string;
  source: 'workspace' | 'repo';
  /** repo id when source === 'repo'; undefined when source === 'workspace' */
  repoId?: string;
  /** path relative to the binding source root */
  subpath: string;
  /** prose telling the agent why this context matters */
  documentation: string;
}

export type AgentPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'auto' | 'plan';

export type AgentKind = 'agent' | 'chat';

export interface Agent {
  id: string;
  name: string;
  /** 'agent' = full configuration, opens editor on create. 'chat' = lightweight, opens chat directly. */
  kind: AgentKind;
  systemPrompt: string;
  model: string;
  bindings: AgentBinding[];
  permissionMode: AgentPermissionMode;
  /** Optional grouping folder shown in the Agents panel. */
  folder?: string;
  /**
   * Optional whitelist of tools the agent is allowed to use. Empty = rely on
   * permissionMode. Entries are Claude Code tool specifiers, e.g. "Read",
   * "Bash(git *)", "Edit".
   */
  allowedTools?: string[];
  createdAt: string;
  updatedAt: string;
}

export type AgentMessageRole = 'user' | 'assistant' | 'system' | 'error' | 'permission-request';

export type AgentPermissionStatus = 'pending' | 'allowed' | 'denied';

export interface AgentPermissionRequest {
  /** Tool use id from Claude's stream-json — used to correlate the response. */
  toolUseId: string;
  toolName: string;
  /** Short summary ready for UI (e.g. "Bash: curl …"). */
  summary: string;
  /** Raw input for the tool call, serialized. */
  inputJson: string;
  status: AgentPermissionStatus;
  decidedAt?: string;
}

export interface AgentToolCall {
  id: string;
  name: string;
  /** Short one-line summary derived from the tool input (e.g. "Read src/App.tsx"). */
  summary: string;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  body: string;
  createdAt: string;
  /** partial while streaming, final when complete */
  streaming?: boolean;
  /** Tool uses the assistant invoked during this turn (assistant role only). */
  toolCalls?: AgentToolCall[];
  /** Populated when role === 'permission-request'. */
  permissionRequest?: AgentPermissionRequest;
}

export interface AgentSession {
  agentId: string;
  /** Claude session id returned by the CLI; used for --resume on subsequent turns */
  claudeSessionId?: string;
  messages: AgentMessage[];
  updatedAt: string;
}

export interface Repo {
  id: string;
  name: string;
  url: string;
  folder?: string;
  localClonePath?: string;
  createdAt: string;
  updatedAt: string;
}
