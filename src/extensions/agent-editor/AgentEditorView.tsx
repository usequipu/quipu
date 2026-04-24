import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftIcon, TrashIcon, GearIcon, PlusIcon, XIcon } from '@phosphor-icons/react';
import type { Tab } from '@/types/tab';
import type { Agent, AgentBinding, AgentPermissionMode } from '@/types/agent';
import { useTab } from '../../context/TabContext';
import { useAgent } from '../../context/AgentContext';
import { useRepo } from '../../context/RepoContext';
import { Section, Field } from './EditorLayout';
import WorkspaceTreePicker from './WorkspaceTreePicker';

import { AGENT_MODELS, DEFAULT_AGENT_MODEL } from '../../services/agentModels';

const DEFAULT_MODEL = DEFAULT_AGENT_MODEL;
const DEFAULT_PERMISSION_MODE: AgentPermissionMode = 'default';

const MODELS = AGENT_MODELS.map((m) => ({
  id: m.id,
  label: m.id === DEFAULT_AGENT_MODEL ? `${m.label} (default)` : m.label,
}));

const PERMISSION_MODES: Array<{ id: AgentPermissionMode; label: string; hint: string }> = [
  { id: 'default', label: 'Ask (interactive prompts)', hint: 'Each tool call opens an Allow/Deny card in the chat before the tool runs. Recommended.' },
  { id: 'acceptEdits', label: 'Accept edits only', hint: 'File edits run without asking; other tools still prompt.' },
  { id: 'auto', label: 'Auto-approve', hint: 'All tools run without asking. Use the Allowed tools field below if you want to restrict what the agent can call.' },
  { id: 'bypassPermissions', label: 'Bypass', hint: 'Same as auto — explicit name. Do not use with untrusted prompts.' },
  { id: 'plan', label: 'Plan mode', hint: 'Agent plans without writing files or running commands.' },
];

interface AgentEditorViewProps {
  tab: Tab;
}

