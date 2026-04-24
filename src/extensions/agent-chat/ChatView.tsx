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
import type { AgentMessage } from '@/types/agent';
import { useTab } from '../../context/TabContext';
import { useAgent } from '../../context/AgentContext';
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
    if (!trimmed || !agent || active) return;
    setInput('');
    try {
      await sendMessage(agent.id, trimmed);
    } catch {
      /* surfaced as an error message in the transcript */
    }
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
          <textarea
            ref={textareaRef}
            className="w-full px-4 pt-3 pb-1 bg-transparent text-sm resize-none focus:outline-none placeholder:text-text-tertiary"
            style={{ minHeight: '44px', maxHeight: '200px' }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
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
                  disabled={!input.trim() || !agent}
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
}

function MessageItem({ message, isFirst, onRespondPermission }: MessageItemProps) {
  if (message.role === 'permission-request' && message.permissionRequest) {
    const req = message.permissionRequest;
    const pending = req.status === 'pending';
    return (
      <li className={`${isFirst ? '' : 'mt-6'}`}>
        <div className="rounded-xl border border-warning/50 bg-warning/10 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <ShieldIcon size={14} className="text-warning shrink-0" weight="fill" />
            <span className="text-xs font-semibold text-warning uppercase tracking-wider">Permission requested</span>
            {!pending && (
              <span className={`text-[11px] px-2 py-0.5 rounded ${req.status === 'allowed' ? 'bg-success/20 text-success' : 'bg-error/20 text-error'}`}>
                {req.status}
              </span>
            )}
          </div>
          <div className="text-sm font-mono text-text-primary break-words mb-2">{req.summary}</div>
          {req.inputJson && req.inputJson !== '{}' && (
            <details className="mb-3">
              <summary className="text-[11px] text-text-tertiary cursor-pointer hover:text-text-secondary">Show raw input</summary>
              <pre className="mt-1 text-[11px] bg-bg-base rounded border border-border p-2 overflow-x-auto font-mono">{req.inputJson}</pre>
            </details>
          )}
          {pending && (
            <div className="flex items-center gap-2">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-success text-white hover:opacity-90 transition-opacity"
                onClick={() => onRespondPermission('allow')}
              >
                <CheckIcon size={12} weight="bold" />
                Allow once
              </button>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-text-secondary hover:text-error hover:border-error transition-colors"
                onClick={() => onRespondPermission('deny')}
              >
                <XIcon size={12} weight="bold" />
                Deny
              </button>
            </div>
          )}
        </div>
      </li>
    );
  }
  if (message.role === 'user') {
    return (
      <li className={`flex justify-end ${isFirst ? '' : 'mt-8'}`}>
        <div className="rounded-3xl bg-bg-elevated text-text-primary text-sm px-4 py-2.5 max-w-[75%] whitespace-pre-wrap break-words">
          {message.body}
        </div>
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
            <li
              key={call.id}
              className="inline-flex items-center gap-1.5 self-start max-w-full px-2 py-1 rounded-full bg-bg-elevated text-[11px] text-text-secondary"
              title={call.name}
            >
              <WrenchIcon size={11} className="text-text-tertiary shrink-0" />
              <span className="truncate font-mono">{call.summary}</span>
            </li>
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
