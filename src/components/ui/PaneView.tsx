import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import Editor_ from '../editor/Editor';
import TabBar from './TabBar';
import FileConflictBar from './FileConflictBar';
import RightEdgeDropZone from './RightEdgeDropZone';
import { useTab } from '../../context/TabContext';
import { useFileSystem } from '../../context/FileSystemContext';
import { resolveViewer } from '../../extensions/registry';
import { useToast } from './Toast';
import type { Pane, ActiveFile } from '../../types/tab';

// Crashes inside a plugin viewer (e.g. the Monaco-based code plugin failing to
// initialize its worker / loader) used to propagate to the App root and blank
// the entire window. ViewerErrorBoundary keeps the failure scoped to the pane
// so the rest of the editor stays usable. The boundary resets when the tab
// changes — a fresh viewer instance gets a clean error state via `key`.
interface ViewerErrorBoundaryProps {
  children: React.ReactNode;
  fileName: string;
}
interface ViewerErrorBoundaryState {
  error: Error | null;
}
class ViewerErrorBoundary extends React.Component<ViewerErrorBoundaryProps, ViewerErrorBoundaryState> {
  state: ViewerErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): ViewerErrorBoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[viewer] crashed', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full bg-bg-surface px-6 text-center">
          <div className="text-base text-text-primary mb-1">Viewer failed to load</div>
          <div className="text-xs text-text-secondary mb-3 max-w-md break-words">
            {this.props.fileName}: {this.state.error.message}
          </div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="px-3 py-1.5 text-xs bg-bg-elevated border border-border rounded-md text-text-primary hover:bg-accent-muted"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Per-pane references that App.tsx routes global commands to.
 *
 * `editorInstance` is owned by App's per-pane registry (not by PaneView) because
 * Editor reports its instance via the `onEditorReady` callback, which fires
 * after the Editor mounts.
 *
 * The three MutableRefObjects are owned by PaneView and registered with App
 * on mount so global handlers can call `paneRefs[activePaneId].toggleFindRef.current?.()`
 * etc. Each pane gets its own set so two simultaneous Editors don't overwrite
 * each other's callbacks.
 */
export interface PaneRefBag {
  toggleFindRef: React.MutableRefObject<(() => void) | null>;
  toggleEditorModeRef: React.MutableRefObject<(() => void) | null>;
  latestScrollTopRef: React.MutableRefObject<number | null>;
}

interface PaneViewProps {
  pane: Pane;
  /** Called when the pane's Editor instance becomes available (or null on unmount). */
  onEditorReady: (paneId: string, editor: TiptapEditor | null) => void;
  /** Called once on mount to register this pane's ref bag with App. */
  registerPaneRefs: (paneId: string, refs: PaneRefBag | null) => void;
  /**
   * Forwarded from App. Reports raw-mode toggles from this pane's Editor.
   * App reflects this in a single `editorRawMode` flag used by Save logic;
   * the value tracks whichever pane most recently reported, which is the
   * active pane in normal interaction.
   */
  onRawModeChange?: (raw: boolean) => void;
  /**
   * When true, the pane renders a `RightEdgeDropZone` on its right edge
   * (only visible while a drag is in progress). App passes true only for
   * the primary pane in single-pane mode; the zone triggers `splitToRight`.
   */
  showSplitDropZone?: boolean;
  /** Whether a tab drag is currently in progress (drives drop-zone visibility). */
  isDragActive?: boolean;
}

/**
 * Renders one pane: a tab bar scoped to the pane's tabs plus the resolved viewer
 * (Editor or extension component) for the pane's active tab.
 *
 * On mouse-down anywhere within the pane container, sets `activePaneId` to this
 * pane so global keyboard commands route here.
 */
