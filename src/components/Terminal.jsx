import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
  useCallback,
} from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { PlusIcon, XIcon, MagnifyingGlassIcon, ArrowUpIcon, ArrowDownIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "./Toast";
import terminalService, { isElectron } from "../services/terminalService";
import { WS_URL } from "../config.js";
import "@xterm/xterm/css/xterm.css";

const XTERM_THEME = {
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#ffffff",
  selectionBackground: "#264f78",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

const Terminal = forwardRef(({ workspacePath }, ref) => {
  const {
    terminalTabs,
    activeTerminalId,
    createTerminalTab,
    closeTerminalTab,
    switchTerminalTab,
  } = useWorkspace();
  const { showToast } = useToast();

  // Map of terminalId -> { xterm, fitAddon, searchAddon, ws (browser only), containerEl }
  const instancesRef = useRef(new Map());
  // Ref to the Electron IPC data handler (so we can remove it on cleanup)
  const electronHandlerRef = useRef(null);
  // Search overlay state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef(null);
  // Ref to track the outer container for ResizeObserver
  const outerContainerRef = useRef(null);

  // Helper: write data to a terminal instance's backend
  const writeToInstance = useCallback((instance, data) => {
    if (isElectron() && instance.backendId) {
      terminalService.write(instance.backendId, data);
    } else if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
      instance.ws.send(data);
    }
  }, []);

  // Expose imperative API for parent components (write to active terminal, focus)
  useImperativeHandle(ref, () => ({
    write: (data) => {
      if (!activeTerminalId) return;
      const instance = instancesRef.current.get(activeTerminalId);
      if (!instance) return;
      writeToInstance(instance, data);
    },
    focus: () => {
      if (!activeTerminalId) return;
      const instance = instancesRef.current.get(activeTerminalId);
      if (instance) instance.xterm.focus();
    },
    hasSelection: () => {
      if (!activeTerminalId) return false;
      const instance = instancesRef.current.get(activeTerminalId);
      return instance?.xterm?.hasSelection() ?? false;
    },
    getSelection: () => {
      if (!activeTerminalId) return '';
      const instance = instancesRef.current.get(activeTerminalId);
      return instance?.xterm?.getSelection() ?? '';
    },
    paste: (text) => {
      if (!activeTerminalId) return;
      const instance = instancesRef.current.get(activeTerminalId);
      if (!instance) return;
      writeToInstance(instance, text);
    },
  }));

  // Create a new xterm instance for a terminal tab
  const createXtermInstance = useCallback((tabId) => {
    const term = new XTerm({
      fontFamily: '"MesloLGS NF", "JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      theme: XTERM_THEME,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    return { xterm: term, fitAddon, searchAddon, ws: null, containerEl: null };
  }, []);

  // Connect a terminal instance to its backend (Electron IPC or WebSocket)
  const connectTerminal = useCallback(async (tabId, instance) => {
    const { xterm } = instance;

    if (isElectron()) {
      // Electron: create pty via service, data comes through shared IPC channel
      try {
        const result = await terminalService.create(workspacePath);
        // Store the backend terminalId — it may differ from the tab ID in Electron
        // Actually, we use the returned terminalId as the key in our instances map
        // But the tab ID in context is what we use for the UI. Let's store a mapping.
        instance.backendId = result.terminalId;

        xterm.onData((data) => {
          terminalService.write(result.terminalId, data);
        });

        // Initial resize
        terminalService.resize(result.terminalId, xterm.cols, xterm.rows);
      } catch (err) {
        showToast('Failed to create terminal: ' + err.message, 'error');
      }
    } else {
      // Browser: each terminal gets its own WebSocket with reconnection
      const wsUrl = workspacePath
        ? `${WS_URL}/term?cwd=${encodeURIComponent(workspacePath)}`
        : `${WS_URL}/term`;

      const MAX_RETRIES = 5;
      const RETRY_DELAY = 3000;
      let retryCount = 0;
      let intentionalClose = false;
      let dataHandler = null;

      const connect = () => {
        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        instance.ws = ws;

        ws.onopen = () => {
          retryCount = 0;
          if (retryCount === 0) {
            xterm.writeln("\x1b[32mConnected to terminal server\x1b[0m");
          } else {
            xterm.writeln("\x1b[32mReconnected to terminal server\x1b[0m");
          }
          ws.send(JSON.stringify({ cols: xterm.cols, rows: xterm.rows }));
        };

        ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            xterm.write(new Uint8Array(event.data));
          } else {
            xterm.write(event.data);
          }
        };

        ws.onclose = () => {
          if (intentionalClose) return;
          if (retryCount < MAX_RETRIES) {
            retryCount++;
            xterm.writeln(`\r\n\x1b[33mDisconnected. Reconnecting (${retryCount}/${MAX_RETRIES})...\x1b[0m`);
            instance.reconnectTimer = setTimeout(connect, RETRY_DELAY);
          } else {
            xterm.writeln("\r\n\x1b[31mDisconnected from terminal server. Max retries reached.\x1b[0m");
            xterm.writeln(`\x1b[2mServer URL: ${wsUrl}\x1b[0m`);
          }
        };

        ws.onerror = () => {
          // onclose will fire after onerror, so reconnection is handled there
        };

        // Remove previous data handler if reconnecting
        if (dataHandler) dataHandler.dispose();
        dataHandler = xterm.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });
      };

      // Method to stop reconnection attempts on intentional close
      instance.stopReconnect = () => {
        intentionalClose = true;
        if (instance.reconnectTimer) {
          clearTimeout(instance.reconnectTimer);
          instance.reconnectTimer = null;
        }
      };

      connect();
    }
  }, [workspacePath, showToast]);

  // Set up Electron IPC data listener (shared across all terminals)
  useEffect(() => {
    if (!isElectron()) return;

    const handler = terminalService.onData(({ terminalId, data }) => {
      // Route data to the correct xterm instance by matching backendId
      for (const [, instance] of instancesRef.current) {
        if (instance.backendId === terminalId) {
          instance.xterm.write(data);
          break;
        }
      }
    });
    electronHandlerRef.current = handler;

    return () => {
      if (handler) {
        terminalService.removeDataListener(handler);
        electronHandlerRef.current = null;
      }
    };
  }, []);

  // Auto-create first terminal when workspace loads and no terminals exist
  useEffect(() => {
    if (workspacePath && terminalTabs.length === 0) {
      createTerminalTab();
    }
  }, [workspacePath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle terminal tab creation: create xterm instance and connect
  useEffect(() => {
    for (const tab of terminalTabs) {
      if (!instancesRef.current.has(tab.id)) {
        const instance = createXtermInstance(tab.id);
        instancesRef.current.set(tab.id, instance);
        // Connect will happen once the container div is mounted (see below)
      }
    }

    // Clean up removed tabs
    for (const [tabId, instance] of instancesRef.current) {
      if (!terminalTabs.find(t => t.id === tabId)) {
        // Kill backend
        if (isElectron() && instance.backendId) {
          terminalService.kill(instance.backendId);
        } else {
          if (instance.stopReconnect) instance.stopReconnect();
          if (instance.ws) instance.ws.close();
        }
        instance.xterm.dispose();
        instancesRef.current.delete(tabId);
      }
    }
  }, [terminalTabs, createXtermInstance]);

  // Mount/unmount xterm into the active tab's container div
  useEffect(() => {
    if (!activeTerminalId) return;

    const instance = instancesRef.current.get(activeTerminalId);
    if (!instance) return;

    // Find the container div for the active terminal
    const containerEl = document.getElementById(`terminal-container-${activeTerminalId}`);
    if (!containerEl) return;

    // If already opened in this container, just fit
    if (instance.containerEl === containerEl) {
      document.fonts.ready.then(() => {
        instance.fitAddon.fit();
      });
      return;
    }

    // If xterm was opened in a different container, we need to re-open
    // xterm.js doesn't support moving - we need to check if element was opened
    if (instance.containerEl) {
      // Already opened somewhere - clear and re-open
      containerEl.innerHTML = '';
      instance.xterm.open(containerEl);
    } else {
      // First time opening
      instance.xterm.open(containerEl);
      connectTerminal(activeTerminalId, instance);
    }

    instance.containerEl = containerEl;

    document.fonts.ready.then(() => {
      instance.fitAddon.fit();
    });
  }, [activeTerminalId, terminalTabs, connectTerminal]);

  // ResizeObserver: only fit the active terminal
  useEffect(() => {
    if (!outerContainerRef.current) return;

    const handleResize = () => {
      if (!activeTerminalId) return;
      const instance = instancesRef.current.get(activeTerminalId);
      if (!instance || !instance.containerEl) return;

      instance.fitAddon.fit();
      const { cols, rows } = instance.xterm;

      if (isElectron() && instance.backendId) {
        terminalService.resize(instance.backendId, cols, rows);
      } else if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
        instance.ws.send(JSON.stringify({ cols, rows }));
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(outerContainerRef.current);
    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [activeTerminalId]);

  // Cleanup all terminals on unmount
  useEffect(() => {
    return () => {
      for (const [, instance] of instancesRef.current) {
        if (isElectron() && instance.backendId) {
          terminalService.kill(instance.backendId);
        } else {
          if (instance.stopReconnect) instance.stopReconnect();
          if (instance.ws) instance.ws.close();
        }
        instance.xterm.dispose();
      }
      instancesRef.current.clear();
    };
  }, []);

  // Search handlers
  const handleSearchOpen = useCallback(() => {
    setIsSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }, []);

  const handleSearchClose = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    // Clear search decorations
    if (activeTerminalId) {
      const instance = instancesRef.current.get(activeTerminalId);
      if (instance) {
        instance.searchAddon.clearDecorations();
        instance.xterm.focus();
      }
    }
  }, [activeTerminalId]);

  const handleSearchNext = useCallback(() => {
    if (!activeTerminalId || !searchQuery) return;
    const instance = instancesRef.current.get(activeTerminalId);
    if (instance) {
      instance.searchAddon.findNext(searchQuery, {
        decorations: {
          matchBackground: '#515c6a',
          matchBorder: '#515c6a',
          activeMatchBackground: '#c4835a',
          activeMatchBorder: '#c4835a',
        },
      });
    }
  }, [activeTerminalId, searchQuery]);

  const handleSearchPrevious = useCallback(() => {
    if (!activeTerminalId || !searchQuery) return;
    const instance = instancesRef.current.get(activeTerminalId);
    if (instance) {
      instance.searchAddon.findPrevious(searchQuery, {
        decorations: {
          matchBackground: '#515c6a',
          matchBorder: '#515c6a',
          activeMatchBackground: '#c4835a',
          activeMatchBorder: '#c4835a',
        },
      });
    }
  }, [activeTerminalId, searchQuery]);

  const handleSearchInputChange = useCallback((e) => {
    const value = e.target.value;
    setSearchQuery(value);
    // Live search on type
    if (activeTerminalId && value) {
      const instance = instancesRef.current.get(activeTerminalId);
      if (instance) {
        instance.searchAddon.findNext(value, {
          decorations: {
            matchBackground: '#515c6a',
            matchBorder: '#515c6a',
            activeMatchBackground: '#c4835a',
            activeMatchBorder: '#c4835a',
          },
        });
      }
    } else if (activeTerminalId && !value) {
      const instance = instancesRef.current.get(activeTerminalId);
      if (instance) {
        instance.searchAddon.clearDecorations();
      }
    }
  }, [activeTerminalId]);

  const handleSearchKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        handleSearchPrevious();
      } else {
        handleSearchNext();
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      handleSearchClose();
    }
  }, [handleSearchNext, handleSearchPrevious, handleSearchClose]);

  // Listen for Ctrl+F when terminal is focused
  useEffect(() => {
    const handler = (e) => {
      // Ctrl+F to open search (only when terminal area is focused)
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        const terminalArea = outerContainerRef.current;
        if (terminalArea && terminalArea.contains(document.activeElement)) {
          e.preventDefault();
          handleSearchOpen();
        }
      }
      // Ctrl+Shift+C for copy from terminal
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "C") {
        const terminalArea = outerContainerRef.current;
        if (terminalArea && terminalArea.contains(document.activeElement)) {
          e.preventDefault();
          if (activeTerminalId) {
            const instance = instancesRef.current.get(activeTerminalId);
            if (instance) {
              const selection = instance.xterm.getSelection();
              if (selection) {
                navigator.clipboard.writeText(selection);
              }
            }
          }
        }
      }
      // Ctrl+Shift+V for paste into terminal
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "V") {
        const terminalArea = outerContainerRef.current;
        if (terminalArea && terminalArea.contains(document.activeElement)) {
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            if (text && activeTerminalId) {
              const inst = instancesRef.current.get(activeTerminalId);
              if (inst) writeToInstance(inst, text);
            }
          });
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeTerminalId, handleSearchOpen]);

  const handleCreateTab = useCallback(() => {
    createTerminalTab();
  }, [createTerminalTab]);

  const handleCloseTab = useCallback((e, tabId) => {
    e.stopPropagation();
    // Kill the backend process
    const instance = instancesRef.current.get(tabId);
    if (instance) {
      if (isElectron() && instance.backendId) {
        terminalService.kill(instance.backendId);
      } else {
        if (instance.stopReconnect) instance.stopReconnect();
        if (instance.ws) instance.ws.close();
      }
    }
    closeTerminalTab(tabId);
  }, [closeTerminalTab]);

  // Empty state: no terminals
  if (terminalTabs.length === 0) {
    return (
      <div
        ref={outerContainerRef}
        className="w-full h-full flex flex-col items-center justify-center bg-[#1e1e1e] rounded-t-md"
      >
        <TerminalWindowIcon size={32} className="text-text-tertiary mb-2" />
        <button
          onClick={handleCreateTab}
          className="px-3 py-1.5 text-sm text-text-secondary bg-white/[0.06] hover:bg-white/[0.12] rounded border border-white/[0.1] transition-colors cursor-pointer"
        >
          New Terminal
        </button>
      </div>
    );
  }

  return (
    <div
      ref={outerContainerRef}
      className="w-full h-full flex flex-col overflow-hidden rounded-t-md relative"
    >
      {/* Terminal tab bar */}
      <div className="flex items-center bg-[#1e1e1e] border-b border-white/[0.08] shrink-0">
        <div className="flex items-center flex-1 overflow-x-auto min-w-0">
          {terminalTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTerminalTab(tab.id)}
              className={cn(
                "group flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-white/[0.06] cursor-pointer shrink-0 transition-colors",
                tab.id === activeTerminalId
                  ? "bg-white/[0.08] text-white/90"
                  : "bg-transparent text-white/50 hover:text-white/70 hover:bg-white/[0.04]"
              )}
            >
              <TerminalWindowIcon size={14} />
              <span className="truncate max-w-[100px]">{tab.label}</span>
              <span
                onClick={(e) => handleCloseTab(e, tab.id)}
                className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/[0.12] transition-opacity"
              >
                <XIcon size={12} />
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={handleCreateTab}
          className="p-1.5 text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
          title="New Terminal (Ctrl+Shift+`)"
        >
          <PlusIcon size={16} />
        </button>
      </div>

      {/* Search overlay */}
      {isSearchOpen && (
        <div className="absolute top-8 right-2 z-10 flex items-center gap-1 bg-[#252526] border border-white/[0.15] rounded px-2 py-1 shadow-lg">
          <MagnifyingGlassIcon size={14} className="text-white/50 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={handleSearchInputChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="Find in terminal..."
            className="bg-transparent border-none outline-none text-white/90 text-xs w-[180px] placeholder:text-white/30"
          />
          <button
            onClick={handleSearchPrevious}
            className="p-0.5 text-white/50 hover:text-white/80 hover:bg-white/[0.1] rounded transition-colors cursor-pointer"
            title="Previous match (Shift+Enter)"
          >
            <ArrowUpIcon size={14} />
          </button>
          <button
            onClick={handleSearchNext}
            className="p-0.5 text-white/50 hover:text-white/80 hover:bg-white/[0.1] rounded transition-colors cursor-pointer"
            title="Next match (Enter)"
          >
            <ArrowDownIcon size={14} />
          </button>
          <button
            onClick={handleSearchClose}
            className="p-0.5 text-white/50 hover:text-white/80 hover:bg-white/[0.1] rounded transition-colors cursor-pointer"
            title="Close (Escape)"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* Terminal containers with padding */}
      <div className="flex-1 overflow-hidden relative">
        {terminalTabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0 p-2 bg-[#1e1e1e]",
              tab.id === activeTerminalId ? "block" : "hidden"
            )}
          >
            <div
              id={`terminal-container-${tab.id}`}
              className="w-full h-full overflow-hidden"
            />
          </div>
        ))}
      </div>
    </div>
  );
});

export default Terminal;