export default function AgentEditorView({ tab }: AgentEditorViewProps) {
  const { closeTab } = useTab();
  const { getAgent, upsertAgent, deleteAgent, ensureAgentClones } = useAgent();
  const { repos } = useRepo();

  const agentId = useMemo(() => tab.path.replace(/^agent-editor:\/\//, ''), [tab.path]);
  const existing = getAgent(agentId);

  const [name, setName] = useState(existing?.name ?? '');
  const [folder, setFolder] = useState(existing?.folder ?? '');
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? '');
  const [model, setModel] = useState(existing?.model ?? DEFAULT_MODEL);
  const [bindings, setBindings] = useState<AgentBinding[]>(existing?.bindings ?? []);
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>(existing?.permissionMode ?? DEFAULT_PERMISSION_MODE);
  const [allowedToolsText, setAllowedToolsText] = useState<string>((existing?.allowedTools ?? []).join(', '));

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setFolder(existing.folder ?? '');
      setSystemPrompt(existing.systemPrompt);
      setModel(existing.model);
      setBindings(existing.bindings ?? []);
      setPermissionMode(existing.permissionMode ?? DEFAULT_PERMISSION_MODE);
      setAllowedToolsText((existing.allowedTools ?? []).join(', '));
    }
  }, [existing]);

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0;
  const isNew = !existing;

  const handleBack = () => closeTab(tab.id);

  const handleSave = () => {
    if (!canSave) return;
    const now = new Date().toISOString();
    const cleanedBindings: AgentBinding[] = bindings
      .filter((b) => b.subpath.trim().length > 0)
      .map((b) => ({
        ...b,
        subpath: b.subpath.trim(),
        documentation: b.documentation.trim(),
        repoId: b.source === 'repo' ? b.repoId : undefined,
      }));
    const allowedTools = allowedToolsText
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const agent: Agent = {
      id: agentId,
      name: trimmedName,
      kind: existing?.kind ?? 'agent',
      systemPrompt,
      model,
      bindings: cleanedBindings,
      permissionMode,
      folder: folder.trim() || undefined,
      allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    upsertAgent(agent);
    // Fire clones for the agent's repo bindings in the background so the
    // first chat turn doesn't have to wait on `git clone`.
    void ensureAgentClones(agent.id);
    closeTab(tab.id);
  };

  const handleDelete = () => {
    if (!existing) {
      closeTab(tab.id);
      return;
    }
    if (!window.confirm(`Delete "${existing.name}"?`)) return;
    deleteAgent(existing.id);
    closeTab(tab.id);
  };

  const addBinding = () => {
    const defaultRepoId = repos[0]?.id;
    const newBinding: AgentBinding = {
      id: crypto.randomUUID(),
      source: 'workspace',
      repoId: defaultRepoId,
      subpath: '',
      documentation: '',
    };
    setBindings((prev) => [...prev, newBinding]);
  };

  const updateBinding = (id: string, patch: Partial<AgentBinding>) => {
    setBindings((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeBinding = (id: string) => {
    setBindings((prev) => prev.filter((b) => b.id !== id));
  };

  return (
    <div className="flex flex-col h-full bg-bg-base text-text-primary overflow-auto">
      <div className="flex items-center justify-between h-12 px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <button
            className="w-7 h-7 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            onClick={handleBack}
            aria-label="Back"
            title="Back"
          >
            <ArrowLeftIcon size={16} />
          </button>
          <div className="w-7 h-7 rounded bg-accent-muted flex items-center justify-center">
            <GearIcon size={16} className="text-accent" weight="regular" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{trimmedName || 'New agent'}</span>
            <span className="text-[11px] text-text-tertiary font-mono">agent-editor://{agentId}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isNew && (
            <button
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded text-text-tertiary hover:text-error hover:bg-bg-elevated transition-colors"
              onClick={handleDelete}
            >
              <TrashIcon size={13} />
              Delete
            </button>
          )}
          <button
            className="px-3 py-1.5 text-xs rounded border border-border text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={handleBack}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={!canSave}
          >
            {isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex-1 px-8 py-6 max-w-3xl w-full mx-auto">
        <Section number="01" title="Identity" hint="How this agent shows up in the Agents panel.">
          <Field label="Name" hint="Shown on the agent row and in the tab title.">
            <input
              className="w-full h-9 px-3 rounded border border-border bg-bg-surface text-sm focus:outline-none focus:border-accent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FRAME Responder"
              autoFocus
            />
          </Field>
          <Field label="Folder" hint="Optional — group related agents and chats under a folder.">
            <input
              className="w-full h-9 px-3 rounded border border-border bg-bg-surface text-sm focus:outline-none focus:border-accent"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="e.g. review"
            />
          </Field>
        </Section>

        <Section
          number="02"
          title="System prompt"
          hint="Passed to claude --append-system-prompt when the agent starts a session."
        >
          <textarea
            className="w-full min-h-[140px] px-3 py-2 rounded border border-border bg-bg-surface text-sm font-mono focus:outline-none focus:border-accent resize-y"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a ..."
          />
          <p className="mt-2 text-[11px] text-text-tertiary">
            The FRAME skill is already installed at <code className="text-accent">.claude/skills/frame/</code> — you don't need to re-describe FRAME conventions here.
          </p>
        </Section>

        <Section
          number="03"
          title="Context bindings"
          hint="Paths materialized into the agent's session. Each binding's documentation is appended to the system prompt."
        >
          {bindings.length === 0 ? (
            <p className="text-xs text-text-tertiary mb-3">
              No bindings yet. The agent runs against the workspace by default.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 mb-3">
              {bindings.map((binding) => (
                <li key={binding.id} className="rounded border border-border bg-bg-surface p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <select
                      className="h-8 px-2 rounded border border-border bg-bg-base text-xs focus:outline-none focus:border-accent shrink-0"
                      value={binding.source === 'repo' && binding.repoId ? `repo:${binding.repoId}` : 'workspace'}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'workspace') {
                          updateBinding(binding.id, { source: 'workspace', repoId: undefined, subpath: '' });
                        } else {
                          updateBinding(binding.id, { source: 'repo', repoId: v.replace(/^repo:/, ''), subpath: '' });
                        }
                      }}
                    >
                      <option value="workspace">Workspace</option>
                      {repos.length > 0 && (
                        <optgroup label="Repos">
                          {repos.map((r) => (
                            <option key={r.id} value={`repo:${r.id}`}>{r.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <span className="text-text-tertiary text-sm shrink-0">/</span>
                    {binding.source === 'workspace' ? (
                      <WorkspaceTreePicker
                        value={binding.subpath}
                        onChange={(subpath) => updateBinding(binding.id, { subpath })}
                      />
                    ) : (
                      <input
                        className="flex-1 h-8 px-2 rounded border border-border bg-bg-base text-xs font-mono focus:outline-none focus:border-accent"
                        value={binding.subpath}
                        onChange={(e) => updateBinding(binding.id, { subpath: e.target.value })}
                        placeholder="docs/plans"
                      />
                    )}
                    <button
                      className="w-7 h-7 flex items-center justify-center rounded text-text-tertiary hover:text-error hover:bg-bg-elevated transition-colors shrink-0"
                      onClick={() => removeBinding(binding.id)}
                      aria-label="Remove binding"
                      title="Remove binding"
                    >
                      <XIcon size={13} />
                    </button>
                  </div>
                  <label className="block">
                    <span className="block text-[11px] font-medium text-text-secondary mb-1.5">
                      Documentation <span className="text-text-tertiary font-normal">— why this context matters to the agent</span>
                    </span>
                    <textarea
                      className="w-full min-h-[64px] px-2 py-2 rounded border border-border bg-bg-base text-xs focus:outline-none focus:border-accent resize-y"
                      value={binding.documentation}
                      onChange={(e) => updateBinding(binding.id, { documentation: e.target.value })}
                      placeholder="Implementation plans and architecture notes — consult these when the user asks about Quipu internals."
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-dashed border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            onClick={addBinding}
          >
            <PlusIcon size={12} />
            Add binding
          </button>
        </Section>

        <Section
          number="04"
          title="Runtime"
          hint="Claude Code CLI spawn options."
        >
          <Field label="Model">
            <select
              className="w-full h-9 px-3 rounded border border-border bg-bg-surface text-sm focus:outline-none focus:border-accent"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Permission mode"
            hint="How the agent handles tool approvals (maps to claude --permission-mode)."
          >
            <select
              className="w-full h-9 px-3 rounded border border-border bg-bg-surface text-sm focus:outline-none focus:border-accent"
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value as AgentPermissionMode)}
            >
              {PERMISSION_MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-text-tertiary">
              {PERMISSION_MODES.find((m) => m.id === permissionMode)?.hint}
            </p>
          </Field>
          <Field
            label="Allowed tools"
            hint="Optional — restrict the agent to this list. Passes to claude --allowedTools."
          >
            <input
              className="w-full h-9 px-3 rounded border border-border bg-bg-surface text-sm font-mono focus:outline-none focus:border-accent"
              value={allowedToolsText}
              onChange={(e) => setAllowedToolsText(e.target.value)}
              placeholder="Read, Edit, Bash(git *)"
            />
            <p className="mt-1.5 text-[11px] text-text-tertiary">
              Comma-separated tool specifiers. Leave empty for no restriction. Examples: <code className="text-accent">Read</code>, <code className="text-accent">Bash(git *)</code>, <code className="text-accent">Edit</code>, <code className="text-accent">Write</code>.
            </p>
          </Field>
        </Section>

        <p className="text-xs text-text-tertiary mt-8">
          Materialization of bindings into <code className="text-accent">.quipu/contexts/</code>, cloning, and the Claude CLI subprocess land in later units.
        </p>
      </div>
    </div>
  );
}
