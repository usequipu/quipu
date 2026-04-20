import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  GitBranchIcon, CaretDownIcon, CaretUpIcon, CaretRightIcon,
  CheckIcon, MinusIcon, PlusIcon, ArrowDownIcon, ArrowUpIcon,
  GearIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useFileSystem } from '../../context/FileSystemContext';
import { useToast } from './Toast';
import gitService from '../../services/gitService';
import { executeCommand } from '../../extensions/commandRegistry';

type GitStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

interface GitFileEntry {
  path: string;
  status: GitStatusCode;
}

interface GitLogEntry {
  hash: string;
  message: string;
}

interface SelectedDiff {
  path: string;
  staged: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SourceControlPanelProps {}

const STATUS_LABELS: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Unmerged',
  '?': 'Untracked',
};

const STATUS_LETTERS: Record<string, string> = {
  M: 'M',
  A: 'A',
  D: 'D',
  R: 'R',
  C: 'C',
  U: 'U',
  '?': 'U',
};

const STATUS_COLORS: Record<string, string> = {
  M: 'text-git-modified bg-git-modified/10',
  A: 'text-git-added bg-git-added/10',
  D: 'text-git-deleted bg-git-deleted/10',
  R: 'text-git-renamed bg-git-renamed/10',
  C: 'text-git-renamed bg-git-renamed/10',
  U: 'text-[#9b6bc7] bg-[#9b6bc7]/10',
};

