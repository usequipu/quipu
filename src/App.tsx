import React, { useState, useEffect, useCallback } from 'react';
import { IconContext } from '@phosphor-icons/react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Editor } from '@tiptap/react';
import Terminal from './components/ui/Terminal';
import { Dialog } from 'radix-ui';
import PaneView from './components/ui/PaneView';
import ActivityBar from './components/ui/ActivityBar';
import QuickOpen from './components/ui/QuickOpen';
import WorkspaceFilePicker from './components/ui/WorkspaceFilePicker';
import TitleBar from './components/ui/TitleBar';
import { buildWindowTitle } from '@/lib/windowTitle';
import ContextMenu from './components/ui/ContextMenu';
import FolderPicker from './components/ui/FolderPicker';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { useFileSystem } from './context/FileSystemContext';
import { useTab } from './context/TabContext';
import { useTerminal } from './context/TerminalContext';
import { ToastProvider, useToast } from './components/ui/Toast';
import frameService from './services/frameService';
import fs from './services/fileSystem';
import gitServiceInstance from './services/gitService';
import kernelServiceInstance from './services/kernelService';
import terminalServiceInstance from './services/terminalService';
import claudeInstaller from './services/claudeInstaller';
import DiffViewer from './extensions/diff-viewer/DiffViewer';
import { registerExtension, getExtensionForTab, getCommandsForTab } from './extensions/registry';
import { getRegisteredPanels, registerPanel } from './extensions/panelRegistry';
import { registerCommand, executeCommand } from './extensions/commandRegistry';
import { registerKeybinding, resolveKeybinding } from './extensions/keybindingRegistry';
import pluginLoader, { createPluginApi } from './services/pluginLoader';
import type { PluginApi } from './types/plugin-types';
import { builtinKeybindings } from './data/builtinKeybindings';
import FirstRunWizard from './components/ui/FirstRunWizard';
import StatusBar from './components/ui/StatusBar';
import './extensions'; // register all viewer extensions

interface ContextMenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
  danger?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ActiveDiff {
  filePath: string;
  diffText: string;
  isStaged: boolean;
}