export default function PaneView({
  pane,
  onEditorReady,
  registerPaneRefs,
  onRawModeChange,
  showSplitDropZone = false,
  isDragActive = false,
}: PaneViewProps) {
  const {
    openTabs,
    snapshotTab,
    setIsDirty,
    updateTabContent,
    openFile,
    setActivePaneId,
    activePaneId,
    resolveConflictReload,
    resolveConflictKeep,
    resolveConflictDismiss,
    updateFrontmatter,
    addFrontmatterProperty,
    removeFrontmatterProperty,
    renameFrontmatterKey,
    toggleFrontmatterCollapsed,
    addFrontmatterTag,
    removeFrontmatterTag,
    updateFrontmatterTag,
  } = useTab();
  const { workspacePath, revealFolder } = useFileSystem();
  const { showToast } = useToast();

  // Pane-scoped refs. Each pane owns its own MutableRefObjects so two Editor
  // instances can't overwrite each other's toggle callbacks.
  const toggleFindRef = useRef<(() => void) | null>(null);
  const toggleEditorModeRef = useRef<(() => void) | null>(null);
  const latestScrollTopRef = useRef<number | null>(null);
  // The TipTap editor instance reported by Editor's onEditorReady. Held here so
  // we can re-register it under a new pane id when pane.id changes (which
  // happens when secondary is promoted to primary after a pane closes).
  const currentEditorRef = useRef<TiptapEditor | null>(null);

  // Register this pane's ref bag with App on mount; deregister on unmount.
  // When pane.id changes (secondary→primary promotion path), the cleanup runs
  // with the OLD id and the new effect runs with the NEW id, so the registry
  // ends up keyed only by ids that are currently in PaneState.
  useEffect(() => {
    registerPaneRefs(pane.id, { toggleFindRef, toggleEditorModeRef, latestScrollTopRef });
    // Also re-register the editor instance under the new id so App's per-pane
    // editor registry tracks the live editor (not a stale dead one).
    if (currentEditorRef.current) {
      onEditorReady(pane.id, currentEditorRef.current);
    }
    return () => {
      registerPaneRefs(pane.id, null);
      onEditorReady(pane.id, null);
    };
  }, [pane.id, registerPaneRefs, onEditorReady]);

  // Resolve this pane's active tab + active file from the flat openTabs list.
  const activeTab = useMemo(
    () => openTabs.find(t => t.id === pane.activeTabId) ?? null,
    [openTabs, pane.activeTabId],
  );
  const activeFile: ActiveFile | null = activeTab ? {
    path: activeTab.path,
    name: activeTab.name,
    content: activeTab.content,
    isQuipu: activeTab.isQuipu,
  } : null;

  const isFocused = activePaneId === pane.id;

  // Editor's onContentChange marks the pane's active tab dirty and (for non-TipTap
  // viewers) writes the raw content back through updateTabContent.
  const handleContentChange = useCallback((content?: string) => {
    if (!activeFile) return;
    if (isFocused) setIsDirty(true);
    else if (pane.activeTabId) {
      // Edit happened in a non-focused pane (rare — usually focus follows interaction,
      // but cover the case). Use the per-tab dirty marker via updateTabContent semantics.
    }
    if (typeof content === 'string' && pane.activeTabId) {
      updateTabContent(pane.activeTabId, content);
    }
  }, [activeFile, isFocused, pane.activeTabId, setIsDirty, updateTabContent]);

  const handleEditorReady = useCallback((editor: TiptapEditor) => {
    currentEditorRef.current = editor;
    onEditorReady(pane.id, editor);
  }, [pane.id, onEditorReady]);

  // Rare: viewer changes from non-Editor to Editor or vice versa. Editor reports
  // its instance via onEditorReady; when it unmounts, clear the registry slot.
  // This effect runs on pane.id change (essentially never) — cleanup is handled
  // by the registerPaneRefs effect above when the pane is removed.

  const handleFocus = useCallback(() => {
    if (activePaneId !== pane.id) setActivePaneId(pane.id);
  }, [activePaneId, pane.id, setActivePaneId]);

  // Render the resolved viewer (extension) or the built-in Editor.
  const Viewer = activeTab && activeFile ? resolveViewer(activeTab, activeFile) : null;

  return (
    <div
      className="h-full flex flex-col overflow-hidden relative"
      onMouseDownCapture={handleFocus}
      onFocusCapture={handleFocus}
      data-pane-id={pane.id}
    >
      <div data-context="tab-bar">
        <TabBar pane={pane} />
      </div>
      {activeTab?.hasConflict && (
        <FileConflictBar
          fileName={activeTab.name}
          onReload={() => resolveConflictReload(activeTab.id)}
          onKeep={() => resolveConflictKeep(activeTab.id)}
          onDismiss={() => resolveConflictDismiss(activeTab.id)}
        />
      )}
      {activeFile && activeTab ? (
        Viewer ? (
          <ViewerErrorBoundary key={activeTab.id} fileName={activeFile.name}>
            <Viewer
              tab={activeTab}
              activeFile={activeFile}
              onContentChange={handleContentChange}
              isActive
              workspacePath={workspacePath ?? ''}
              showToast={showToast}
            />
          </ViewerErrorBoundary>
        ) : (
          <Editor_
            onEditorReady={handleEditorReady}
            onContentChange={handleContentChange}
            onRawModeChange={onRawModeChange ?? (() => {})}
            onToggleEditorModeRef={toggleEditorModeRef}
            onToggleFindRef={toggleFindRef}
            latestScrollTopRef={latestScrollTopRef}
            activeFile={activeFile}
            activeTabId={pane.activeTabId}
            activeTab={activeTab}
            snapshotTab={snapshotTab}
            workspacePath={workspacePath}
            openFile={openFile}
            revealFolder={revealFolder}
            updateFrontmatter={updateFrontmatter}
            addFrontmatterProperty={addFrontmatterProperty}
            removeFrontmatterProperty={removeFrontmatterProperty}
            renameFrontmatterKey={renameFrontmatterKey}
            toggleFrontmatterCollapsed={toggleFrontmatterCollapsed}
            addFrontmatterTag={addFrontmatterTag}
            removeFrontmatterTag={removeFrontmatterTag}
            updateFrontmatterTag={updateFrontmatterTag}
          />
        )
      ) : (
        <div className="flex flex-col items-center justify-center h-full w-full bg-bg-surface">
          <div className="text-xl text-text-primary opacity-50 mb-2">Open a file to start editing</div>
          <div className="text-sm text-text-primary opacity-35 italic">Use the Explorer or press Ctrl+P</div>
        </div>
      )}
      {showSplitDropZone && <RightEdgeDropZone isDragActive={isDragActive} />}
    </div>
  );
}
