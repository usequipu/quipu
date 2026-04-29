/** Type declarations for the Electron preload contextBridge API */

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface DirectoryChangedEvent {
  type: string;
  path?: string;
}

export interface FrameChangedEvent {
  filename: string;
}

export interface TerminalDataEvent {
  terminalId: string;
  data: string;
}

export interface ElectronAPI {
  // File system
  readDirectory: (dirPath: string) => Promise<DirectoryEntry[]>;
  pathExists: (targetPath: string) => Promise<boolean>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
  createFile: (filePath: string) => Promise<{ success: boolean }>;
  createFolder: (folderPath: string) => Promise<{ success: boolean }>;
  renamePath: (oldPath: string, newPath: string) => Promise<{ success: boolean }>;
  deletePath: (targetPath: string) => Promise<{ success: boolean }>;
  openFolderDialog: () => Promise<string | null>;
  openFileDialog: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
  openNewWindow: () => Promise<{ success: boolean }>;
  getHomeDir: () => Promise<string>;
  uploadImage: (filePath: string, base64Data: string) => Promise<{ success: boolean; url?: string }>;

  // File watching
  watchDirectory: (dirPath: string | null) => Promise<{ success: boolean } | null>;
  onDirectoryChanged: (callback: (event: DirectoryChangedEvent) => void) => void;
  removeDirectoryListener: () => void;

  // Frame watching
  watchFrameDirectory: (workspacePath: string) => Promise<void>;
  onFrameChanged: (callback: (event: FrameChangedEvent) => void) => void;
  removeFrameListener: () => void;

  // Frame anchor resolution
  resolveFrameAnnotations: (workspacePath: string, filePath: string, plainText?: string) => Promise<{ resolved: number; error?: string }>;

  // Git
  gitStatus: (dirPath: string) => Promise<unknown>;
  gitDiff: (dirPath: string, file: string, staged: boolean) => Promise<string>;
  gitStage: (dirPath: string, files: string[]) => Promise<unknown>;
  gitUnstage: (dirPath: string, files: string[]) => Promise<unknown>;
  gitCommit: (dirPath: string, message: string) => Promise<unknown>;
  gitPush: (dirPath: string) => Promise<unknown>;
  gitPull: (dirPath: string) => Promise<unknown>;
  gitClone: (url: string, targetDir: string) => Promise<{ output: string }>;
  gitBranches: (dirPath: string) => Promise<unknown>;
  gitCheckout: (dirPath: string, branch: string) => Promise<unknown>;
  gitLog: (dirPath: string) => Promise<unknown>;

  // Search
  searchFiles: (dirPath: string, query: string, options: SearchOptions) => Promise<SearchResult[]>;
  listFilesRecursive: (dirPath: string, limit: number) => Promise<string[]>;

  // Terminal
  createTerminal: (options?: { cwd?: string }) => Promise<{ terminalId: string }>;
  writeTerminal: (terminalId: string, data: string) => void;
  resizeTerminal: (terminalId: string, cols: number, rows: number) => void;
  killTerminal: (terminalId: string) => Promise<void>;
  onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void;
  removeTerminalDataListener: (callback: (event: TerminalDataEvent) => void) => void;

  // Storage
  storageGet: (key: string) => Promise<unknown>;
  storageSet: (key: string, value: unknown) => Promise<void>;

  // Kernel / Jupyter
  kernelStart: (venvPath: string, workspaceRoot: string) => Promise<KernelStartResult>;
  kernelStop: () => Promise<{ success: boolean }>;
  kernelValidate: (venvPath: string) => Promise<KernelValidateResult>;
  kernelProxyRest: (method: string, path: string, body: unknown) => Promise<unknown>;
  kernelGetChannelUrl: (kernelId: string) => Promise<string>;

  // Plugin management
  getQuipuDir: () => Promise<string>;
  readPluginsConfig: () => Promise<string | null>;
  writePluginsConfig: (content: string) => Promise<{ success: boolean }>;
  listPluginDirs: () => Promise<string[]>;
  removePluginDir: (id: string) => Promise<{ success: boolean }>;
  downloadAndExtractPlugin: (params: { id: string; downloadUrl: string }) => Promise<{ success: true } | { error: string }>;

  // Kamalu OAuth
  kamaluStartOAuth: (signInUrl: string) => Promise<{ token: string; serverUrl: string | null }>;

  // Agent subprocess — legacy per-turn spawn.
  agentSpawn: (agentId: string, options: AgentSpawnOptions) => Promise<{ spawnId: string }>;
  agentKill: (spawnId: string) => Promise<{ success: boolean }>;
  onAgentEvent: (callback: (event: AgentEventPayload) => void) => unknown;
  removeAgentEventListener: (handler: unknown) => void;
  onAgentExit: (callback: (event: AgentExitPayload) => void) => unknown;
  removeAgentExitListener: (handler: unknown) => void;

  // Persistent agent session — stream-json I/O with permission prompts.
  agentSessionStart: (agentId: string, options: AgentSessionStartOptions) => Promise<{ sessionKey: string; reused: boolean }>;
  agentSessionWrite: (sessionKey: string, payload: unknown) => void;
  agentSessionStop: (sessionKey: string) => Promise<{ success: boolean }>;
  onAgentSessionEvent: (callback: (event: AgentSessionEventPayload) => void) => unknown;
  removeAgentSessionEventListener: (handler: unknown) => void;
  onAgentSessionExit: (callback: (event: AgentSessionExitPayload) => void) => unknown;
  removeAgentSessionExitListener: (handler: unknown) => void;

  claudeListSlashCommands: (cwd?: string) => Promise<ClaudeSlashCommandProbeResult>;
}

export interface AgentSessionStartOptions {
  systemPrompt?: string;
  model?: string;
  addDirs?: string[];
  resumeSessionId?: string;
  cwd?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'auto' | 'dontAsk' | 'plan';
  allowedTools?: string[];
}

export interface AgentSessionEventPayload {
  sessionKey: string;
  agentId: string;
  event: Record<string, unknown>;
}

export interface AgentSessionExitPayload {
  sessionKey: string;
  agentId: string;
  code: number | null;
  signal: string | null;
}

export interface ClaudeSlashCommandProbeResult {
  slashCommands?: string[];
  plugins?: Array<{ name: string; path: string; source?: string }>;
  skills?: string[];
  error?: string;
}

export interface AgentSpawnOptions {
  message: string;
  systemPrompt?: string;
  model?: string;
  addDirs?: string[];
  resumeSessionId?: string;
  cwd?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
}

export interface AgentEventPayload {
  spawnId: string;
  agentId: string;
  event: Record<string, unknown>;
}

export interface AgentExitPayload {
  spawnId: string;
  agentId: string;
  code: number | null;
  signal: string | null;
}

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
}

export interface SearchResult {
  path: string;
  line: number;
  content: string;
}

export interface KernelStartResult {
  success: boolean;
  port?: number;
  error?: string;
}

export interface KernelValidateResult {
  valid: boolean;
  pythonPath?: string;
  error?: string;
}

export interface QuipuConfig {
  serverUrl?: string;
  wsUrl?: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __QUIPU_CONFIG__?: QuipuConfig;
  }
}