function AppContent() {
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [editorRawMode, setEditorRawMode] = useState<boolean>(false);
  // Incremented after plugins finish loading so resolveViewer re-runs for already-open tabs.
  const [, setPluginRevision] = useState(0);

  // Per-pane editor registry. PaneView calls handlePaneEditorReady on mount/unmount;
  // we mirror the active pane's editor into `editorInstance` state so the rest of
  // the app (menu actions, keyboard shortcuts, pre-switch snapshot effect) keeps
  // its single-editor mental model. When the active pane changes, the effect
  // below resyncs `editorInstance` to that pane's slot.
  const editorInstancesRef = React.useRef<Record<string, Editor | null>>({});
  // Per-pane ref bags (toggleFindRef, toggleEditorModeRef, latestScrollTopRef).
  // PaneView owns these MutableRefObjects internally and registers them here on mount.
  const paneRefsRef = React.useRef<Record<string, import('./components/ui/PaneView').PaneRefBag | null>>({});

  const handlePaneEditorReady = useCallback((paneId: string, editor: Editor | null) => {
    editorInstancesRef.current[paneId] = editor;
    // Editor's onEditorReady fires inside a useEffect after mount; we don't know
    // here whether this pane is the active one. The sync effect below picks it up.
    setEditorInstance(prev => prev === editor ? prev : editor);
  }, []);

  const registerPaneRefs = useCallback((paneId: string, refs: import('./components/ui/PaneView').PaneRefBag | null) => {
    if (refs) paneRefsRef.current[paneId] = refs;
    else delete paneRefsRef.current[paneId];
  }, []);

  const {
    workspacePath, showFolderPicker, selectFolder, cancelFolderPicker, revealFolder, openFolder,
  } = useFileSystem();
  const {
    activeFile, saveFile, setIsDirty, updateTabContent, openFile,
    activeTabId, activeTab, snapshotTab, openTabs, closeTab, switchTab,
    updateFrontmatter, addFrontmatterProperty, removeFrontmatterProperty,
    renameFrontmatterKey, toggleFrontmatterCollapsed,
    addFrontmatterTag, removeFrontmatterTag, updateFrontmatterTag,
    resolveConflictReload, resolveConflictKeep, resolveConflictDismiss,
    reloadTabFromDisk,
    primary, secondary, activePaneId, reorderTabs, moveTabToPane, splitToRight,
  } = useTab();
  // Helpers that read from the active pane's per-pane ref bag.
  const getActivePaneToggleFind = () => paneRefsRef.current[activePaneId]?.toggleFindRef.current ?? null;
  const getActivePaneToggleEditorMode = () => paneRefsRef.current[activePaneId]?.toggleEditorModeRef.current ?? null;
  const getActivePaneLatestScrollTop = () => paneRefsRef.current[activePaneId]?.latestScrollTopRef.current ?? null;

  // When the active pane changes, sync `editorInstance` state to that pane's editor
  // so global commands (Save, Find, etc.) and the pre-switch snapshot effect target
  // the right editor.
  useEffect(() => {
    setEditorInstance(editorInstancesRef.current[activePaneId] ?? null);
  }, [activePaneId]);

  // Tab drag-and-drop: the DndContext lives at App level so a tab can be dragged
  // from one pane's bar to another. Each pane's TabBar renders a SortableContext
  // scoped to its own tabs; useSortable items carry { paneId } in `data` so this
  // handler can tell same-pane reorder from cross-pane move. The right-edge
  // drop zone (id 'pane:right-edge') triggers splitToRight when single-pane.
  const tabDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [isTabDragActive, setIsTabDragActive] = useState(false);
  // Track which tab is currently being dragged so we can render its preview
  // inside <DragOverlay> (a portal that escapes the tab bar's overflow).
  // Without the overlay, the dragged tab's transform stays clipped inside
  // the tab bar and the user gets no visual feedback when the cursor moves
  // down into the editor area / over the right-edge drop zone.
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const handleTabDragStart = useCallback((event: DragStartEvent) => {
    setIsTabDragActive(true);
    setDraggedTabId(String(event.active.id));
  }, []);
  const handleTabDragCancel = useCallback(() => {
    setIsTabDragActive(false);
    setDraggedTabId(null);
  }, []);
  const handleTabDragEnd = useCallback((event: DragEndEvent) => {
    setIsTabDragActive(false);
    setDraggedTabId(null);
    const { active, over } = event;
    if (!over) return;
    // Drop on the right-edge zone → split (no-op when secondary already exists,
    // or when source pane has < 2 tabs; both guards live in splitToRight).
    if (over.id === 'pane:right-edge') {
      splitToRight(String(active.id));
      return;
    }
    const sourcePaneId = (active.data.current as { paneId?: string } | undefined)?.paneId;
    const overData = over.data.current as { paneId?: string; kind?: string } | undefined;
    const overKind = overData?.kind;
    const targetPaneId = overData?.paneId;
    if (!sourcePaneId || !targetPaneId) return;

    // Drop on the empty area of a pane's tab bar (no specific tab targeted).
    // Append to that pane; if it's the same pane, do nothing.
    if (overKind === 'pane-bar') {
      if (sourcePaneId !== targetPaneId) {
        moveTabToPane(String(active.id), targetPaneId);
      }
      return;
    }

    if (active.id === over.id) return;
    if (sourcePaneId === targetPaneId) {
      reorderTabs(String(active.id), String(over.id));
    } else {
      // Cross-pane move: drop position is the index of `over` within the target pane.
      const targetPane = targetPaneId === primary.id ? primary : secondary;
      const index = targetPane?.tabIds.indexOf(String(over.id)) ?? undefined;
      moveTabToPane(String(active.id), targetPaneId, index);
    }
  }, [primary, secondary, reorderTabs, moveTabToPane, splitToRight]);
  const {
    terminalTabs, activeTerminalId, createTerminalTab, setTerminalClaudeRunning,
    sendToTerminal, clearTerminal, getTerminalSelection, hasTerminalSelection,
    pasteToTerminal, focusTerminal,
  } = useTerminal();
  const { showToast } = useToast();
  const [activePanel, setActivePanel] = useState<string | null>('explorer');
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState<boolean>(false);
  const [quickOpenInitialValue, setQuickOpenInitialValue] = useState<string>('');
  // Input dialog state (replaces window.prompt which doesn't work in Electron)
  const [inputDialog, setInputDialog] = useState<{
    title: string;
    placeholder: string;
    defaultValue: string;
    onSubmit: (value: string) => void;
  } | null>(null);
  const [inputDialogValue, setInputDialogValue] = useState('');
  // Workspace file picker — used by Link Database / Link MDX slash
  // commands so users don't have to navigate the OS dialog to find a
  // file that lives inside the workspace.
  const [pickerDialog, setPickerDialog] = useState<{
    title: string;
    placeholder: string;
    match: (rel: string) => boolean;
    onSelect: (rel: string) => void;
    onBrowseOutside?: () => void;
  } | null>(null);
  const [activeDiff, setActiveDiff] = useState<ActiveDiff | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  // Derive isClaudeRunning from the active terminal tab
  const activeTerminalTab = terminalTabs.find(t => t.id === activeTerminalId);
  const isClaudeRunning = activeTerminalTab?.isClaudeRunning ?? false;

  // Snapshot the TipTap editor content before switching away to a non-Editor viewer (e.g., PDF)
  // Uses a ref + callback approach instead of useEffect to avoid race conditions
  // where Editor.jsx's content loading effect might run first
  const prevActiveTabIdRef = React.useRef<string | null>(activeTabId);
  // Track tab changes — snapshot only when switching TO a non-Editor viewer
  useEffect(() => {
    const prevId = prevActiveTabIdRef.current;
    prevActiveTabIdRef.current = activeTabId;

    if (prevId && prevId !== activeTabId) {
      // Check if the NEW active tab will NOT use the Editor component
      const newTab = openTabs.find(t => t.id === activeTabId);
      const isNewTabNonEditor = newTab && getExtensionForTab(newTab) !== null;

      // Only snapshot here if Editor is about to unmount (non-Editor tab)
      // For Editor-to-Editor switches, Editor.jsx handles the snapshot internally
      if (isNewTabNonEditor && editorInstance && !editorInstance.isDestroyed) {
        snapshotTab(prevId, editorInstance.getJSON(), getActivePaneLatestScrollTop() ?? 0);
      }
    }
  }, [activeTabId, editorInstance, snapshotTab, openTabs]);

  // Clear diff view when user switches to a different tab
  useEffect(() => {
    setActiveDiff(null);
  }, [activeTabId]);

  // The DndContext only mounts when activeDiff is null. If the diff opens
  // mid-drag, the DndContext unmounts before any drag-end / drag-cancel event
  // can fire, leaving isTabDragActive stuck at true; the right-edge drop zone
  // would then block clicks once the diff closes. Reset on diff state change.
  useEffect(() => {
    if (activeDiff !== null) setIsTabDragActive(false);
  }, [activeDiff]);

  // Plugin loader startup — runs once after mount.
  // Registers built-in commands (via appActionsRef) and keybindings, then loads plugins.
  useEffect(() => {
    // --- Diff overlay commands ---
    registerCommand('diff.open', (...args: unknown[]) => {
      const payload = args[0] as { filePath: string; diffText: string; isStaged: boolean };
      setActiveDiff({
        filePath: payload.filePath,
        diffText: payload.diffText ?? '',
        isStaged: payload.isStaged ?? false,
      });
    }, { label: 'Open Diff View', category: 'View' });
    registerCommand('diff.close', () => { setActiveDiff(null); }, { label: 'Close Diff View', category: 'View' });

    // --- Built-in app commands (delegate to appActionsRef so they always use current state) ---
    registerCommand('file.save',           () => appActionsRef.current.save(),               { label: 'Save File',        category: 'File' });
    registerCommand('view.toggleSidebar',  () => appActionsRef.current.toggleSidebar(),      { label: 'Toggle Sidebar',   category: 'View' });
    registerCommand('file.closeTab',       () => appActionsRef.current.closeTab(),           { label: 'Close Tab',        category: 'File' });
    registerCommand('tab.next',            () => appActionsRef.current.nextTab(),            { label: 'Next Tab',         category: 'View' });
    registerCommand('tab.prev',            () => appActionsRef.current.prevTab(),            { label: 'Previous Tab',     category: 'View' });
    registerCommand('view.search',         () => appActionsRef.current.openSearch(),         { label: 'Search',           category: 'View' });
    registerCommand('view.commandPalette', () => appActionsRef.current.openCommandPalette(), { label: 'Command Palette',  category: 'View' });
    registerCommand('view.quickOpen',      () => appActionsRef.current.openQuickOpen(),      { label: 'Quick Open',       category: 'View' });
    registerCommand('terminal.new',        () => appActionsRef.current.newTerminal(),        { label: 'New Terminal',     category: 'Terminal' });
    registerCommand('terminal.toggle',     () => appActionsRef.current.toggleTerminal(),     { label: 'Toggle Terminal',  category: 'Terminal' });
    registerCommand('terminal.send',       () => appActionsRef.current.sendToTerminal(),     { label: 'Send to Terminal', category: 'Terminal' });
    registerCommand('terminal.claude',     () => appActionsRef.current.sendToClaude(),       { label: 'Send to Claude',   category: 'Terminal' });
    registerCommand('file.reloadFromDisk', () => appActionsRef.current.reloadFromDisk(),    { label: 'Reload from Disk', category: 'File' });
    registerCommand('editor.find',         () => appActionsRef.current.find(),               { label: 'Find',             category: 'Editor' });
    registerCommand('view.splitRight',     () => appActionsRef.current.splitRight(),         { label: 'Split editor right', category: 'View' });

    // --- Workspace switcher commands (relocated from the deleted MenuBar) ---
    // These three actions used to live in the File menu's submenu; after the
    // Phase 1 layout overhaul they are reachable only via the command palette
    // (until Phase 2 introduces the proper workspace switcher dropdown).
    registerCommand('workspace.openFolder', () => appActionsRef.current.openFolder(), { label: 'Workspace: Open Folder…', category: 'Workspace' });
    registerCommand('workspace.openRecent', () => appActionsRef.current.openFolder(), { label: 'Workspace: Open Recent…',  category: 'Workspace' });
    registerCommand('workspace.newWindow',  () => appActionsRef.current.newWindow(),  { label: 'Workspace: New Window',    category: 'Workspace' });

    // --- Built-in keybindings (registered before plugins so they always win conflicts) ---
    builtinKeybindings.forEach(registerKeybinding);

    // --- Load installed plugins ---
    const api = createPluginApi({
      register: registerExtension,
      registerPanel,
      registerCommand,
      executeCommand,
      services: {
        fileSystem: fs,
        gitService: gitServiceInstance,
        kernelService: kernelServiceInstance,
        terminalService: terminalServiceInstance,
      } as unknown as PluginApi['services'],
    });

    pluginLoader.loadAll(api, { registerKeybinding }).then((result) => {
      if (result.firstRun) setShowWizard(true);
      result.errors.forEach((err) => {
        showToast(`Plugin "${err.id}" failed to load: ${err.reason}`, 'warning');
      });
      setPluginRevision(r => r + 1);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sidePanelRef = usePanelRef();
  const terminalPanelRef = usePanelRef();
  // Reactive mirror of sidePanelRef.current?.isCollapsed() so other parts
  // of the layout can react to the sidebar being hidden.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  // Last non-zero sidebar width seen via `onResize`. Used as the WAAPI
  // target when expanding so the animation interpolates 0 → the size
  // react-resizable-panels actually restores to — without this we
  // hard-coded 298 and visibly snapped at animation-end to whatever
  // size the user had previously dragged the panel to.
  const lastSidebarWidthRef = React.useRef<number>(298);
  // Root element of the sidebar Panel (react-resizable-panels exposes it via
  // `elementRef`). We temporarily apply `transition: flex …` to it when the
  // user clicks the logo so the collapse/expand animates; the transition is
  // cleared immediately after so drag-resize stays instant.
  const sidebarPanelEl = React.useRef<HTMLDivElement | null>(null);

  // Track window width so the editor-area side padding can be responsive.
  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Symmetric side padding around the editor area when the sidebar is
  // collapsed — gives single-tab views a "centered document" feel and
  // multi-tab views a smaller rail-width inset. Skipped on narrow windows
  // so we never crush the editor below a usable width.
  const editorPad = (() => {
    if (!isSidebarCollapsed) return 0;
    const SIDEBAR_W = 298;
    const RAIL_W = 48;
    const MIN_EDITOR = 400;
    const target = openTabs.length <= 1 ? SIDEBAR_W : RAIL_W;
    if (windowWidth < target * 2 + MIN_EDITOR) return 0;
    return target;
  })();

  // Start the terminal panel collapsed — users open it explicitly via the
  // activity bar / keyboard shortcut when they need it.
  React.useEffect(() => {
    // Defer one frame so react-resizable-panels has finished mounting.
    const timer = window.setTimeout(() => {
      terminalPanelRef.current?.collapse();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePanelToggle = useCallback((panelId: string) => {
    const isCollapsed = sidePanelRef.current?.isCollapsed();
    if (isCollapsed) {
      setActivePanel(panelId);
      sidePanelRef.current?.expand();
    } else if (activePanel === panelId) {
      setActivePanel(null);
      sidePanelRef.current?.collapse();
    } else {
      setActivePanel(panelId);
    }
  }, [activePanel, sidePanelRef]);

  const handleToggleSidebar = useCallback(() => {
    // Animate the sidebar Panel's width with the Web Animations API
    // instead of a CSS transition. react-resizable-panels writes the new
    // `flex-grow` (alongside `flex-basis:0`) via React reconciliation in
    // a single tick, and CSS transitions on `flex-grow` are skipped by
    // every engine — the panel snaps. WAAPI animates the rendered width
    // directly, with the same ease curve as the editor-pad transition
    // so they track frame-for-frame.
    //
    // CRITICAL ORDERING: both branches pre-pin the element to its
    // animation *start* width via inline `style` BEFORE calling
    // `collapse()` / `expand()`. Otherwise React commits the library's
    // new flex-grow first, the browser paints the panel at its final
    // size for one frame, then WAAPI applies its first keyframe and
    // snaps back — producing the "wiggle then jump to max" the user
    // reported. With the inline pre-pin in place, the layout reflows
    // into a 0-pinned panel and WAAPI's interpolation is the only thing
    // the user ever sees.
    const el = sidebarPanelEl.current;
    const isCollapsed = sidePanelRef.current?.isCollapsed();
    const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
    const DURATION = 200;

    const clearInlineWidth = () => {
      if (!el) return;
      el.style.width = '';
      el.style.minWidth = '';
      el.style.flexGrow = '';
    };

    if (el && !isCollapsed) {
      // About to collapse. Snapshot current width, pre-pin to it
      // inline, then drive WAAPI from that width down to 0.
      const startWidth = el.getBoundingClientRect().width;
      el.style.width = `${startWidth}px`;
      el.style.minWidth = `${startWidth}px`;
      el.style.flexGrow = '0';
      setIsSidebarCollapsed(true);
      sidePanelRef.current?.collapse();
      setActivePanel(null);
      if (startWidth > 0) {
        const anim = el.animate(
          [{ width: `${startWidth}px`, minWidth: `${startWidth}px`, flexGrow: '0' },
           { width: '0px', minWidth: '0px', flexGrow: '0' }],
          { duration: DURATION, easing: EASING, fill: 'forwards' },
        );
        anim.onfinish = () => {
          clearInlineWidth();
          anim.cancel();
        };
      } else {
        clearInlineWidth();
      }
      return;
    }

    if (el && isCollapsed) {
      // About to expand. Pre-pin width to 0 inline so when `expand()`
      // reflows the layout to the restored flex-grow, the panel still
      // renders at 0 px. WAAPI then interpolates 0 → last-seen width.
      const targetWidth = lastSidebarWidthRef.current;
      el.style.width = '0px';
      el.style.minWidth = '0px';
      el.style.flexGrow = '0';
      setIsSidebarCollapsed(false);
      sidePanelRef.current?.expand();
      setActivePanel(prev => prev || 'explorer');
      const anim = el.animate(
        [{ width: '0px', minWidth: '0px', flexGrow: '0' },
         { width: `${targetWidth}px`, minWidth: `${targetWidth}px`, flexGrow: '0' }],
        { duration: DURATION, easing: EASING, fill: 'forwards' },
      );
      anim.onfinish = () => {
        clearInlineWidth();
        anim.cancel();
      };
      return;
    }

    // No element yet (first render); just flip state.
    if (isCollapsed) {
      setIsSidebarCollapsed(false);
      sidePanelRef.current?.expand();
      setActivePanel(prev => prev || 'explorer');
    } else {
      setIsSidebarCollapsed(true);
      sidePanelRef.current?.collapse();
      setActivePanel(null);
    }
  }, [sidePanelRef]);

  const handleToggleTerminal = useCallback(() => {
    if (terminalPanelRef.current?.isCollapsed()) {
      terminalPanelRef.current.expand();
    } else {
      terminalPanelRef.current?.collapse();
    }
  }, [terminalPanelRef]);

  const toggleTheme = useCallback(() => {
    const root = document.documentElement;
    const current = localStorage.getItem('quipu-theme') || 'light';
    const cycle: Record<string, string> = { light: 'tinted', tinted: 'dark', dark: 'light' };
    const next = cycle[current] || 'light';
    root.classList.remove('dark', 'tinted');
    if (next !== 'light') root.classList.add(next);
    localStorage.setItem('quipu-theme', next);
  }, []);

  const handleSendToTerminal = useCallback(async () => {
    if (!activeFile || !workspacePath) {
      showToast('No file open to send to Claude', 'warning');
      return;
    }

    // Auto-save if dirty
    if (editorInstance && activeTab?.isDirty) {
      await saveFile(editorInstance);
    }

    // Ensure .claude skills/commands are installed in the workspace
    try {
      await claudeInstaller.installFrameSkills(workspacePath);
    } catch {
      // Non-blocking — proceed even if install fails
    }

    // Expand terminal if collapsed
    if (terminalPanelRef.current?.isCollapsed()) {
      terminalPanelRef.current.expand();
    }

    const relativePath = activeFile.path.replace(workspacePath + '/', '');
    const command = `/frame ${relativePath}`;

    focusTerminal();

    if (isClaudeRunning) {
      sendToTerminal(command + "\n");
    } else {
      sendToTerminal("claude\n");
      if (activeTerminalId) setTerminalClaudeRunning(activeTerminalId, true);
      setTimeout(() => {
        sendToTerminal(command + "\n");
      }, 2000);
    }
  }, [activeFile, workspacePath, editorInstance, activeTab, saveFile, terminalPanelRef, isClaudeRunning, activeTerminalId, setTerminalClaudeRunning, showToast, focusTerminal, sendToTerminal]);

  const handleSendToClaude = useCallback(async () => {
    if (!activeFile || !workspacePath) {
      showToast('No file open to send to Claude', 'warning');
      return;
    }

    // Auto-save if dirty
    if (editorInstance && activeTab?.isDirty) {
      await saveFile(editorInstance);
    }

    // Expand terminal if collapsed
    if (terminalPanelRef.current?.isCollapsed()) {
      terminalPanelRef.current.expand();
    }

    // Build prompt referencing FRAME skill, file path, and FRAME path
    const relativePath = activeFile.path.replace(workspacePath + '/', '');
    const framePath = `.quipu/meta/${relativePath}.frame.json`;
    let prompt = `Use the /frame skill. Read the file at ${relativePath} and its FRAME at ${framePath}. Review the code and address any annotations.`;

    // Append brief context if FRAME exists
    try {
      const frame = await frameService.readFrame(workspacePath, activeFile.path);
      if (frame) {
        if (frame.annotations?.length > 0) {
          prompt += ` There are ${frame.annotations.length} annotation(s) to address.`;
        }
        if (frame.instructions) {
          prompt += ` Context: ${frame.instructions}`;
        }
      }
    } catch {
      // FRAME read failed — proceed without it
    }

    focusTerminal();

    if (isClaudeRunning) {
      sendToTerminal(prompt + "\n");
    } else {
      sendToTerminal("claude\n");
      if (activeTerminalId) setTerminalClaudeRunning(activeTerminalId, true);
      setTimeout(() => {
        sendToTerminal(prompt + "\n");
      }, 2000);
    }
  }, [activeFile, workspacePath, editorInstance, activeTab, saveFile, terminalPanelRef, isClaudeRunning, activeTerminalId, setTerminalClaudeRunning, showToast, focusTerminal, sendToTerminal]);

  // Single ref holding all app actions that keyboard commands need.
  // Updated synchronously on every render so command handlers always see the
  // latest state without stale-closure issues.
  const appActionsRef = React.useRef<{
    save: () => void;
    toggleSidebar: () => void;
    closeTab: () => void;
    nextTab: () => void;
    prevTab: () => void;
    openSearch: () => void;
    openCommandPalette: () => void;
    openQuickOpen: () => void;
    newTerminal: () => void;
    toggleTerminal: () => void;
    sendToTerminal: () => Promise<void>;
    sendToClaude: () => Promise<void>;
    reloadFromDisk: () => void;
    find: () => void;
    splitRight: () => void;
    openFolder: () => void;
    newWindow: () => void;
  }>(null!);
  appActionsRef.current = {
    save: () => {
      if (activeFile && activeTab) {
        const ext = getExtensionForTab(activeTab);
        // Read from the per-pane registry rather than `editorInstance` state
        // so a save fired in the brief window between activePaneId change and
        // the new pane's Editor reporting via onEditorReady targets the right
        // editor (or no editor) rather than the previous one.
        const activeEditor = editorInstancesRef.current[activePaneId] ?? editorInstance;
        saveFile((ext !== null || editorRawMode) ? null : activeEditor);
      }
    },
    toggleSidebar: handleToggleSidebar,
    closeTab: () => { if (activeTabId) closeTab(activeTabId); },
    nextTab: () => {
      if (openTabs.length > 1) {
        const idx = openTabs.findIndex(t => t.id === activeTabId);
        switchTab(openTabs[(idx + 1) % openTabs.length].id);
      }
    },
    prevTab: () => {
      if (openTabs.length > 1) {
        const idx = openTabs.findIndex(t => t.id === activeTabId);
        switchTab(openTabs[(idx - 1 + openTabs.length) % openTabs.length].id);
      }
    },
    openSearch: () => {
      setActivePanel('search');
      if (sidePanelRef.current?.isCollapsed()) sidePanelRef.current?.expand();
    },
    openCommandPalette: () => { setQuickOpenInitialValue('> '); setIsQuickOpenVisible(true); },
    openQuickOpen: () => { setQuickOpenInitialValue(''); setIsQuickOpenVisible(prev => !prev); },
    newTerminal: () => {
      createTerminalTab();
      if (terminalPanelRef.current?.isCollapsed()) terminalPanelRef.current.expand();
    },
    toggleTerminal: handleToggleTerminal,
    sendToTerminal: handleSendToTerminal,
    sendToClaude: handleSendToClaude,
    reloadFromDisk: () => { if (activeTabId) reloadTabFromDisk(activeTabId); },
    find: () => { getActivePaneToggleFind()?.(); },
    splitRight: () => {
      // Split the active pane's active tab off into a new secondary pane.
      // Surface a toast for the gated cases so Cmd+\\ doesn't silently no-op.
      if (!activeTabId) {
        showToast('Open a file before splitting', 'info');
        return;
      }
      if (secondary !== null) {
        showToast('Editor is already split', 'info');
        return;
      }
      if (primary.tabIds.length < 2) {
        showToast('Open another file first to split', 'info');
        return;
      }
      splitToRight(activeTabId);
    },
    openFolder: () => { openFolder(); },
    newWindow: () => {
      // Spawn an additional Quipu window in the same Electron process.
      // Browser mode silently no-ops because there's no host-side window
      // factory (and the tab/window distinction doesn't apply there).
      if (window.electronAPI?.openNewWindow) {
        window.electronAPI.openNewWindow().catch(() => {});
      }
    },
  };

  // Keyboard shortcuts — all shortcuts are driven by the keybinding registry.
  // Built-in keybindings are registered in the startup effect above; plugins add
  // their own after loadAll(). resolveKeybinding() calls e.preventDefault() and
  // executeCommand() for any match, so no hardcoded checks belong here.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { resolveKeybinding(e); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // --- Global Context Menu ---
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // If a local React handler already claimed this event (e.g. the
      // FileExplorer's empty-area menu or a file-tree item), don't open
      // the global fallback menu on top of it.
      if (e.defaultPrevented) return;
      e.preventDefault();

      // If the right-click originated inside the FileExplorer's own context menu
      // items or its inline rename/create inputs, let its local handler win
      const target = e.target as HTMLElement;
      const fileTreeItem = target.closest('[data-context="file-tree-item"]');
      if (fileTreeItem) return;

      const x = e.clientX;
      const y = e.clientY;
      const items: ContextMenuItem[] = [];

      // --- Detect context by walking up the DOM ---
      const isEditor = !!target.closest('.ProseMirror');
      const isTerminal = !!target.closest('.xterm');
      const isTabBar = !!target.closest('[data-context="tab-bar"]');
      const isExplorer = !!target.closest('[data-context="explorer"]');

      // Check for text selection
      const selection = window.getSelection();
      const hasSelection = selection && selection.toString().trim().length > 0;

      // Check for terminal selection
      const hasTermSel = isTerminal && hasTerminalSelection();

      // --- Copy when text is selected (always first) ---
      if (hasSelection && !isTerminal) {
        const selectedText = selection!.toString();
        items.push({
          label: 'Copy',
          shortcut: 'Ctrl+C',
          onClick: () => {
            navigator.clipboard.writeText(selectedText);
          },
        });
      }

      if (hasTermSel) {
        const terminalText = getTerminalSelection();
        items.push({
          label: 'Copy',
          shortcut: 'Ctrl+Shift+C',
          onClick: () => {
            navigator.clipboard.writeText(terminalText);
          },
        });
      }

      // --- Editor context ---
      if (isEditor && editorInstance) {
        const hasEditorSelection = !editorInstance.state.selection.empty;

        if (hasEditorSelection && items.length === 0) {
          // Selection exists but wasn't caught above (e.g., node selection)
          items.push({
            label: 'Copy',
            shortcut: 'Ctrl+C',
            onClick: () => document.execCommand('copy'),
          });
        }

        if (hasEditorSelection) {
          items.push({
            label: 'Cut',
            shortcut: 'Ctrl+X',
            onClick: () => document.execCommand('cut'),
          });
        }

        items.push({
          label: 'Paste',
          shortcut: 'Ctrl+V',
          onClick: () => {
            navigator.clipboard.readText().then((text) => {
              editorInstance.commands.insertContent(text);
            }).catch(() => {
              document.execCommand('paste');
            });
          },
        });

        items.push({
          label: 'Select All',
          shortcut: 'Ctrl+A',
          onClick: () => editorInstance.commands.selectAll(),
        });

        items.push({ separator: true });

        items.push({
          label: 'Bold',
          shortcut: 'Ctrl+B',
          onClick: () => editorInstance.chain().focus().toggleBold().run(),
        });
        items.push({
          label: 'Italic',
          shortcut: 'Ctrl+I',
          onClick: () => editorInstance.chain().focus().toggleItalic().run(),
        });
        items.push({
          label: 'Strikethrough',
          onClick: () => editorInstance.chain().focus().toggleStrike().run(),
        });

        // Table context items (if cursor is inside a table)
        if (editorInstance.isActive('table')) {
          items.push({ separator: true });
          items.push({
            label: 'Add Row Below',
            onClick: () => editorInstance.chain().focus().addRowAfter().run(),
          });
          items.push({
            label: 'Add Column After',
            onClick: () => editorInstance.chain().focus().addColumnAfter().run(),
          });
          items.push({
            label: 'Delete Row',
            onClick: () => editorInstance.chain().focus().deleteRow().run(),
            danger: true,
          });
          items.push({
            label: 'Delete Column',
            onClick: () => editorInstance.chain().focus().deleteColumn().run(),
            danger: true,
          });
        }
      }

      // --- Terminal context ---
      else if (isTerminal) {
        if (!hasTermSel) {
          // No selection — still offer paste
        }

        items.push({
          label: 'Paste',
          shortcut: 'Ctrl+Shift+V',
          onClick: () => {
            navigator.clipboard.readText().then((text) => {
              if (window.electronAPI) {
                (window.electronAPI as unknown as { writeTerminal: (data: string) => void }).writeTerminal(text);
              } else {
                pasteToTerminal(text);
              }
            }).catch(() => {});
          },
        });

        items.push({ separator: true });

        items.push({
          label: 'Clear Terminal',
          onClick: () => {
            clearTerminal();
          },
        });
      }

      // --- Tab bar context ---
      else if (isTabBar) {
        const tabEl = target.closest('[data-tab-id]') as HTMLElement | null;
        const tabId = tabEl?.dataset.tabId;

        if (tabId) {
          items.push({
            label: 'Close Tab',
            shortcut: 'Ctrl+W',
            onClick: () => closeTab(tabId),
          });
          items.push({
            label: 'Close Other Tabs',
            onClick: () => {
              openTabs.forEach((tab) => {
                if (tab.id !== tabId) closeTab(tab.id);
              });
            },
          });
          items.push({
            label: 'Close All Tabs',
            onClick: () => {
              openTabs.forEach((tab) => closeTab(tab.id));
            },
            danger: true,
          });
          // Split-right is offered only when the editor area is single-pane
          // and the source pane has at least 2 tabs (otherwise splitToRight
          // is a no-op — surfacing it in the menu would be confusing).
          if (secondary === null && primary.tabIds.length >= 2 && primary.tabIds.includes(tabId)) {
            items.push({ separator: true });
            items.push({
              label: 'Split editor right',
              shortcut: 'Ctrl+\\',
              onClick: () => splitToRight(tabId),
            });
          }
        }
      }

      // --- File Explorer context (fallback — tree items handle their own) ---
      else if (isExplorer) {
        // General explorer area right-click — nothing specific to offer
        // beyond paste if clipboard has content
      }

      // --- General / empty area fallback ---
      if (items.length === 0) {
        items.push({
          label: 'Paste',
          shortcut: 'Ctrl+V',
          onClick: () => {
            navigator.clipboard.readText().then((text) => {
              if (editorInstance) {
                editorInstance.commands.insertContent(text);
              }
            }).catch(() => {});
          },
        });
      }

      setContextMenu({ x, y, items });
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [editorInstance, closeTab, openTabs]);

  // Editor instance + content-change handlers now live in PaneView (per pane).
  // App tracks the active pane's editor via handlePaneEditorReady (above) and
  // the activePaneId-sync effect.

  const handleMenuAction = useCallback((action: string) => {
    switch (action) {
      case 'file.save':
        if (activeFile && activeTab) {
          const ext = getExtensionForTab(activeTab);
          const isNonTipTap = ext !== null || editorRawMode;
          saveFile(isNonTipTap ? null : editorInstance);
        }
        break;
      case 'file.closeTab':
        if (activeTabId) closeTab(activeTabId);
        break;
      case 'file.openFolder':
        openFolder();
        break;
      case 'file.newWindow':
        // Spawn an additional Quipu window in the same Electron process.
        // Browser mode silently no-ops because there's no host-side window
        // factory (and the tab/window distinction doesn't apply there).
        if (window.electronAPI?.openNewWindow) {
          window.electronAPI.openNewWindow().catch(() => {});
        }
        break;
      case 'edit.undo':
        editorInstance?.commands.undo();
        break;
      case 'edit.redo':
        editorInstance?.commands.redo();
        break;
      case 'edit.findInFiles':
      case 'view.search':
        setActivePanel('search');
        if (sidePanelRef.current?.isCollapsed()) sidePanelRef.current?.expand();
        break;
      case 'view.explorer':
        handlePanelToggle('explorer');
        break;
      case 'view.git':
        handlePanelToggle('git');
        break;
      case 'view.toggleSidebar':
        handleToggleSidebar();
        break;
      case 'view.toggleTerminal':
      case 'terminal.toggle':
        handleToggleTerminal();
        break;
      case 'terminal.new':
        createTerminalTab();
        if (terminalPanelRef.current?.isCollapsed()) terminalPanelRef.current.expand();
        break;
      case 'view.quickOpen':
        setQuickOpenInitialValue('');
        setIsQuickOpenVisible(true);
        break;
      case 'view.commandPalette':
        setQuickOpenInitialValue('> ');
        setIsQuickOpenVisible(true);
        break;
      case 'edit.cut':
        document.execCommand('cut');
        break;
      case 'edit.copy':
        document.execCommand('copy');
        break;
      case 'edit.paste':
        document.execCommand('paste');
        break;
      case 'theme.toggle':
        toggleTheme();
        break;
      case 'terminal.send':
        handleSendToTerminal();
        break;
      case 'terminal.claude':
        handleSendToClaude();
        break;
      case 'editor.toggleMode':
        getActivePaneToggleEditorMode()?.();
        break;
      default: {
        // Delegate to extension commands (e.g., kernel.runAll, kernel.interrupt, kernel.restart)
        if (activeTab) {
          const cmds = getCommandsForTab(activeTab);
          const cmd = cmds.find(c => c.id === action);
          if (cmd) cmd.handler();
        }
        break;
      }
    }
  }, [editorInstance, editorRawMode, activeFile, activeTab, saveFile, activeTabId, closeTab, sidePanelRef, terminalPanelRef, handlePanelToggle, handleToggleSidebar, handleToggleTerminal, createTerminalTab, toggleTheme, handleSendToTerminal, handleSendToClaude]);

  // Handle database pick/create events from slash commands and context menus
  useEffect(() => {
    const handlePickDatabase = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const callback = detail?.callback as ((path: string) => void) | undefined;
      if (!callback) return;

      // The OS native dialog is the fallback for files outside the
      // workspace. Inside the workspace we use a cmdk picker — it's
      // faster than navigating to the workspace folder by hand and
      // works identically in Electron and browser.
      const browseOutside = async () => {
        setPickerDialog(null);
        if (!window.electronAPI?.openFileDialog) {
          // Browser mode: no native dialog. Fall back to a path prompt
          // so the user can still type the path manually.
          setInputDialogValue('');
          setInputDialog({
            title: 'Link Database',
            placeholder: 'Path to .quipudb.jsonl file (relative to workspace)',
            defaultValue: '',
            onSubmit: (path: string) => {
              const trimmed = path.trim();
              if (trimmed) callback(trimmed);
            },
          });
          return;
        }
        let filePath: string | null = null;
        try {
          filePath = await fs.openFileDialog({
            filters: [
              { name: 'Quipu Database', extensions: ['quipudb.jsonl', 'jsonl'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          });
        } catch {
          return;
        }
        if (!filePath) return;
        let relativePath = filePath;
        if (workspacePath && filePath.startsWith(workspacePath)) {
          relativePath = filePath.slice(workspacePath.length + 1);
        } else if (workspacePath) {
          showToast('Linked database is outside the workspace', 'warning');
        }
        callback(relativePath);
      };

      if (!workspacePath) {
        // No workspace open — there's nothing to scan; jump straight to
        // the OS dialog / prompt fallback.
        browseOutside();
        return;
      }

      setPickerDialog({
        title: 'Link database',
        placeholder: 'Type a database name to filter…',
        match: (rel) => rel.toLowerCase().endsWith('.quipudb.jsonl'),
        onSelect: (rel: string) => {
          setPickerDialog(null);
          callback(rel);
        },
        onBrowseOutside: browseOutside,
      });
    };

    const handleCreateDatabase = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const callback = detail?.callback as ((path: string) => void) | undefined;
      if (!callback || !activeFile || !workspacePath) return;

      const currentDir = activeFile.path.substring(0, activeFile.path.lastIndexOf('/'));

      setInputDialogValue('untitled');
      setInputDialog({
        title: 'Create Database',
        placeholder: 'Database name',
        defaultValue: 'untitled',
        onSubmit: async (name: string) => {
          if (!name.trim()) return;
          const fileName = `${name.trim()}.quipudb.jsonl`;
          const filePath = `${currentDir}/${fileName}`;

          try {
            const { createEmptyDatabase } = await import('./extensions/database-viewer/utils/jsonl');
            const initialContent = createEmptyDatabase(name.charAt(0).toUpperCase() + name.slice(1));
            await fs.createFile(filePath);
            await fs.writeFile(filePath, initialContent);

            const relativePath = filePath.startsWith(workspacePath!)
              ? filePath.slice(workspacePath!.length + 1)
              : filePath;
            callback(relativePath);
          } catch (err) {
            showToast('Failed to create database: ' + (err as Error).message, 'error');
          }
        },
      });
    };

    const handleOpenEmbeddedDatabase = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const src = detail?.src as string;
      if (!src || !workspacePath) return;
      const fullPath = src.startsWith('/') ? src : `${workspacePath}/${src}`;
      const fileName = src.split('/').pop() || src;
      openFile(fullPath, fileName);
    };

    // --- MDX inline-embed support — mirrors the database picker flow.
    const handlePickMdx = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const callback = detail?.callback as ((path: string) => void) | undefined;
      if (!callback) return;

      const browseOutside = async () => {
        setPickerDialog(null);
        if (!window.electronAPI?.openFileDialog) {
          setInputDialogValue('');
          setInputDialog({
            title: 'Link MDX',
            placeholder: 'Path to .mdx file (relative to workspace)',
            defaultValue: '',
            onSubmit: (path: string) => {
              const trimmed = path.trim();
              if (trimmed) callback(trimmed);
            },
          });
          return;
        }
        let filePath: string | null = null;
        try {
          filePath = await fs.openFileDialog({
            filters: [
              { name: 'MDX', extensions: ['mdx'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          });
        } catch {
          return;
        }
        if (!filePath) return;
        let relativePath = filePath;
        if (workspacePath && filePath.startsWith(workspacePath)) {
          relativePath = filePath.slice(workspacePath.length + 1);
        } else if (workspacePath) {
          showToast('Linked MDX is outside the workspace', 'warning');
        }
        callback(relativePath);
      };

      if (!workspacePath) {
        browseOutside();
        return;
      }

      setPickerDialog({
        title: 'Link MDX',
        placeholder: 'Type an MDX file name to filter…',
        match: (rel) => rel.toLowerCase().endsWith('.mdx'),
        onSelect: (rel: string) => {
          setPickerDialog(null);
          callback(rel);
        },
        onBrowseOutside: browseOutside,
      });
    };

    const handleCreateMdx = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const callback = detail?.callback as ((path: string) => void) | undefined;
      if (!callback || !activeFile || !workspacePath) return;

      const currentDir = activeFile.path.substring(0, activeFile.path.lastIndexOf('/'));

      setInputDialogValue('untitled');
      setInputDialog({
        title: 'Create MDX',
        placeholder: 'MDX file name',
        defaultValue: 'untitled',
        onSubmit: async (name: string) => {
          if (!name.trim()) return;
          const trimmed = name.trim();
          const fileName = trimmed.toLowerCase().endsWith('.mdx') ? trimmed : `${trimmed}.mdx`;
          const filePath = `${currentDir}/${fileName}`;

          try {
            await fs.createFile(filePath);
            await fs.writeFile(filePath, '');
            const relativePath = filePath.startsWith(workspacePath!)
              ? filePath.slice(workspacePath!.length + 1)
              : filePath;
            callback(relativePath);
          } catch (err) {
            showToast('Failed to create MDX: ' + (err as Error).message, 'error');
          }
        },
      });
    };

    const handleOpenEmbeddedMdx = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const src = detail?.src as string;
      if (!src || !workspacePath) return;
      const fullPath = src.startsWith('/') ? src : `${workspacePath}/${src}`;
      const fileName = src.split('/').pop() || src;
      openFile(fullPath, fileName);
    };

    window.addEventListener('quipu:pick-database', handlePickDatabase);
    window.addEventListener('quipu:create-database', handleCreateDatabase);
    window.addEventListener('quipu:open-embedded-database', handleOpenEmbeddedDatabase);
    window.addEventListener('quipu:pick-mdx', handlePickMdx);
    window.addEventListener('quipu:create-mdx', handleCreateMdx);
    window.addEventListener('quipu:open-embedded-mdx', handleOpenEmbeddedMdx);
    return () => {
      window.removeEventListener('quipu:pick-database', handlePickDatabase);
      window.removeEventListener('quipu:create-database', handleCreateDatabase);
      window.removeEventListener('quipu:open-embedded-database', handleOpenEmbeddedDatabase);
      window.removeEventListener('quipu:pick-mdx', handlePickMdx);
      window.removeEventListener('quipu:create-mdx', handleCreateMdx);
      window.removeEventListener('quipu:open-embedded-mdx', handleOpenEmbeddedMdx);
    };
  }, [workspacePath, activeFile, openFile]);

  // Keep the OS-level window title (taskbar / window manager) in sync with the
  // active file. After Phase 1 of the visual overhaul the in-app titlebar no
  // longer renders this text on screen, but Electron still uses document.title
  // for the BrowserWindow title.
  useEffect(() => {
    document.title = buildWindowTitle(activeFile, workspacePath);
  }, [activeFile, workspacePath]);

  return (
    <div className="flex flex-col h-screen w-screen bg-bg-surface relative" data-workspace-path={workspacePath ?? ''}>
      {showWizard && <FirstRunWizard onComplete={() => setShowWizard(false)} />}
      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={closeContextMenu}
        />
      )}
      {showFolderPicker && (
        <FolderPicker onSelect={selectFolder} onCancel={cancelFolderPicker} />
      )}

      {/* Workspace file picker — Link Database / Link MDX flows */}
      {pickerDialog && (
        <WorkspaceFilePicker
          title={pickerDialog.title}
          workspacePath={workspacePath}
          match={pickerDialog.match}
          placeholder={pickerDialog.placeholder}
          onSelect={pickerDialog.onSelect}
          onBrowseOutside={pickerDialog.onBrowseOutside}
          onClose={() => setPickerDialog(null)}
        />
      )}

      {/* Input dialog (replaces window.prompt) */}
      {inputDialog && (
        <Dialog.Root open onOpenChange={(open) => { if (!open) setInputDialog(null); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/35 z-[9998]" />
            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg-elevated border border-border rounded-lg shadow-lg p-5 w-[380px] z-[9999]">
              <Dialog.Title className="text-sm font-medium text-text-primary mb-3">{inputDialog.title}</Dialog.Title>
              <form onSubmit={(e) => {
                e.preventDefault();
                inputDialog.onSubmit(inputDialogValue);
                setInputDialog(null);
              }}>
                <input
                  autoFocus
                  value={inputDialogValue}
                  onChange={(e) => setInputDialogValue(e.target.value)}
                  placeholder={inputDialog.placeholder}
                  className="w-full px-3 py-2 text-sm bg-bg-surface border border-border rounded-md text-text-primary outline-none focus:border-accent mb-3"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setInputDialog(null)} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                  <button type="submit" className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent-hover">OK</button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      <QuickOpen
        isOpen={isQuickOpenVisible}
        onClose={() => { setIsQuickOpenVisible(false); setQuickOpenInitialValue(''); }}
        onAction={handleMenuAction}
        initialValue={quickOpenInitialValue}
      />
      {/*
        Outer container — canvas and the sidebar card share `bg-bg-surface`
        so all surfaces (editor, tab bar, sidebar card, canvas) use the same
        color. The "floating" effect for the sidebar card comes purely from
        its `rounded-lg border shadow-md` — not from background contrast.
      */}
      <div className="flex flex-row flex-1 overflow-hidden min-h-0 bg-bg-surface">
        {/*
          Outer horizontal Group: sidebar Panel hosts a floating card that
          contains both the ActivityBar (icon rail) and the active panel
          (explorer / search / etc.) as one visual unit. Editor Panel is
          flat — no card treatment — and hosts its own slim top strip.
          See docs/plans/2026-05-28-001-feat-visual-overhaul-plan.md (Phase 3).
        */}
        <Group orientation="horizontal" style={{ flex: 1, overflow: 'hidden' }}>
        <Panel
          panelRef={sidePanelRef}
          elementRef={sidebarPanelEl}
          collapsible
          onResize={(size) => {
            setIsSidebarCollapsed(size.inPixels === 0);
            if (size.inPixels > 0) lastSidebarWidthRef.current = size.inPixels;
          }}
          collapsedSize={0}
          minSize={248}
          maxSize={448}
          defaultSize={298}
        >
          {/*
            Floating-card wrapper. `m-2` creates the gap between the card and
            the window edges; `rounded-lg`, `border`, and `shadow-md` give the
            lift. `overflow-hidden` clips the inner ActivityBar + panel
            content to the rounded corners.
          */}
          <div className="h-[calc(100%-1rem)] mt-3 mb-0 mx-2 rounded-lg border border-border bg-sidebar shadow-md overflow-hidden flex flex-row" data-context="explorer">
            <ActivityBar activePanel={activePanel} onPanelToggle={handlePanelToggle} />
            <div className="flex-1 overflow-hidden flex flex-col relative z-10">
              {(() => {
                if (!activePanel) return null;
                const panel = getRegisteredPanels().find((p) => p.id === activePanel);
                if (!panel) return null;
                // Extra props for built-in panels that require them; plugin panels receive nothing.
                const panelPropsMap: Record<string, Record<string, unknown>> = {
                  search: { activePanel },
                };
                const PanelComp = panel.component as React.ComponentType<Record<string, unknown>>;
                return <PanelComp {...(panelPropsMap[activePanel] ?? {})} />;
              })()}
            </div>
          </div>
        </Panel>
        {/*
          Sidebar / editor resize handle. Visually transparent — the card's
          own shadow + the canvas gap provide the visual separation. The
          handle is still draggable (cursor + width) and `no-drag` so the
          OS doesn't treat the click as a window drag. The `::before`
          pseudo-element extends the hit area 8px LEFT to cover the
          sidebar card's `mx-2` right margin, so the col-resize cursor
          appears the moment the user crosses the visible card border
          instead of 8px past it.
        */}
        <Separator className="shrink-0 w-1 cursor-col-resize bg-transparent relative before:absolute before:inset-y-0 before:-left-2 before:w-2 before:content-['']" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
        <Panel>
          <div className="h-full flex flex-col overflow-hidden">
          <TitleBar />
          <Group orientation="vertical" style={{ flex: 1, overflow: 'hidden' }}>
            <Panel minSize={100}>
              {/* Editor-area side padding. Symmetric inset that varies
                  with sidebar visibility + tab count (see `editorPad`
                  above). Animated so the change reads as a smooth
                  margin growing in / out. */}
              <div
                className="h-full transition-[padding] duration-200 ease-in-out"
                style={{ paddingInline: `${editorPad}px` }}
              >
              {activeDiff ? (
                <div className="h-full flex flex-col overflow-hidden relative">
                  <DiffViewer
                    filePath={activeDiff.filePath}
                    diffText={activeDiff.diffText}
                    isStaged={activeDiff.isStaged}
                    onClose={() => setActiveDiff(null)}
                  />
                </div>
              ) : (
                <DndContext
                  sensors={tabDragSensors}
                  collisionDetection={pointerWithin}
                  onDragStart={handleTabDragStart}
                  onDragEnd={handleTabDragEnd}
                  onDragCancel={handleTabDragCancel}
                >
                  <Group orientation="horizontal" style={{ height: '100%' }}>
                    <Panel minSize={20}>
                      <PaneView
                        pane={primary}
                        onEditorReady={handlePaneEditorReady}
                        registerPaneRefs={registerPaneRefs}
                        onRawModeChange={setEditorRawMode}
                        showSplitDropZone={secondary === null}
                        isDragActive={isTabDragActive}
                      />
                    </Panel>
                    {secondary !== null && (
                      <>
                        <Separator className="shrink-0 w-1 cursor-col-resize bg-transparent" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
                        <Panel minSize={20}>
                          <PaneView
                            pane={secondary}
                            onEditorReady={handlePaneEditorReady}
                            registerPaneRefs={registerPaneRefs}
                            onRawModeChange={setEditorRawMode}
                          />
                        </Panel>
                      </>
                    )}
                  </Group>
                  {/*
                    DragOverlay renders the dragged tab visual in a portal at
                    document.body level so it follows the cursor freely instead
                    of being clipped by the tab bar's overflow. Without this,
                    dragging a tab "down" into the editor area shows no
                    feedback because the original tab's transform stays inside
                    the bar's overflow box.
                  */}
                  <DragOverlay dropAnimation={null}>
                    {draggedTabId ? (() => {
                      const t = openTabs.find(tab => tab.id === draggedTabId);
                      if (!t) return null;
                      return (
                        <div
                          className="flex items-center gap-1.5 h-[35px] px-4 bg-page-bg border border-border rounded shadow-lg text-[13px] text-text-primary opacity-95 cursor-grabbing"
                          style={{ pointerEvents: 'none' }}
                        >
                          <span className="overflow-hidden text-ellipsis max-w-[180px] font-sans whitespace-nowrap">
                            {t.name}
                          </span>
                        </div>
                      );
                    })() : null}
                  </DragOverlay>
                </DndContext>
              )}
              </div>
            </Panel>
            <Separator className="shrink-0 h-1 cursor-row-resize bg-transparent transition-colors hover:bg-accent/50 active:bg-accent" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
            <Panel
              panelRef={terminalPanelRef}
              collapsible
              collapsedSize={0}
              minSize={100}
              defaultSize={300}
            >
              {/* Floating terminal card. Margins picked to match the
                  sidebar card visually:
                  - `mb-1` (4px) so the bottom gap to the status bar
                    matches the sidebar's effective 4px bottom gap.
                  - `mr-2` (8px) for the right window-edge gap; no left
                    margin because the sidebar / its `mx-2` already
                    provides that gap on the editor column's left edge.
                  - `h-[calc(100%-0.25rem)]` reserves space for `mb-1`.
                  - `rounded-lg overflow-hidden` clips Terminal's
                    own `rounded-t-md` so all four corners curve. */}
              <div className="h-[calc(100%-0.25rem)] mr-2 mb-1 rounded-lg border border-border bg-bg-surface shadow-md overflow-hidden">
                <Terminal workspacePath={workspacePath} />
              </div>
            </Panel>
          </Group>
          </div>
        </Panel>
      </Group>
      </div>
      {/*
        Status bar sits BELOW the sidebar in normal vertical flow, so the
        sidebar card's rounded bottom corners are visible above it. The
        status bar uses the same `bg-bg-surface` token as the rest of the
        shell so it reads as one continuous canvas.
      */}
      <StatusBar />
      {/* Quipu brand logo — always-present sidebar-toggle. Rendered LAST so its
          `WebkitAppRegion: 'no-drag'` subtracts from the drag regions declared
          by earlier nodes (ActivityBar spacer, TitleBar) — Electron resolves
          draggable regions in document order, so a no-drag must follow the
          drag regions it should override. Coordinates match the activity-rail's
          logo slot when the sidebar is shown (sidebar mx-2 + my-3 offsets +
          rail w-12 h-9 center → 22, 20). */}
      <button
        type="button"
        onClick={handleToggleSidebar}
        aria-label={isSidebarCollapsed ? 'Restore sidebar' : 'Collapse sidebar'}
        title={isSidebarCollapsed ? 'Restore sidebar' : 'Collapse sidebar'}
        className="absolute w-5 h-5 flex items-center justify-center bg-transparent border-none cursor-pointer z-[1000]"
        style={{ left: '22px', top: '20px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <img
          src={new URL('./assets/quipu-icon.png', import.meta.url).href}
          alt="Quipu"
          className="w-5 h-5 select-none pointer-events-none"
          draggable={false}
        />
      </button>
    </div>
  );
}

function App() {
  return (
    <IconContext.Provider value={{ color: "currentColor", weight: "regular", size: 16 }}>
      <ToastProvider>
        <WorkspaceProvider>
          <AppContent />
        </WorkspaceProvider>
      </ToastProvider>
    </IconContext.Provider>
  );
}

export default App;
