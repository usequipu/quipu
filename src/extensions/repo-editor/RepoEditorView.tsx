import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftIcon, TrashIcon, GitForkIcon } from '@phosphor-icons/react';
import type { Tab } from '@/types/tab';
import type { Repo } from '@/types/agent';
import { useTab } from '../../context/TabContext';
import { useRepo } from '../../context/RepoContext';
import { Section, Field } from '../agent-editor/EditorLayout';

interface RepoEditorViewProps {
  tab: Tab;
}

export default function RepoEditorView({ tab }: RepoEditorViewProps) {
  const { closeTab } = useTab();
  const { getRepo, upsertRepo, deleteRepo } = useRepo();

  const repoId = useMemo(() => tab.path.replace(/^repo-editor:\/\//, ''), [tab.path]);
  const existing = getRepo(repoId);

  const [name, setName] = useState(existing?.name ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [folder, setFolder] = useState(existing?.folder ?? '');

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setUrl(existing.url);
      setFolder(existing.folder ?? '');
    }
  }, [existing]);

  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  const canSave = trimmedName.length > 0 && trimmedUrl.length > 0;
  const isNew = !existing;

  const handleBack = () => closeTab(tab.id);

  const handleSave = () => {
    if (!canSave) return;
    const now = new Date().toISOString();
    const repo: Repo = {
      id: repoId,
      name: trimmedName,
      url: trimmedUrl,
      folder: folder.trim() || undefined,
      localClonePath: existing?.localClonePath,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    upsertRepo(repo);
    closeTab(tab.id);
  };

  const handleDelete = async () => {
    if (!existing) {
      closeTab(tab.id);
      return;
    }
    if (!window.confirm(`Delete "${existing.name}"?`)) return;
    await deleteRepo(existing.id);
    closeTab(tab.id);
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
            <GitForkIcon size={16} className="text-accent" weight="regular" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{trimmedName || 'New repo'}</span>
            <span className="text-[11px] text-text-tertiary font-mono">repo-editor://{repoId}</span>
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
            {isNew ? 'Add repo' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex-1 px-8 py-6 max-w-3xl w-full mx-auto">
        <Section number="01" title="Identity" hint="How this repo shows up in the Repos panel.">
          <Field label="Name" hint="Short label — shown on the repo row.">
            <input
              className="w-full h-9 px-3 rounded border border-border bg-bg-surface text-sm focus:outline-none focus:border-accent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. quipu"
              autoFocus
            />
          </Field>
          <Field label="Folder" hint="Optional — group related repos under a folder.">
            <input
              className="w-full h-9 px-3 rounded border border-border bg-bg-surface text-sm focus:outline-none focus:border-accent"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="e.g. personal"
            />
          </Field>
        </Section>

        <Section number="02" title="Source" hint="Git URL used when the repo is cloned locally.">
          <Field label="URL">
            <input
              className="w-full h-9 px-3 rounded border border-border bg-bg-surface text-sm font-mono focus:outline-none focus:border-accent"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/usequipu/quipu.git"
            />
          </Field>
          {existing?.localClonePath && (
            <p className="mt-2 text-[11px] text-text-tertiary">
              Cloned locally at <code className="text-accent">{existing.localClonePath}</code>
            </p>
          )}
        </Section>

        <p className="text-xs text-text-tertiary mt-8">
          Cloning, file-tree preview, and context binding land in later units.
        </p>
      </div>
    </div>
  );
}