function SourceControlPanel(_props: SourceControlPanelProps) {
  const { workspacePath, updateGitChangeCount } = useFileSystem();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isGitRepo, setIsGitRepo] = useState<boolean>(true);
  const [staged, setStaged] = useState<GitFileEntry[]>([]);
  const [unstaged, setUnstaged] = useState<GitFileEntry[]>([]);
  const [untracked, setUntracked] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState<boolean>(false);
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([]);
  const [isLogVisible, setIsLogVisible] = useState<boolean>(false);
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [isPulling, setIsPulling] = useState<boolean>(false);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [selectedDiff, setSelectedDiff] = useState<SelectedDiff | null>(null);

  const branchDropdownRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!workspacePath) return;

    try {
      const status = await gitService.status(workspacePath) as {
        staged?: GitFileEntry[];
        unstaged?: GitFileEntry[];
        untracked?: string[];
      };
      const newStaged = status.staged || [];
      const newUnstaged = status.unstaged || [];
      const newUntracked = status.untracked || [];
      setStaged(newStaged);
      setUnstaged(newUnstaged);
      setUntracked(newUntracked);
      setIsGitRepo(true);
      updateGitChangeCount(newStaged.length + newUnstaged.length + newUntracked.length);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('not a git repository')) {
        setIsGitRepo(false);
        setStaged([]);
        setUnstaged([]);
        setUntracked([]);
        updateGitChangeCount(0);
      }
    }
  }, [workspacePath, updateGitChangeCount]);

  const fetchBranches = useCallback(async () => {
    if (!workspacePath) return;

    try {
      const data = await gitService.branches(workspacePath) as {
        branches?: string[];
        current?: string;
      };
      setBranches(data.branches || []);
      setCurrentBranch(data.current || '');
    } catch {
      // Silently fail for branches - not critical
    }
  }, [workspacePath]);

  const fetchLog = useCallback(async () => {
    if (!workspacePath) return;

    try {
      const data = await gitService.log(workspacePath) as {
        entries?: GitLogEntry[];
      };
      setLogEntries(data.entries || []);
    } catch {
      // Silently fail for log
    }
  }, [workspacePath]);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchStatus(), fetchBranches(), fetchLog()]);
    setIsLoading(false);
  }, [fetchStatus, fetchBranches, fetchLog]);

  // Initial fetch and polling
  useEffect(() => {
    if (!workspacePath) return;

    refreshAll();

    pollTimerRef.current = setInterval(() => {
      fetchStatus();
      fetchBranches();
    }, 5000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [workspacePath, refreshAll, fetchStatus, fetchBranches]);

  // Close branch dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setIsBranchDropdownOpen(false);
      }
    };
    if (isBranchDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isBranchDropdownOpen]);

  const handleStageFile = useCallback(async (filePath: string) => {
    if (!workspacePath) return;
    try {
      await gitService.stage(workspacePath, [filePath]);
      await fetchStatus();
    } catch (err) {
      showToast('Failed to stage file: ' + (err as Error).message, 'error');
    }
  }, [workspacePath, fetchStatus, showToast]);

  const handleStageAll = useCallback(async () => {
    if (!workspacePath) return;
    const files = [
      ...unstaged.map(f => f.path),
      ...untracked,
    ];
    if (files.length === 0) return;

    try {
      await gitService.stage(workspacePath, files);
      await fetchStatus();
    } catch (err) {
      showToast('Failed to stage files: ' + (err as Error).message, 'error');
    }
  }, [workspacePath, unstaged, untracked, fetchStatus, showToast]);

  const handleUnstageFile = useCallback(async (filePath: string) => {
    if (!workspacePath) return;
    try {
      await gitService.unstage(workspacePath, [filePath]);
      await fetchStatus();
    } catch (err) {
      showToast('Failed to unstage file: ' + (err as Error).message, 'error');
    }
  }, [workspacePath, fetchStatus, showToast]);

  const handleUnstageAll = useCallback(async () => {
    if (!workspacePath) return;
    const files = staged.map(f => f.path);
    if (files.length === 0) return;

    try {
      await gitService.unstage(workspacePath, files);
      await fetchStatus();
    } catch (err) {
      showToast('Failed to unstage files: ' + (err as Error).message, 'error');
    }
  }, [workspacePath, staged, fetchStatus, showToast]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || staged.length === 0) return;

    if (!workspacePath) return;
    setIsCommitting(true);
    try {
      await gitService.commit(workspacePath, commitMessage.trim());
      setCommitMessage('');
      showToast('Changes committed', 'success');
      await refreshAll();
    } catch (err) {
      showToast('Commit failed: ' + (err as Error).message, 'error');
    } finally {
      setIsCommitting(false);
    }
  }, [workspacePath, commitMessage, staged, refreshAll, showToast]);

  const handlePush = useCallback(async () => {
    if (!workspacePath) return;
    setIsPushing(true);
    try {
      await gitService.push(workspacePath);
      showToast('Pushed to remote', 'success');
      await fetchLog();
    } catch (err) {
      showToast('Push failed: ' + (err as Error).message, 'error');
    } finally {
      setIsPushing(false);
    }
  }, [workspacePath, fetchLog, showToast]);

  const handlePull = useCallback(async () => {
    if (!workspacePath) return;
    setIsPulling(true);
    try {
      await gitService.pull(workspacePath);
      showToast('Pulled from remote', 'success');
      await refreshAll();
    } catch (err) {
      showToast('Pull failed: ' + (err as Error).message, 'error');
    } finally {
      setIsPulling(false);
    }
  }, [workspacePath, refreshAll, showToast]);

  const handleCheckout = useCallback(async (branch: string) => {
    if (!workspacePath) return;
    setIsBranchDropdownOpen(false);
    if (branch === currentBranch) return;

    try {
      await gitService.checkout(workspacePath, branch);
      showToast(`Switched to branch "${branch}"`, 'success');
      await refreshAll();
    } catch (err) {
      showToast('Checkout failed: ' + (err as Error).message, 'error');
    }
  }, [workspacePath, currentBranch, refreshAll, showToast]);

  const handleFileClick = useCallback(async (filePath: string, isStaged: boolean = false) => {
    if (!workspacePath) return;

    if (selectedDiff?.path === filePath && selectedDiff?.staged === isStaged) {
      setSelectedDiff(null);
      return;
    }

    try {
      const diffText = await gitService.diff(workspacePath, filePath, isStaged);
      setSelectedDiff({ path: filePath, staged: isStaged });
      executeCommand('diff.open', { filePath, diffText, isStaged });
    } catch (err) {
      showToast('Failed to load diff: ' + (err as Error).message, 'error');
    }
  }, [workspacePath, selectedDiff, showToast]);

  const handleCommitKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleCommit();
    }
  }, [handleCommit]);

  // No workspace
  if (!workspacePath) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-bg-surface text-text-primary text-[13px] select-none">
        <div className="h-[35px] flex items-center px-3 border-b border-border shrink-0 gap-2">
          <span className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">Source Control</span>
        </div>
        <div className="flex flex-col items-center justify-center py-8 px-5 flex-1 gap-2">
          <p className="text-text-primary text-[13px] m-0 opacity-70">No folder open</p>
        </div>
      </div>
    );
  }

  // Not a git repo
  if (!isGitRepo) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-bg-surface text-text-primary text-[13px] select-none">
        <div className="h-[35px] flex items-center px-3 border-b border-border shrink-0 gap-2">
          <span className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">Source Control</span>
        </div>
        <div className="flex flex-col items-center justify-center py-8 px-5 flex-1 gap-2">
          <GearIcon size={24} className="opacity-30" />
          <p className="text-text-primary text-[13px] m-0 opacity-70">Not a git repository</p>
          <p className="text-text-primary text-xs m-0 opacity-50">Initialize a repository to use source control</p>
        </div>
      </div>
    );
  }

  const hasChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0;
  const isCommitDisabled = !commitMessage.trim() || staged.length === 0 || isCommitting;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-surface text-text-primary text-[13px] select-none">
      <div className="h-[35px] flex items-center px-3 border-b border-border shrink-0 gap-2">
        <span className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">Source Control</span>
        {isLoading && <span className="w-3 h-3 border-2 border-border border-t-accent rounded-full animate-spin" />}
      </div>

      {/* Branch indicator */}
      <div className="relative px-2.5 pt-2 pb-1 shrink-0" ref={branchDropdownRef}>
        <button
          className="flex items-center gap-1.5 w-full bg-bg-elevated border border-border rounded py-1.5 px-2 text-xs font-mono text-text-primary cursor-pointer text-left hover:border-accent"
          onClick={() => setIsBranchDropdownOpen(prev => !prev)}
          title={`Current branch: ${currentBranch}`}
        >
          <GitBranchIcon size={14} className="shrink-0 opacity-60" />
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{currentBranch || 'unknown'}</span>
          {isBranchDropdownOpen ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />}
        </button>
        {isBranchDropdownOpen && branches.length > 0 && (
          <div className="absolute top-full left-2.5 right-2.5 bg-bg-elevated border border-border rounded shadow-lg z-[100] max-h-[200px] overflow-y-auto mt-0.5">
            {branches.map(branch => (
              <button
                key={branch}
                className={cn(
                  "flex items-center gap-1.5 w-full bg-transparent border-none py-1.5 px-2.5 text-xs font-mono text-text-primary cursor-pointer text-left",
                  "hover:bg-white/[0.06]",
                  branch === currentBranch && "font-semibold text-accent",
                )}
                onClick={() => handleCheckout(branch)}
              >
                {branch === currentBranch && <CheckIcon size={14} className="text-accent" />}
                <span>{branch}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Commit section */}
      <div className="py-1.5 px-2.5 shrink-0">
        <textarea
          className="w-full bg-bg-elevated border border-border rounded py-1.5 px-2 text-xs font-sans text-text-primary resize-y min-h-[40px] max-h-[120px] outline-none leading-snug focus:border-accent placeholder:text-text-tertiary"
          placeholder="Commit message (Ctrl+Enter to commit)"
          value={commitMessage}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCommitMessage(e.target.value)}
          onKeyDown={handleCommitKeyDown}
          rows={3}
        />
        <button
          className="block w-full mt-1.5 py-1.5 px-3 bg-accent text-white border-none rounded text-xs font-medium font-sans cursor-pointer transition-colors hover:enabled:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handleCommit}
          disabled={isCommitDisabled}
          title={staged.length === 0 ? 'Stage changes before committing' : 'Commit staged changes'}
        >
          {isCommitting ? 'Committing...' : 'Commit'}
        </button>
      </div>

      {/* Push / Pull */}
      <div className="flex gap-1.5 px-2.5 pb-2 shrink-0">
        <button
          className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-bg-elevated border border-border rounded text-xs font-sans text-text-primary cursor-pointer transition-colors hover:enabled:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handlePull}
          disabled={isPulling}
          title="Pull from remote"
        >
          {isPulling ? 'Pulling...' : <><ArrowDownIcon size={14} /> Pull</>}
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-bg-elevated border border-border rounded text-xs font-sans text-text-primary cursor-pointer transition-colors hover:enabled:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handlePush}
          disabled={isPushing}
          title="Push to remote"
        >
          {isPushing ? 'Pushing...' : <><ArrowUpIcon size={14} /> Push</>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb:hover]:bg-white/25">
        {/* No changes */}
        {!hasChanges && !isLoading && (
          <div className="flex items-center justify-center gap-2 py-5 px-3 text-[13px] text-text-primary opacity-50">
            <CheckIcon size={16} className="text-success" />
            <span>No changes</span>
          </div>
        )}

        {/* Staged changes */}
        {staged.length > 0 && (
          <div className="mb-0.5">
            <div className="flex items-center py-1 px-2.5 bg-white/[0.03] gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary flex-1">Staged Changes</span>
              <span className="text-[10px] font-normal bg-white/[0.06] px-1.5 rounded-full text-text-primary opacity-70">{staged.length}</span>
              <button
                className="bg-transparent border border-transparent rounded-sm px-1.5 text-text-primary opacity-40 cursor-pointer leading-none hover:opacity-80 hover:bg-white/[0.06] hover:border-border"
                onClick={handleUnstageAll}
                title="Unstage all"
              >
                <MinusIcon size={14} />
              </button>
            </div>
            <div>
              {staged.map((file, idx) => (
                <div
                  key={`staged-${file.path}-${idx}`}
                  className={cn(
                    "group flex items-center h-6 pr-2.5 pl-3.5 cursor-pointer gap-1.5 hover:bg-white/[0.06]",
                    selectedDiff?.path === file.path && selectedDiff?.staged === true && "bg-white/[0.08]",
                  )}
                  onClick={() => handleFileClick(file.path, true)}
                  title={`${file.path} [${STATUS_LABELS[file.status] || file.status}]`}
                >
                  <span className={cn("shrink-0 w-4 h-4 inline-flex items-center justify-center text-[10px] font-bold font-mono rounded-sm", STATUS_COLORS[file.status] || 'text-text-tertiary bg-white/[0.06]')}>
                    {STATUS_LETTERS[file.status] || file.status}
                  </span>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-6 min-w-0">{file.path}</span>
                  <button
                    className="shrink-0 bg-transparent border border-transparent rounded-sm px-1 text-text-primary opacity-0 cursor-pointer leading-none group-hover:opacity-60 hover:!opacity-100 hover:bg-white/[0.08] hover:border-border"
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleUnstageFile(file.path); }}
                    title="Unstage"
                  >
                    <MinusIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unstaged changes */}
        {unstaged.length > 0 && (
          <div className="mb-0.5">
            <div className="flex items-center py-1 px-2.5 bg-white/[0.03] gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary flex-1">Changes</span>
              <span className="text-[10px] font-normal bg-white/[0.06] px-1.5 rounded-full text-text-primary opacity-70">{unstaged.length}</span>
              <button
                className="bg-transparent border border-transparent rounded-sm px-1.5 text-text-primary opacity-40 cursor-pointer leading-none hover:opacity-80 hover:bg-white/[0.06] hover:border-border"
                onClick={handleStageAll}
                title="Stage all"
              >
                <PlusIcon size={14} />
              </button>
            </div>
            <div>
              {unstaged.map((file, idx) => (
                <div
                  key={`unstaged-${file.path}-${idx}`}
                  className={cn(
                    "group flex items-center h-6 pr-2.5 pl-3.5 cursor-pointer gap-1.5 hover:bg-white/[0.06]",
                    selectedDiff?.path === file.path && selectedDiff?.staged === false && "bg-white/[0.08]",
                  )}
                  onClick={() => handleFileClick(file.path, false)}
                  title={`${file.path} [${STATUS_LABELS[file.status] || file.status}]`}
                >
                  <span className={cn("shrink-0 w-4 h-4 inline-flex items-center justify-center text-[10px] font-bold font-mono rounded-sm", STATUS_COLORS[file.status] || 'text-text-tertiary bg-white/[0.06]')}>
                    {STATUS_LETTERS[file.status] || file.status}
                  </span>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-6 min-w-0">{file.path}</span>
                  <button
                    className="shrink-0 bg-transparent border border-transparent rounded-sm px-1 text-text-primary opacity-0 cursor-pointer leading-none group-hover:opacity-60 hover:!opacity-100 hover:bg-white/[0.08] hover:border-border"
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleStageFile(file.path); }}
                    title="Stage"
                  >
                    <PlusIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Untracked files */}
        {untracked.length > 0 && (
          <div className="mb-0.5">
            <div className="flex items-center py-1 px-2.5 bg-white/[0.03] gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary flex-1">Untracked</span>
              <span className="text-[10px] font-normal bg-white/[0.06] px-1.5 rounded-full text-text-primary opacity-70">{untracked.length}</span>
              <button
                className="bg-transparent border border-transparent rounded-sm px-1.5 text-text-primary opacity-40 cursor-pointer leading-none hover:opacity-80 hover:bg-white/[0.06] hover:border-border"
                onClick={handleStageAll}
                title="Stage all"
              >
                <PlusIcon size={14} />
              </button>
            </div>
            <div>
              {untracked.map((filePath, idx) => (
                <div
                  key={`untracked-${filePath}-${idx}`}
                  className={cn(
                    "group flex items-center h-6 pr-2.5 pl-3.5 cursor-pointer gap-1.5 hover:bg-white/[0.06]",
                    selectedDiff?.path === filePath && selectedDiff?.staged === false && "bg-white/[0.08]",
                  )}
                  onClick={() => handleFileClick(filePath, false)}
                  title={`${filePath} [Untracked]`}
                >
                  <span className="shrink-0 w-4 h-4 inline-flex items-center justify-center text-[10px] font-bold font-mono rounded-sm text-git-untracked bg-white/[0.06]">U</span>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-6 min-w-0">{filePath}</span>
                  <button
                    className="shrink-0 bg-transparent border border-transparent rounded-sm px-1 text-text-primary opacity-0 cursor-pointer leading-none group-hover:opacity-60 hover:!opacity-100 hover:bg-white/[0.08] hover:border-border"
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleStageFile(filePath); }}
                    title="Stage"
                  >
                    <PlusIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent commits */}
        <div className="mb-0.5">
          <div className="flex items-center py-1 px-2.5 bg-white/[0.03] gap-1.5">
            <button
              className="flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer flex-1 text-text-tertiary"
              onClick={() => setIsLogVisible(prev => !prev)}
            >
              {isLogVisible ? <CaretDownIcon size={14} /> : <CaretRightIcon size={14} />}
              <span className="text-[11px] font-semibold uppercase tracking-wide">Recent Commits</span>
            </button>
          </div>
          {isLogVisible && (
            <div className="py-0.5">
              {logEntries.length === 0 && (
                <div className="py-2 px-3.5 text-xs text-text-primary opacity-50 italic">No commits yet</div>
              )}
              {logEntries.map((entry, idx) => (
                <div key={`log-${entry.hash}-${idx}`} className="flex items-baseline py-0.5 px-3.5 gap-2 text-xs">
                  <span className="shrink-0 font-mono text-[11px] text-accent min-w-14">{entry.hash}</span>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary min-w-0">{entry.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SourceControlPanel;
