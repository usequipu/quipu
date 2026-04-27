import { useEffect, useRef, useState } from 'react';
import {
  RobotIcon,
  PencilSimpleIcon,
  PaperPlaneTiltIcon,
  StopIcon,
  TrashIcon,
  PlusIcon,
  WarningIcon,
  WrenchIcon,
  CheckIcon,
  XIcon,
  ShieldIcon,
} from '@phosphor-icons/react';
import type { Tab } from '@/types/tab';
import type { AgentMessage, AgentImageAttachment, AgentToolCall, AgentPermissionRequest, Agent } from '@/types/agent';

function extFromMime(mime: string): string {
  const m = mime.split('/')[1] ?? 'png';
  if (m === 'jpeg') return 'jpg';
  return m;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

function openableFilePath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const fp = input.file_path;
  return typeof fp === 'string' && fp.length > 0 ? fp : null;
}

/**
 * Resolve a tool's `file_path` to an absolute on-disk path. Claude Code usually
 * emits absolute paths, but if it's relative we resolve it against the agent's
 * primary working context — its first repo-binding clone if any, otherwise the
 * workspace root. This matches the cwd/--add-dir layout the agent runs under.
 */
function resolveAgentFilePath(
  filePath: string,
  agent: Agent | undefined,
  workspacePath: string | null,
  repos: Array<{ id: string; name: string }>,
): string | null {
  if (!filePath) return null;
  if (filePath.startsWith('/')) return filePath;
  if (!workspacePath) return null;
  const base = workspacePath.replace(/\/+$/, '');
  if (agent) {
    for (const b of agent.bindings ?? []) {
      if (b.source === 'repo' && b.repoId) {
        const repo = repos.find(r => r.id === b.repoId);
        if (!repo) continue;
        const cloneRoot = `${base}/tmp/${agent.id}/repos/${repo.name}`;
        const rooted = b.subpath ? `${cloneRoot}/${b.subpath.replace(/^\/+|\/+$/g, '')}` : cloneRoot;
        return `${rooted}/${filePath}`;
      }
    }
  }
  return `${base}/${filePath}`;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function FilePathLink({
  display,
  absolutePath,
  className,
}: {
  display: string;
  absolutePath: string | null;
  className?: string;
}) {
  const { openFile } = useTab();
  if (!absolutePath) {
    return <span className={className}>{display}</span>;
  }
  return (
    <span
      role="link"
      tabIndex={0}
      title={`Open ${absolutePath}`}
      className={`${className ?? ''} hover:underline hover:text-accent cursor-pointer`}
      onClick={(e) => {
        e.stopPropagation();
        void openFile(absolutePath, basename(absolutePath));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          void openFile(absolutePath, basename(absolutePath));
        }
      }}
    >
      {display}
    </span>
  );
}
import { useTab } from '../../context/TabContext';
import { useAgent } from '../../context/AgentContext';
import { useFileSystem } from '../../context/FileSystemContext';
import { useRepo } from '../../context/RepoContext';
import ThinkingIndicator from './ThinkingIndicator';
import MessageMarkdown from './MessageMarkdown';
import SlashPopover, { filterSlashCommands, type SlashCommand } from './SlashPopover';
import { useClaudeCommands } from './useClaudeCommands';
import ModelPicker from './ModelPicker';

interface ChatViewProps {
  tab: Tab;
}

