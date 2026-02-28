import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useToast } from '../components/Toast';
import gitService from '../services/gitService';
import './SourceControlPanel.css';

const STATUS_LABELS = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Unmerged',
  '?': 'Untracked',
};

const STATUS_LETTERS = {
  M: 'M',
  A: 'A',
  D: 'D',
  R: 'R',
  C: 'C',
  U: 'U',
  '?': 'U',
};

function SourceControlPanel() {
  const { workspacePath, openFile } = useWorkspace();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [isGitRepo, setIsGitRepo] = useState(true);
  const [staged, setStaged] = useState([]);
  const [unstaged, setUnstaged] = useState([]);
  const [untracked, setUntracked] = useState([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [logEntries, setLogEntries] = useState([]);
  const [isLogVisible, setIsLogVisible] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  const branchDropdownRef = useRef(null);
  const pollTimerRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    if (!workspacePath) return;

    try {
      const status = await gitService.status(workspacePath);
      setStaged(status.staged || []);
      setUnstaged(status.unstaged || []);
      setUntracked(status.untracked || []);
      setIsGitRepo(true);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('not a git repository')) {
        setIsGitRepo(false);
        setStaged([]);
        setUnstaged([]);
        setUntracked([]);
      }
    }
  }, [workspacePath]);

  const fetchBranches = useCallback(async () => {
    if (!workspacePath) return;

    try {
      const data = await gitService.branches(workspacePath);
      setBranches(data.branches || []);
      setCurrentBranch(data.current || '');
    } catch {
      // Silently fail for branches - not critical
    }
  }, [workspacePath]);

  const fetchLog = useCallback(async () => {
    if (!workspacePath) return;

    try {
      const data = await gitService.log(workspacePath);
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
    const handleClickOutside = (e) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target)) {
        setIsBranchDropdownOpen(false);
      }
    };
    if (isBranchDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isBranchDropdownOpen]);

  const handleStageFile = useCallback(async (filePath) => {
    try {
      await gitService.stage(workspacePath, [filePath]);
      await fetchStatus();
    } catch (err) {
      showToast('Failed to stage file: ' + err.message, 'error');
    }
  }, [workspacePath, fetchStatus, showToast]);

  const handleStageAll = useCallback(async () => {
    const files = [
      ...unstaged.map(f => f.path),
      ...untracked,
    ];
    if (files.length === 0) return;

    try {
      await gitService.stage(workspacePath, files);
      await fetchStatus();
    } catch (err) {
      showToast('Failed to stage files: ' + err.message, 'error');
    }
  }, [workspacePath, unstaged, untracked, fetchStatus, showToast]);

  const handleUnstageFile = useCallback(async (filePath) => {
    try {
      await gitService.unstage(workspacePath, [filePath]);
      await fetchStatus();
    } catch (err) {
      showToast('Failed to unstage file: ' + err.message, 'error');
    }
  }, [workspacePath, fetchStatus, showToast]);

  const handleUnstageAll = useCallback(async () => {
    const files = staged.map(f => f.path);
    if (files.length === 0) return;

    try {
      await gitService.unstage(workspacePath, files);
      await fetchStatus();
    } catch (err) {
      showToast('Failed to unstage files: ' + err.message, 'error');
    }
  }, [workspacePath, staged, fetchStatus, showToast]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || staged.length === 0) return;

    setIsCommitting(true);
    try {
      await gitService.commit(workspacePath, commitMessage.trim());
      setCommitMessage('');
      showToast('Changes committed', 'success');
      await refreshAll();
    } catch (err) {
      showToast('Commit failed: ' + err.message, 'error');
    } finally {
      setIsCommitting(false);
    }
  }, [workspacePath, commitMessage, staged, refreshAll, showToast]);

  const handlePush = useCallback(async () => {
    setIsPushing(true);
    try {
      await gitService.push(workspacePath);
      showToast('Pushed to remote', 'success');
      await fetchLog();
    } catch (err) {
      showToast('Push failed: ' + err.message, 'error');
    } finally {
      setIsPushing(false);
    }
  }, [workspacePath, fetchLog, showToast]);

  const handlePull = useCallback(async () => {
    setIsPulling(true);
    try {
      await gitService.pull(workspacePath);
      showToast('Pulled from remote', 'success');
      await refreshAll();
    } catch (err) {
      showToast('Pull failed: ' + err.message, 'error');
    } finally {
      setIsPulling(false);
    }
  }, [workspacePath, refreshAll, showToast]);

  const handleCheckout = useCallback(async (branch) => {
    setIsBranchDropdownOpen(false);
    if (branch === currentBranch) return;

    try {
      await gitService.checkout(workspacePath, branch);
      showToast(`Switched to branch "${branch}"`, 'success');
      await refreshAll();
    } catch (err) {
      showToast('Checkout failed: ' + err.message, 'error');
    }
  }, [workspacePath, currentBranch, refreshAll, showToast]);

  const handleFileClick = useCallback((filePath) => {
    if (!workspacePath) return;
    // Build absolute path for openFile
    const separator = workspacePath.includes('\\') ? '\\' : '/';
    const absPath = workspacePath + separator + filePath;
    const fileName = filePath.split('/').pop().split('\\').pop();
    openFile(absPath, fileName);
  }, [workspacePath, openFile]);

  const handleCommitKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleCommit();
    }
  }, [handleCommit]);

  // No workspace
  if (!workspacePath) {
    return (
      <div className="source-control-panel">
        <div className="sc-header">
          <span className="sc-header-title">Source Control</span>
        </div>
        <div className="sc-empty">
          <p>No folder open</p>
        </div>
      </div>
    );
  }

  // Not a git repo
  if (!isGitRepo) {
    return (
      <div className="source-control-panel">
        <div className="sc-header">
          <span className="sc-header-title">Source Control</span>
        </div>
        <div className="sc-empty">
          <span className="sc-empty-icon">&#x2699;</span>
          <p>Not a git repository</p>
          <p className="sc-empty-sub">Initialize a repository to use source control</p>
        </div>
      </div>
    );
  }

  const hasChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0;
  const isCommitDisabled = !commitMessage.trim() || staged.length === 0 || isCommitting;

  return (
    <div className="source-control-panel">
      <div className="sc-header">
        <span className="sc-header-title">Source Control</span>
        {isLoading && <span className="sc-loading-indicator" />}
      </div>

      {/* Branch indicator */}
      <div className="sc-branch-section" ref={branchDropdownRef}>
        <button
          className="sc-branch-btn"
          onClick={() => setIsBranchDropdownOpen(prev => !prev)}
          title={`Current branch: ${currentBranch}`}
        >
          <span className="sc-branch-icon">&#x2387;</span>
          <span className="sc-branch-name">{currentBranch || 'unknown'}</span>
          <span className="sc-branch-arrow">{isBranchDropdownOpen ? '\u25B4' : '\u25BE'}</span>
        </button>
        {isBranchDropdownOpen && branches.length > 0 && (
          <div className="sc-branch-dropdown">
            {branches.map(branch => (
              <button
                key={branch}
                className={`sc-branch-option ${branch === currentBranch ? 'sc-branch-option-active' : ''}`}
                onClick={() => handleCheckout(branch)}
              >
                {branch === currentBranch && <span className="sc-branch-check">&#x2713;</span>}
                <span>{branch}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Commit section */}
      <div className="sc-commit-section">
        <textarea
          className="sc-commit-input"
          placeholder="Commit message (Ctrl+Enter to commit)"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleCommitKeyDown}
          rows={3}
        />
        <button
          className="sc-commit-btn"
          onClick={handleCommit}
          disabled={isCommitDisabled}
          title={staged.length === 0 ? 'Stage changes before committing' : 'Commit staged changes'}
        >
          {isCommitting ? 'Committing...' : 'Commit'}
        </button>
      </div>

      {/* Push / Pull */}
      <div className="sc-actions-row">
        <button
          className="sc-action-btn"
          onClick={handlePull}
          disabled={isPulling}
          title="Pull from remote"
        >
          {isPulling ? 'Pulling...' : '\u2193 Pull'}
        </button>
        <button
          className="sc-action-btn"
          onClick={handlePush}
          disabled={isPushing}
          title="Push to remote"
        >
          {isPushing ? 'Pushing...' : '\u2191 Push'}
        </button>
      </div>

      <div className="sc-changes-scroll">
        {/* No changes */}
        {!hasChanges && !isLoading && (
          <div className="sc-no-changes">
            <span className="sc-check-icon">&#x2713;</span>
            <span>No changes</span>
          </div>
        )}

        {/* Staged changes */}
        {staged.length > 0 && (
          <div className="sc-section">
            <div className="sc-section-header">
              <span className="sc-section-title">Staged Changes</span>
              <span className="sc-section-count">{staged.length}</span>
              <button
                className="sc-section-action"
                onClick={handleUnstageAll}
                title="Unstage all"
              >
                &minus;
              </button>
            </div>
            <div className="sc-file-list">
              {staged.map((file, idx) => (
                <div
                  key={`staged-${file.path}-${idx}`}
                  className="sc-file-item"
                  onClick={() => handleFileClick(file.path)}
                  title={`${file.path} [${STATUS_LABELS[file.status] || file.status}]`}
                >
                  <span className={`sc-status-badge sc-status-${file.status}`}>
                    {STATUS_LETTERS[file.status] || file.status}
                  </span>
                  <span className="sc-file-name">{file.path}</span>
                  <button
                    className="sc-file-action"
                    onClick={(e) => { e.stopPropagation(); handleUnstageFile(file.path); }}
                    title="Unstage"
                  >
                    &minus;
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unstaged changes */}
        {unstaged.length > 0 && (
          <div className="sc-section">
            <div className="sc-section-header">
              <span className="sc-section-title">Changes</span>
              <span className="sc-section-count">{unstaged.length}</span>
              <button
                className="sc-section-action"
                onClick={handleStageAll}
                title="Stage all"
              >
                +
              </button>
            </div>
            <div className="sc-file-list">
              {unstaged.map((file, idx) => (
                <div
                  key={`unstaged-${file.path}-${idx}`}
                  className="sc-file-item"
                  onClick={() => handleFileClick(file.path)}
                  title={`${file.path} [${STATUS_LABELS[file.status] || file.status}]`}
                >
                  <span className={`sc-status-badge sc-status-${file.status}`}>
                    {STATUS_LETTERS[file.status] || file.status}
                  </span>
                  <span className="sc-file-name">{file.path}</span>
                  <button
                    className="sc-file-action"
                    onClick={(e) => { e.stopPropagation(); handleStageFile(file.path); }}
                    title="Stage"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Untracked files */}
        {untracked.length > 0 && (
          <div className="sc-section">
            <div className="sc-section-header">
              <span className="sc-section-title">Untracked</span>
              <span className="sc-section-count">{untracked.length}</span>
              <button
                className="sc-section-action"
                onClick={handleStageAll}
                title="Stage all"
              >
                +
              </button>
            </div>
            <div className="sc-file-list">
              {untracked.map((filePath, idx) => (
                <div
                  key={`untracked-${filePath}-${idx}`}
                  className="sc-file-item"
                  onClick={() => handleFileClick(filePath)}
                  title={`${filePath} [Untracked]`}
                >
                  <span className="sc-status-badge sc-status-untracked">U</span>
                  <span className="sc-file-name">{filePath}</span>
                  <button
                    className="sc-file-action"
                    onClick={(e) => { e.stopPropagation(); handleStageFile(filePath); }}
                    title="Stage"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent commits */}
        <div className="sc-section">
          <div className="sc-section-header">
            <button
              className="sc-section-toggle"
              onClick={() => setIsLogVisible(prev => !prev)}
            >
              <span className={`sc-toggle-arrow ${isLogVisible ? 'sc-toggle-arrow-open' : ''}`} />
              <span className="sc-section-title">Recent Commits</span>
            </button>
          </div>
          {isLogVisible && (
            <div className="sc-log-list">
              {logEntries.length === 0 && (
                <div className="sc-log-empty">No commits yet</div>
              )}
              {logEntries.map((entry, idx) => (
                <div key={`log-${entry.hash}-${idx}`} className="sc-log-item">
                  <span className="sc-log-hash">{entry.hash}</span>
                  <span className="sc-log-message">{entry.message}</span>
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
