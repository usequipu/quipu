import { useMemo, useState } from 'react';
import {
  PlusIcon,
  GitForkIcon,
  PencilSimpleIcon,
  CaretRightIcon,
  CaretDownIcon,
  FolderIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useTab } from '../../context/TabContext';
import { useRepo } from '../../context/RepoContext';
import { useToast } from './Toast';
import type { Repo } from '@/types/agent';

const UNCATEGORIZED = '__uncategorized__';

export default function ReposPanel() {
  const { openRepoEditorTab } = useTab();
  const { repos, deleteRepo, deleteFolder } = useRepo();
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const map = new Map<string, Repo[]>();
    for (const r of repos) {
      const key = r.folder?.trim() || UNCATEGORIZED;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    const folders = Array.from(map.keys()).sort((a, b) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
    return folders.map((folder) => ({
      folder,
      repos: (map.get(folder) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [repos]);

  const handleNew = () => {
    openRepoEditorTab(crypto.randomUUID(), 'New repo');
  };

  const handleDeleteRepo = async (repo: Repo) => {
    if (!window.confirm(`Delete "${repo.name}"?`)) return;
    try {
      await deleteRepo(repo.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Delete failed: ${message}`, 'error');
    }
  };

  const handleDeleteFolder = async (folderKey: string, items: Repo[]) => {
    const label = folderKey === UNCATEGORIZED ? 'Uncategorized' : folderKey;
    const names = items.map(r => `• ${r.name}`).join('\n');
    if (!window.confirm(
      `Delete folder "${label}" and the ${items.length} repo${items.length === 1 ? '' : 's'} inside?\n${names}`,
    )) return;
    try {
      await deleteFolder(folderKey === UNCATEGORIZED ? '' : folderKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Delete failed: ${message}`, 'error');
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-surface text-text-primary">
      <div className="flex items-center justify-between h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Repos</span>
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
          onClick={handleNew}
          aria-label="Add repo"
          title="Add repo"
        >
          <PlusIcon size={14} />
        </button>
      </div>

      {repos.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <GitForkIcon size={28} className="text-text-tertiary mb-2" weight="light" />
          <p className="text-xs text-text-secondary mb-1">No repos yet.</p>
          <p className="text-[11px] text-text-tertiary mb-3">
            Add git repositories to bind as agent context. Each agent clones them into its own
            scratch dir at <code className="text-accent">tmp/&lt;agent-id&gt;/repos/</code>.
          </p>
          <button
            className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent-hover transition-colors"
            onClick={handleNew}
          >
            Add repo
          </button>
        </div>
      ) : (
        <ul className="flex-1 overflow-auto py-1">
          {grouped.map(({ folder, repos: items }) => {
            const isOpen = !collapsed[folder];
            const label = folder === UNCATEGORIZED ? 'Uncategorized' : folder;
            return (
              <li key={folder} className="group/folder">
                <div className="flex items-center gap-1 h-7 px-2 mx-1 rounded hover:bg-bg-elevated">
                  <button
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-[11px] font-semibold uppercase tracking-wider text-text-tertiary"
                    onClick={() => setCollapsed((c) => ({ ...c, [folder]: isOpen }))}
                  >
                    {isOpen ? <CaretDownIcon size={10} /> : <CaretRightIcon size={10} />}
                    <FolderIcon size={12} weight="fill" className="text-text-tertiary" />
                    <span className="truncate">{label}</span>
                    <span className="ml-auto text-[10px] text-text-tertiary font-normal">{items.length}</span>
                  </button>
                  <button
                    className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover/folder:opacity-100 hover:text-error hover:bg-bg-elevated transition-opacity"
                    onClick={() => handleDeleteFolder(folder, items)}
                    aria-label={`Delete folder ${label}`}
                    title={`Delete folder and its ${items.length} repo${items.length === 1 ? '' : 's'}`}
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
                {isOpen && (
                  <ul>
                    {items.map((repo) => (
                      <RepoRow
                        key={repo.id}
                        repo={repo}
                        onEdit={() => openRepoEditorTab(repo.id, repo.name)}
                        onDelete={() => handleDeleteRepo(repo)}
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface RepoRowProps {
  repo: Repo;
  onEdit: () => void;
  onDelete: () => void;
}

function RepoRow({ repo, onEdit, onDelete }: RepoRowProps) {
  return (
    <li className="group">
      <div className="flex items-center gap-1 h-8 pl-6 pr-2 mx-1 rounded hover:bg-bg-elevated">
        <button
          className="flex items-center gap-2 flex-1 min-w-0 text-left text-sm"
          onClick={onEdit}
          title={repo.url || repo.name}
        >
          <GitForkIcon size={13} className="text-text-tertiary shrink-0" />
          <span className="truncate">{repo.name}</span>
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-bg-elevated transition-opacity"
          onClick={onEdit}
          aria-label={`Edit ${repo.name}`}
          title="Edit"
        >
          <PencilSimpleIcon size={13} />
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-error hover:bg-bg-elevated transition-opacity"
          onClick={onDelete}
          aria-label={`Delete ${repo.name}`}
          title="Delete"
        >
          <TrashIcon size={13} />
        </button>
      </div>
    </li>
  );
}