export default function ChatView({ tab }: ChatViewProps) {
  const { openAgentEditorTab } = useTab();
  const { workspacePath } = useFileSystem();
  const { repos } = useRepo();
  const {
    getAgent,
    getSession,
    sendMessage,
    cancelTurn,
    clearSession,
    isTurnActive,
    respondToPermission,
    upsertAgent,
    ensureAgentClones,
    runtimeAvailable,
  } = useAgent();
  const agentId = tab.path.replace(/^agent:\/\//, '');

  // Kick off clones eagerly when the chat opens so the first message doesn't wait.
  useEffect(() => {
    if (!agentId) return;
    void ensureAgentClones(agentId);
  }, [agentId, ensureAgentClones]);
  const agent = getAgent(agentId);
  const session = getSession(agentId);
  const active = isTurnActive(agentId);
  const displayName = agent?.name ?? tab.name;

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AgentImageAttachment[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const allSlashCommands = useClaudeCommands();
  const isSlashQuery = input.startsWith('/') && !input.includes('\n') && !input.includes(' ');
  const slashResults = isSlashQuery ? filterSlashCommands(input, allSlashCommands) : [];
  const showSlashPopover = isSlashQuery;

  // Keep the slash selection in range when filtering.
  useEffect(() => {
    if (slashIndex >= slashResults.length && slashResults.length > 0) setSlashIndex(0);
  }, [slashResults.length, slashIndex]);

  // Autoscroll to bottom on new messages or streaming updates.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [session?.messages, active]);

  // Auto-grow textarea as the user types.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const messages = session?.messages ?? [];

  const handleSend = async () => {
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || !agent || active) return;
    const pendingAttachments = attachments;
    setInput('');
    setAttachments([]);
    try {
      await sendMessage(agent.id, trimmed, pendingAttachments.length > 0 ? pendingAttachments : undefined);
    } catch {
      /* surfaced as an error message in the transcript */
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const imageItems = Array.from(items).filter(i => i.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const now = Date.now();
    const additions: AgentImageAttachment[] = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      try {
        const base64 = await blobToBase64(file);
        additions.push({
          id: crypto.randomUUID(),
          mediaType: item.type,
          base64,
          name: file.name && file.name !== 'image.png' ? file.name : `pasted-${now}.${extFromMime(item.type)}`,
        });
      } catch (err) {
        console.warn('[chat] failed to read pasted image', err);
      }
    }
    if (additions.length > 0) {
      setAttachments(prev => [...prev, ...additions]);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const applySlashCommand = (cmd: SlashCommand) => {
    if (cmd.id === 'clear') {
      setInput('');
      handleClear();
      return;
    }
    setInput(cmd.template);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(cmd.template.length, cmd.template.length);
      }
    });
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashPopover && slashResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashResults.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashResults.length) % slashResults.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const cmd = slashResults[slashIndex];
        if (cmd) applySlashCommand(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleCancel = () => { void cancelTurn(agentId); };

  const handleClear = () => {
    if (messages.length === 0) return;
    if (!window.confirm('Clear the conversation with this agent?')) return;
    clearSession(agentId);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-bg-base text-text-primary">
      <div className="flex items-center justify-between h-12 px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded bg-accent-muted flex items-center justify-center shrink-0">
            <RobotIcon size={16} className="text-accent" weight="regular" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">{displayName}</span>
            <span className="text-[11px] text-text-tertiary font-mono truncate">agent://{agentId}</span>
          </div>
          {agent && (agent.bindings?.length ?? 0) > 0 && (
            <span
              className="ml-1 inline-flex items-center gap-1 px-2 h-6 rounded bg-bg-elevated text-[11px] text-text-secondary shrink-0"
              title={`${agent.bindings.length} context binding${agent.bindings.length === 1 ? '' : 's'}`}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Context</span>
              <span>{agent.bindings.length}</span>
            </span>
          )}
          {active && (
            <span className="ml-1 inline-flex items-center gap-1 px-2 h-6 rounded bg-accent-muted text-[11px] text-accent shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              running
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && !active && (
            <button
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded text-text-tertiary hover:text-error hover:bg-bg-elevated transition-colors"
              onClick={handleClear}
              title="Clear conversation"
            >
              <TrashIcon size={13} />
              Clear
            </button>
          )}
          {agent && (
            <button
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
              onClick={() => openAgentEditorTab(agent.id, agent.name)}
              title="Edit agent"
            >
              <PencilSimpleIcon size={13} />
              Edit
            </button>
          )}
        </div>
      </div>

      {!runtimeAvailable && (
        <div className="px-4 py-2 text-[11px] text-warning border-b border-border bg-warning/10">
          Agent runtime is only available in Electron. Browser support lands later.
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
        {messages.length === 0 ? (
          <EmptyState agentName={displayName} present={!!agent} />
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-8">
            <ul className="flex flex-col">
              {messages.map((m, idx) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  isFirst={idx === 0}
                  isLastAssistant={
                    m.role === 'assistant'
                    && !messages.slice(idx + 1).some((n) => n.role === 'assistant')
                  }
                  onRespondPermission={(decision) => agent && respondToPermission(agent.id, m.id, decision)}
                  agent={agent}
                  workspacePath={workspacePath}
                  repos={repos}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 shrink-0">
        <div
          className="max-w-3xl mx-auto relative rounded-3xl border border-border bg-bg-surface shadow-sm focus-within:border-accent transition-colors"
        >
          {showSlashPopover && (
            <SlashPopover
              query={input}
              commands={allSlashCommands}
              activeIndex={slashIndex}
              onSelect={applySlashCommand}
              onIndexChange={setSlashIndex}
            />
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map((a) => (
                <div key={a.id} className="relative group/thumb">
                  <img
                    src={`data:${a.mediaType};base64,${a.base64}`}
                    alt={a.name ?? 'pasted image'}
                    className="h-16 w-16 rounded border border-border object-cover"
                  />
                  <button
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-bg-base border border-border text-text-tertiary opacity-0 group-hover/thumb:opacity-100 hover:text-error transition-opacity"
                    onClick={() => removeAttachment(a.id)}
                    title="Remove attachment"
                    aria-label="Remove attachment"
                  >
                    <XIcon size={10} weight="bold" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="w-full px-4 pt-3 pb-1 bg-transparent text-sm resize-none focus:outline-none placeholder:text-text-tertiary"
            style={{ minHeight: '44px', maxHeight: '200px' }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            onPaste={handlePaste}
            placeholder={active ? 'Agent is responding…' : `Reply to ${displayName}…`}
            disabled={active || !agent}
            rows={1}
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <button
              className="w-8 h-8 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
              title="Attach context (not wired)"
              disabled
            >
              <PlusIcon size={14} />
            </button>
            <div className="flex items-center gap-2">
              <ModelPicker
                value={agent?.model}
                disabled={!agent || active}
                onChange={(modelId) => {
                  if (!agent || modelId === agent.model) return;
                  upsertAgent({ ...agent, model: modelId, updatedAt: new Date().toISOString() });
                  // Kill the current subprocess so the next message spawns with the new model.
                  // The next ensureSession will --resume the claude session id, preserving context.
                  void cancelTurn(agent.id);
                }}
              />
              {active ? (
                <button
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-warning text-white hover:opacity-90 transition-opacity"
                  onClick={handleCancel}
                  title="Stop the agent"
                >
                  <StopIcon size={13} weight="fill" />
                </button>
              ) : (
                <button
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={handleSend}
                  disabled={(!input.trim() && attachments.length === 0) || !agent}
                  title="Send (Enter)"
                >
                  <PaperPlaneTiltIcon size={13} weight="fill" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ agentName, present }: { agentName: string; present: boolean }) {
  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="flex flex-col items-center text-center max-w-sm">
        <RobotIcon size={40} className="text-text-tertiary mb-3" weight="light" />
        <p className="text-sm text-text-secondary mb-1">
          {present ? `Chat with ${agentName}` : 'Agent not found'}
        </p>
        <p className="text-xs text-text-tertiary">
          {present
            ? 'Type below to start a conversation. The agent runs as a Claude Code subprocess.'
            : 'This agent may have been deleted. Close this tab and pick another from the Agents panel.'}
        </p>
      </div>
    </div>
  );
}

interface MessageItemProps {
  message: AgentMessage;
  isFirst: boolean;
  isLastAssistant: boolean;
  onRespondPermission: (decision: 'allow' | 'deny') => void;
  agent: Agent | undefined;
  workspacePath: string | null;
  repos: Array<{ id: string; name: string }>;
}

function MessageItem({ message, isFirst, onRespondPermission, agent, workspacePath, repos }: MessageItemProps) {
  if (message.role === 'permission-request' && message.permissionRequest) {
    const req = message.permissionRequest;
    const pending = req.status === 'pending';
    const isQuestion = req.toolName === 'AskUserQuestion';
    const headerLabel = isQuestion ? 'Question' : 'Permission requested';
    const HeaderIcon = ShieldIcon;
    return (
      <li className={`${isFirst ? '' : 'mt-6'}`}>
        <div className="rounded-xl border border-warning/50 bg-warning/10 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <HeaderIcon size={14} className="text-warning shrink-0" weight="fill" />
            <span className="text-xs font-semibold text-warning uppercase tracking-wider">{headerLabel}</span>
            {!pending && (
              <span className={`text-[11px] px-2 py-0.5 rounded ${req.status === 'allowed' ? 'bg-success/20 text-success' : 'bg-error/20 text-error'}`}>
                {req.status}
              </span>
            )}
          </div>

          {isQuestion
            ? <AskQuestionBody input={req.input} />
            : (
              <>
                <div className="text-sm break-words mb-2">
                  <span className="font-semibold">{req.action}</span>
                  {req.path && (
                    <FilePathLink
                      display={req.path}
                      absolutePath={resolveAgentFilePath(openableFilePath(req.input) ?? '', agent, workspacePath, repos)}
                      className="ml-2 font-mono text-text-secondary"
                    />
                  )}
                  {req.detail && <span className="ml-2 font-mono text-text-secondary">{req.detail}</span>}
                </div>
                <ToolDetail action={req.action} input={req.input} />
              </>
            )}

          {pending && (
            <div className="flex items-center gap-2 mt-3">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-success text-white hover:opacity-90 transition-opacity"
                onClick={() => onRespondPermission('allow')}
              >
                <CheckIcon size={12} weight="bold" />
                {isQuestion ? 'Let agent answer' : 'Allow once'}
              </button>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-text-secondary hover:text-error hover:border-error transition-colors"
                onClick={() => onRespondPermission('deny')}
              >
                <XIcon size={12} weight="bold" />
                {isQuestion ? 'Cancel' : 'Deny'}
              </button>
            </div>
          )}
        </div>
      </li>
    );
  }
  if (message.role === 'user') {
    const imgs = message.attachments ?? [];
    return (
      <li className={`flex flex-col items-end gap-2 ${isFirst ? '' : 'mt-8'}`}>
        {imgs.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end max-w-[75%]">
            {imgs.map((a) => (
              <img
                key={a.id}
                src={`data:${a.mediaType};base64,${a.base64}`}
                alt={a.name ?? 'attached image'}
                className="h-24 w-24 rounded-lg border border-border object-cover"
              />
            ))}
          </div>
        )}
        {message.body && (
          <div className="rounded-3xl bg-bg-elevated text-text-primary text-sm px-4 py-2.5 max-w-[75%] whitespace-pre-wrap break-words">
            {message.body}
          </div>
        )}
      </li>
    );
  }
  if (message.role === 'error') {
    return (
      <li className={`flex gap-2 ${isFirst ? '' : 'mt-6'}`}>
        <WarningIcon size={14} className="text-error mt-1 shrink-0" weight="fill" />
        <div className="text-sm text-error whitespace-pre-wrap break-words">
          {message.body}
        </div>
      </li>
    );
  }
  // Assistant: no bubble, no avatar — plain flowing prose with optional tool chips above.
  return (
    <li className={`${isFirst ? '' : 'mt-6'}`}>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ul className="flex flex-col gap-1 mb-2">
          {message.toolCalls.map((call) => (
            <ToolChip
              key={call.id}
              call={call}
              agent={agent}
              workspacePath={workspacePath}
              repos={repos}
            />
          ))}
        </ul>
      )}
      {message.body
        ? <MessageMarkdown body={message.body} />
        : message.streaming && (!message.toolCalls || message.toolCalls.length === 0)
          ? <ThinkingIndicator />
          : null}
      {message.streaming && message.body && (
        <span className="inline-block ml-0.5 w-1.5 h-4 bg-accent align-middle animate-pulse" />
      )}
    </li>
  );
}

// ---- Tool chip + detail renderers ----

function ToolChip({
  call,
  agent,
  workspacePath,
  repos,
}: {
  call: AgentToolCall;
  agent: Agent | undefined;
  workspacePath: string | null;
  repos: Array<{ id: string; name: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = call.action === 'Edit' || call.action === 'MultiEdit' || !!call.detail;
  const absolutePath = resolveAgentFilePath(openableFilePath(call.input) ?? '', agent, workspacePath, repos);
  return (
    <li className="flex flex-col self-start max-w-full">
      <div
        role="button"
        tabIndex={canExpand ? 0 : -1}
        className="inline-flex items-center gap-1.5 self-start max-w-full px-2 py-1 rounded-full bg-bg-elevated text-[11px] text-text-secondary hover:bg-bg-surface transition-colors cursor-pointer"
        onClick={() => canExpand && setExpanded(v => !v)}
        onKeyDown={(e) => {
          if (canExpand && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setExpanded(v => !v);
          }
        }}
        title={canExpand ? (expanded ? 'Collapse' : 'Show details') : call.name}
      >
        <WrenchIcon size={11} className="text-text-tertiary shrink-0" />
        <span className="font-semibold text-text-primary">{call.action}</span>
        {call.path && (
          <FilePathLink
            display={call.path}
            absolutePath={absolutePath}
            className="font-mono truncate"
          />
        )}
        {call.detail && !call.path && <span className="font-mono truncate">{call.detail}</span>}
      </div>
      {expanded && (
        <div className="mt-1 ml-2">
          <ToolDetail action={call.action} input={call.input} />
        </div>
      )}
    </li>
  );
}

function ToolDetail({ action, input }: { action: string; input?: Record<string, unknown> }) {
  if (!input) return null;
  if (action === 'Edit' || action === 'MultiEdit') {
    return <EditDiff input={input} />;
  }
  if (action === 'Bash') {
    const cmd = typeof input.command === 'string' ? input.command : '';
    if (!cmd) return null;
    return (
      <pre className="text-[11px] bg-bg-base rounded border border-border p-2 overflow-x-auto font-mono whitespace-pre-wrap">{cmd}</pre>
    );
  }
  if (action === 'Write') {
    const content = typeof input.content === 'string' ? input.content : '';
    if (!content) return null;
    return (
      <pre className="text-[11px] bg-bg-base rounded border border-border p-2 overflow-x-auto font-mono whitespace-pre-wrap max-h-64">{content}</pre>
    );
  }
  return null;
}

interface EditPatch { old: string; new: string; }

function EditDiff({ input }: { input: Record<string, unknown> }) {
  const patches: EditPatch[] = [];
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) {
      if (e && typeof e === 'object') {
        const obj = e as Record<string, unknown>;
        patches.push({
          old: typeof obj.old_string === 'string' ? obj.old_string : '',
          new: typeof obj.new_string === 'string' ? obj.new_string : '',
        });
      }
    }
  } else {
    patches.push({
      old: typeof input.old_string === 'string' ? input.old_string : '',
      new: typeof input.new_string === 'string' ? input.new_string : '',
    });
  }
  if (patches.length === 0 || patches.every(p => !p.old && !p.new)) return null;
  return (
    <div className="flex flex-col gap-2">
      {patches.map((p, i) => (
        <div key={i} className="grid grid-cols-2 gap-1 rounded border border-border overflow-hidden">
          <div className="bg-error/10 text-[11px] font-mono p-2 whitespace-pre-wrap break-words max-h-64 overflow-auto">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-error mb-1">− Before</div>
            <div className="text-text-primary">{p.old || <span className="text-text-tertiary italic">(empty)</span>}</div>
          </div>
          <div className="bg-success/10 text-[11px] font-mono p-2 whitespace-pre-wrap break-words max-h-64 overflow-auto">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-success mb-1">+ After</div>
            <div className="text-text-primary">{p.new || <span className="text-text-tertiary italic">(empty)</span>}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface AskQuestion {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

function AskQuestionBody({ input }: { input?: AgentPermissionRequest['input'] }) {
  if (!input || !Array.isArray(input.questions)) return null;
  const qs = input.questions as AskQuestion[];
  return (
    <div className="flex flex-col gap-3">
      {qs.map((q, i) => (
        <div key={i} className="bg-bg-surface rounded-lg border border-border p-3">
          {q.header && (
            <div className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">{q.header}</div>
          )}
          <div className="text-sm text-text-primary mb-2">{q.question}</div>
          {q.options && q.options.length > 0 && (
            <ul className="flex flex-col gap-1">
              {q.options.map((opt, j) => (
                <li key={j} className="flex items-baseline gap-2 text-xs">
                  <span className="font-semibold text-accent shrink-0">{opt.label}</span>
                  {opt.description && <span className="text-text-secondary">{opt.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
