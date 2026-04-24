import React, { useEffect } from 'react';
import storage from '../services/storageService';
import { FileSystemProvider, useFileSystem } from './FileSystemContext';
import { TabProvider, useTab } from './TabContext';
import { TerminalProvider } from './TerminalContext';
import { KamaluProvider, useKamalu } from './KamaluContext';
import { AgentProvider } from './AgentContext';
import { RepoProvider } from './RepoContext';

function KamaluWorkspaceSync() {
  const { workspacePath } = useFileSystem();
  const { notifyWorkspacePath } = useKamalu();
  useEffect(() => {
    if (workspacePath) notifyWorkspacePath(workspacePath);
  }, [workspacePath, notifyWorkspacePath]);
  return null;
}

interface SessionSnapshotEntry {
  path: string;
  scrollPosition: number;
  type?: string;
  name?: string;
}

interface SessionSnapshot {
  openFilePaths: Array<SessionSnapshotEntry>;
  activeFilePath: string | null;
  expandedFolders: string[];
}

/**
 * SessionPersistence observes openTabs, activeTabId (from TabContext),
 * expandedFolders, workspacePath (from FileSystemContext), and debounce-writes
 * the session snapshot to storageService.
 */
function SessionPersistence({ children }: { children: React.ReactNode }) {
  const { openTabs, activeTabId } = useTab();
  const { expandedFolders, workspacePath } = useFileSystem();

  useEffect(() => {
    if (!workspacePath) return;
    const timer = setTimeout(() => {
      const snapshot: SessionSnapshot = {
        openFilePaths: openTabs
          .filter(t => t.path)
          .map(t => ({
            path: t.path,
            scrollPosition: t.scrollPosition ?? 0,
            ...(t.type ? { type: t.type, name: t.name } : {}),
          })),
        activeFilePath: openTabs.find(t => t.id === activeTabId)?.path ?? null,
        expandedFolders: [...expandedFolders],
      };
      storage.set(`session:${workspacePath}`, snapshot).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [openTabs, activeTabId, expandedFolders, workspacePath]);

  return <>{children}</>;
}

/**
 * Composes all contexts into a single provider tree.
 *
 * Nesting order: FileSystemProvider > TabProvider > TerminalProvider
 * - TabContext consumes workspacePath from FileSystemContext
 * - TerminalContext is self-contained
 * - SessionPersistence observes both Tab and FileSystem state
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  return (
    <KamaluProvider>
      <FileSystemProvider>
        <TabProvider>
          <RepoProvider>
            <AgentProvider>
              <TerminalProvider>
                <SessionPersistence>
                  <KamaluWorkspaceSync />
                  {children}
                </SessionPersistence>
              </TerminalProvider>
            </AgentProvider>
          </RepoProvider>
        </TabProvider>
      </FileSystemProvider>
    </KamaluProvider>
  );
}
