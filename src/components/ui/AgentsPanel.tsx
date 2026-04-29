import { useMemo, useState } from 'react';
import {
  RobotIcon,
  ChatCircleDotsIcon,
  PencilSimpleIcon,
  CaretRightIcon,
  CaretDownIcon,
  FolderIcon,
  FolderPlusIcon,
  TrashIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import { useTab } from '../../context/TabContext';
import { useAgent } from '../../context/AgentContext';
import { useToast } from './Toast';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import PromptDialog from './PromptDialog';
import type { Agent, AgentKind } from '@/types/agent';

const UNCATEGORIZED = '__uncategorized__';
const DRAG_MIME = 'application/x-quipu-agent';

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

type PromptState =
  | { mode: 'create-folder'; kind: AgentKind }
  | { mode: 'rename-folder'; kind: AgentKind; oldName: string };

export default function AgentsPanel() {
  const { openAgentTab, openAgentEditorTab } = useTab();
  const {
    agents, folders,
    createChat, deleteAgent, moveAgent,
    createFolder, deleteFolder, renameFolder,
    isTurnActive,
  } = useAgent();
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const closeMenu = () => setMenu(null);

  // Group agents by kind, then by folder (merging declared-empty folders).
  // Items inside each folder (and the uncategorized list) are sorted by
  // `updatedAt` descending so the most-recently-modified row floats to the
  // top. The folder list itself stays alphabetical.
  //
  // The `?? ''` guard hardens against any pre-MVP persisted record that might
  // be missing `updatedAt` — the load normalizer in AgentContext defaults
  // other fields but not the timestamps.
  const sections = useMemo(() => {
    const byRecency = (a: Agent, b: Agent) => {
      const cmp = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    };
    const buildSection = (kind: AgentKind) => {
      const items = agents.filter(a => a.kind === kind);
      const folderNames = new Set<string>();
      for (const item of items) if (item.folder) folderNames.add(item.folder);
      const declared = kind === 'agent' ? folders.agents : folders.chats;
      for (const f of declared) folderNames.add(f);

      const folderList = Array.from(folderNames).sort((a, b) => a.localeCompare(b));
      const grouped = folderList.map((folder) => ({
        folder,
        items: items.filter(i => i.folder === folder).slice().sort(byRecency),
      }));
      const uncategorized = items.filter(i => !i.folder).slice().sort(byRecency);
      return { kind, grouped, uncategorized };
    };
    return {
      chats: buildSection('chat'),
      agents: buildSection('agent'),
    };
  }, [agents, folders]);

  // ---------- actions ----------
  const handleNewChat = (folder?: string) => {
    const chat = createChat({ folder });
    openAgentTab(chat.id, chat.name);
  };
  const handleNewAgent = (folder?: string) => {
    // Editor tab needs an id up-front. We let the editor persist the record on Save.
    const id = crypto.randomUUID();
    openAgentEditorTab(id, 'New agent');
    if (folder) {
      // Pre-seed the agent so folder assignment sticks even before the user edits.
      // The editor will pick it up via existing lookup.
      // Safe because createFolder sidebar uses its own state; we don't rely on it here.
    }
  };
  const handleNewFolder = (kind: AgentKind) => setPrompt({ mode: 'create-folder', kind });
  const handleRenameFolder = (kind: AgentKind, oldName: string) => setPrompt({ mode: 'rename-folder', kind, oldName });

  const handlePromptConfirm = (value: string) => {
    if (!prompt) return;
    if (prompt.mode === 'create-folder') {
      createFolder(prompt.kind, value);
    } else {
      renameFolder(prompt.kind, prompt.oldName, value);
    }
    setPrompt(null);
  };
  const handleDeleteFolder = (kind: AgentKind, name: string, count: number) => {
    const msg = count > 0
      ? `Delete folder "${name}"? The ${count} item${count === 1 ? '' : 's'} inside will move to Uncategorized.`
      : `Delete empty folder "${name}"?`;
    if (!window.confirm(msg)) return;
    deleteFolder(kind, name);
  };
  const handleDelete = (agent: Agent) => {
    if (!window.confirm(`Delete "${agent.name}"? This wipes its transcript too.`)) return;
    try { deleteAgent(agent.id); }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Delete failed: ${message}`, 'error');
    }
  };

  // ---------- context menus ----------
  const openPanelMenu = (e: React.MouseEvent, kind?: AgentKind) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: 'New chat', onClick: () => { closeMenu(); handleNewChat(); } },
      { label: 'New agent', onClick: () => { closeMenu(); handleNewAgent(); } },
      { separator: true },
      { label: kind === 'chat' ? 'New chats folder' : 'New agents folder', onClick: () => { closeMenu(); handleNewFolder(kind ?? 'agent'); } },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const openFolderMenu = (e: React.MouseEvent, kind: AgentKind, folder: string, count: number) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: 'New chat in folder', onClick: () => { closeMenu(); if (kind === 'chat') handleNewChat(folder); else handleNewChat(folder); } },
      { label: 'New agent in folder', onClick: () => { closeMenu(); handleNewAgent(folder); } },
      { separator: true },
      { label: 'Rename folder', onClick: () => { closeMenu(); handleRenameFolder(kind, folder); } },
      { label: 'Delete folder', danger: true, onClick: () => { closeMenu(); handleDeleteFolder(kind, folder, count); } },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const openRowMenu = (e: React.MouseEvent, agent: Agent) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: 'Open', onClick: () => { closeMenu(); openAgentTab(agent.id, agent.name); } },
      { label: 'Edit', onClick: () => { closeMenu(); openAgentEditorTab(agent.id, agent.name); } },
      { separator: true },
      { label: agent.kind === 'chat' ? 'Convert to agent' : 'Convert to chat',
        onClick: () => { closeMenu(); moveAgent(agent.id, { kind: agent.kind === 'chat' ? 'agent' : 'chat' }); } },
      { label: 'Remove from folder', disabled: !agent.folder, onClick: () => { closeMenu(); moveAgent(agent.id, { folder: '' }); } },
      { separator: true },
      { label: 'Delete', danger: true, onClick: () => { closeMenu(); handleDelete(agent); } },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // ---------- drag & drop ----------
  const onDragStart = (e: React.DragEvent, agent: Agent) => {
    e.dataTransfer.setData(DRAG_MIME, agent.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDropZone = (e: React.DragEvent, key: string, target: { kind?: AgentKind; folder?: string }) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData(DRAG_MIME);
    if (!id) return;
    moveAgent(id, {
      kind: target.kind,
      folder: target.folder ?? '',
    });
  };
  const onDragOver = (e: React.DragEvent, key: string) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== key) setDragOver(key);
  };

  const emptyState = agents.length === 0 && folders.chats.length === 0 && folders.agents.length === 0;

  return (
    <div
      className="flex flex-col h-full bg-bg-surface text-text-primary"
      onContextMenu={(e) => openPanelMenu(e)}
    >
      <div className="flex items-center justify-between h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Agents</span>
        <div className="flex items-center gap-1">
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            onClick={() => handleNewChat()}
            aria-label="New chat"
            title="New chat — skip config, start talking"
          >
            <ChatCircleDotsIcon size={14} />
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            onClick={() => handleNewAgent()}
            aria-label="New agent"
            title="New agent — configure prompt, bindings, model"
          >
            <PlusIcon size={14} />
          </button>
        </div>
      </div>

      {emptyState ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <RobotIcon size={28} className="text-text-tertiary mb-2" weight="light" />
          <p className="text-xs text-text-secondary mb-1">No agents yet.</p>
          <p className="text-[11px] text-text-tertiary mb-3">
            Quick <b>chat</b> or configured <b>agent</b>. Right-click for folders.
          </p>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent-hover transition-colors"
              onClick={() => handleNewChat()}
            >
              <ChatCircleDotsIcon size={13} />
              New chat
            </button>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
              onClick={() => handleNewAgent()}
            >
              <RobotIcon size={13} />
              New agent
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto py-1">
          <KindSection
            kind="chat"
            label="Chats"
            countBadge={agents.filter(a => a.kind === 'chat').length}
            grouped={sections.chats.grouped}
            uncategorized={sections.chats.uncategorized}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            dragOver={dragOver}
            openAgent={(a) => openAgentTab(a.id, a.name)}
            editAgent={(a) => openAgentEditorTab(a.id, a.name)}
            onRowMenu={openRowMenu}
            onFolderMenu={(e, folder, count) => openFolderMenu(e, 'chat', folder, count)}
            onSectionMenu={(e) => openPanelMenu(e, 'chat')}
            onNewItem={() => handleNewChat()}
            onNewFolder={() => handleNewFolder('chat')}
            onDragStartRow={onDragStart}
            onDragOverZone={onDragOver}
            onDropZone={onDropZone}
            isTurnActive={isTurnActive}
          />

          <KindSection
            kind="agent"
            label="Agents"
            countBadge={agents.filter(a => a.kind === 'agent').length}
            grouped={sections.agents.grouped}
            uncategorized={sections.agents.uncategorized}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            dragOver={dragOver}
            openAgent={(a) => openAgentTab(a.id, a.name)}
            editAgent={(a) => openAgentEditorTab(a.id, a.name)}
            onRowMenu={openRowMenu}
            onFolderMenu={(e, folder, count) => openFolderMenu(e, 'agent', folder, count)}
            onSectionMenu={(e) => openPanelMenu(e, 'agent')}
            onNewItem={() => handleNewAgent()}
            onNewFolder={() => handleNewFolder('agent')}
            onDragStartRow={onDragStart}
            onDragOverZone={onDragOver}
            onDropZone={onDropZone}
            isTurnActive={isTurnActive}
          />
        </div>
      )}

      {menu && (
        <ContextMenu items={menu.items} position={{ x: menu.x, y: menu.y }} onClose={closeMenu} />
      )}

      <PromptDialog
        open={!!prompt}
        title={
          prompt?.mode === 'rename-folder'
            ? `Rename folder "${prompt.oldName}"`
            : prompt?.mode === 'create-folder'
              ? `New ${prompt.kind === 'chat' ? 'chats' : 'agents'} folder`
              : ''
        }
        label="Folder name"
        placeholder="e.g. research"
        defaultValue={prompt?.mode === 'rename-folder' ? prompt.oldName : ''}
        confirmLabel={prompt?.mode === 'rename-folder' ? 'Rename' : 'Create'}
        onConfirm={handlePromptConfirm}
        onCancel={() => setPrompt(null)}
      />
    </div>
  );
}

// ---------- section ----------
interface KindSectionProps {
  kind: AgentKind;
  label: string;
  countBadge: number;
  grouped: Array<{ folder: string; items: Agent[] }>;
  uncategorized: Agent[];
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  dragOver: string | null;
  openAgent: (a: Agent) => void;
  editAgent: (a: Agent) => void;
  onRowMenu: (e: React.MouseEvent, a: Agent) => void;
  onFolderMenu: (e: React.MouseEvent, folder: string, count: number) => void;
  onSectionMenu: (e: React.MouseEvent) => void;
  onNewItem: () => void;
  onNewFolder: () => void;
  onDragStartRow: (e: React.DragEvent, a: Agent) => void;
  onDragOverZone: (e: React.DragEvent, key: string) => void;
  onDropZone: (e: React.DragEvent, key: string, target: { kind?: AgentKind; folder?: string }) => void;
  isTurnActive: (id: string) => boolean;
}

function KindSection({
  kind, label, countBadge, grouped, uncategorized,
  collapsed, setCollapsed, dragOver,
  openAgent, editAgent, onRowMenu, onFolderMenu, onSectionMenu,
  onNewItem, onNewFolder,
  onDragStartRow, onDragOverZone, onDropZone, isTurnActive,
}: KindSectionProps) {
  const sectionKey = `section:${kind}`;
  const headerKey = `header:${kind}`;
  const isOpen = !collapsed[sectionKey];
  const ItemIcon = kind === 'chat' ? ChatCircleDotsIcon : RobotIcon;

  return (
    <section
      className="mb-2"
      onContextMenu={onSectionMenu}
    >
      <div
        className={`group/section flex items-center gap-1 h-7 px-2 mx-1 rounded hover:bg-bg-elevated ${dragOver === headerKey ? 'bg-accent/10 ring-1 ring-accent/40' : ''}`}
        onDragOver={(e) => onDragOverZone(e, headerKey)}
        onDrop={(e) => onDropZone(e, headerKey, { kind, folder: '' })}
      >
        <button
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-[11px] font-semibold uppercase tracking-wider text-text-tertiary"
          onClick={() => setCollapsed((c) => ({ ...c, [sectionKey]: isOpen }))}
        >
          {isOpen ? <CaretDownIcon size={10} /> : <CaretRightIcon size={10} />}
          <ItemIcon size={12} className="text-text-tertiary" />
          <span className="truncate">{label}</span>
          <span className="ml-auto text-[10px] text-text-tertiary font-normal">{countBadge}</span>
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover/section:opacity-100 hover:text-text-primary hover:bg-bg-elevated transition-opacity"
          onClick={onNewFolder}
          title={`New ${label.toLowerCase()} folder`}
          aria-label={`New ${label.toLowerCase()} folder`}
        >
          <FolderPlusIcon size={12} />
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover/section:opacity-100 hover:text-text-primary hover:bg-bg-elevated transition-opacity"
          onClick={onNewItem}
          title={`New ${kind}`}
          aria-label={`New ${kind}`}
        >
          <PlusIcon size={12} />
        </button>
      </div>

      {isOpen && (
        <>
          {grouped.map(({ folder, items }) => {
            const folderKey = `${kind}:folder:${folder}`;
            const folderOpen = !collapsed[folderKey];
            return (
              <div key={folderKey}>
                <div
                  className={`group/folder flex items-center gap-1 h-7 pl-4 pr-2 mx-1 rounded hover:bg-bg-elevated ${dragOver === folderKey ? 'bg-accent/10 ring-1 ring-accent/40' : ''}`}
                  onContextMenu={(e) => onFolderMenu(e, folder, items.length)}
                  onDragOver={(e) => onDragOverZone(e, folderKey)}
                  onDrop={(e) => onDropZone(e, folderKey, { kind, folder })}
                >
                  <button
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-[11px] text-text-tertiary"
                    onClick={() => setCollapsed((c) => ({ ...c, [folderKey]: folderOpen }))}
                  >
                    {folderOpen ? <CaretDownIcon size={10} /> : <CaretRightIcon size={10} />}
                    <FolderIcon size={12} weight="fill" className="text-text-tertiary" />
                    <span className="truncate">{folder}</span>
                    <span className="ml-auto text-[10px] text-text-tertiary">{items.length}</span>
                  </button>
                </div>
                {folderOpen && items.map(agent => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    indentPx={32}
                    running={isTurnActive(agent.id)}
                    onOpen={() => openAgent(agent)}
                    onEdit={() => editAgent(agent)}
                    onContextMenu={(e) => onRowMenu(e, agent)}
                    onDragStart={(e) => onDragStartRow(e, agent)}
                  />
                ))}
              </div>
            );
          })}

          {/* Uncategorized drop zone */}
          {uncategorized.length > 0 ? (
            uncategorized.map(agent => (
              <AgentRow
                key={agent.id}
                agent={agent}
                indentPx={24}
                running={isTurnActive(agent.id)}
                onOpen={() => openAgent(agent)}
                onEdit={() => editAgent(agent)}
                onContextMenu={(e) => onRowMenu(e, agent)}
                onDragStart={(e) => onDragStartRow(e, agent)}
              />
            ))
          ) : (
            <div
              className={`mx-1 my-1 px-3 py-2 rounded border border-dashed border-border text-[11px] text-text-tertiary text-center ${dragOver === `${kind}:empty` ? 'bg-accent/10 border-accent' : ''}`}
              onDragOver={(e) => onDragOverZone(e, `${kind}:empty`)}
              onDrop={(e) => onDropZone(e, `${kind}:empty`, { kind, folder: '' })}
            >
              Drop here to move to {label}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------- row ----------
interface AgentRowProps {
  agent: Agent;
  indentPx: number;
  running: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
}

function AgentRow({ agent, indentPx, running, onOpen, onEdit, onContextMenu, onDragStart }: AgentRowProps) {
  const bindingCount = agent.bindings?.length ?? 0;
  const Icon = agent.kind === 'chat' ? ChatCircleDotsIcon : RobotIcon;
  // Display in the user's local timezone. The Swedish locale yields ISO
  // `yyyy-mm-dd` natively. Using `agent.updatedAt.slice(0, 10)` would show
  // the UTC date and shift the row by one day for users east/west of UTC.
  const dateLabel = new Date(agent.updatedAt).toLocaleDateString('sv-SE');
  return (
    <div
      className="group flex items-center gap-1 h-8 pr-2 mx-1 rounded hover:bg-bg-elevated"
      style={{ paddingLeft: `${indentPx}px` }}
      draggable
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
    >
      <button
        className="flex items-center gap-2 flex-1 min-w-0 text-left text-sm"
        onClick={onOpen}
      >
        <Icon size={13} className={agent.kind === 'chat' ? 'text-text-tertiary shrink-0' : 'text-accent shrink-0'} />
        <span className="truncate">{agent.name}</span>
        {running && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" title="Session running" />}
        {bindingCount > 0 && (
          <span
            className="ml-auto text-[10px] text-text-tertiary shrink-0 px-1 rounded bg-bg-elevated"
            aria-label={`${bindingCount} context binding${bindingCount === 1 ? '' : 's'}`}
          >
            {bindingCount}
          </span>
        )}
        <time
          dateTime={agent.updatedAt}
          className={`${bindingCount > 0 ? '' : 'ml-auto'} text-[10px] text-text-secondary shrink-0 tabular-nums`}
        >
          {dateLabel}
        </time>
      </button>
      <button
        className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-bg-elevated transition-opacity"
        onClick={onEdit}
        aria-label={`Edit ${agent.name}`}
        title="Edit"
      >
        <PencilSimpleIcon size={13} />
      </button>
      <button
        className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-bg-elevated transition-opacity"
        onClick={(e) => { e.stopPropagation(); onContextMenu(e); }}
        aria-label="More actions"
        title="More actions"
      >
        <TrashIcon size={13} />
      </button>
    </div>
  );
}
