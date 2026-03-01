import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WS_URL } from "../config.js";
import "@xterm/xterm/css/xterm.css";

const Terminal = forwardRef(({ workspacePath }, ref) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);

  useImperativeHandle(ref, () => ({
    write: (data) => {
      if (window.electronAPI) {
        window.electronAPI.writeTerminal(data);
      } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    },
    focus: () => {
      xtermRef.current?.focus();
    },
  }));

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm.js
    const term = new XTerm({
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      theme: {
        background: "#1e1e1e", // Matches VSCode default roughly
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
      },
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);

    // Wait for web fonts to load before fitting so metrics are correct
    document.fonts.ready.then(() => {
      fitAddon.fit();
    });

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect to Electron IPC or WebSocket
    if (window.electronAPI) {
      window.electronAPI.createTerminal(workspacePath ? { cwd: workspacePath } : undefined);

      window.electronAPI.onTerminalData((data) => {
        term.write(data);
      });

      term.onData((data) => {
        window.electronAPI.writeTerminal(data);
      });

      // Initial resize
      window.electronAPI.resizeTerminal(term.cols, term.rows);
    } else {
      // WebSocket connection (Browser Mode)
      const wsUrl = workspacePath
        ? `${WS_URL}/term?cwd=${encodeURIComponent(workspacePath)}`
        : `${WS_URL}/term`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        term.writeln("\x1b[32mConnected to terminal server\x1b[0m");
        // Send initial size
        ws.send(JSON.stringify({ cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data));
        } else {
          term.write(event.data);
        }
      };

      ws.onclose = () => {
        term.writeln("\r\n\x1b[31mDisconnected from terminal server\x1b[0m");
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        term.writeln("\r\n\x1b[31mWebSocket error\x1b[0m");
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      wsRef.current = ws;
    }

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
      const cols = term.cols;
      const rows = term.rows;

      if (window.electronAPI) {
        window.electronAPI.resizeTerminal(cols, rows);
      } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ cols, rows }));
      }
    };

    window.addEventListener("resize", handleResize);
    // Also listen to resize observer on the container for better responsiveness
    const resizeObserver = new ResizeObserver(() => {
      // Debounce slightly?
      handleResize();
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      if (window.electronAPI) {
        window.electronAPI.removeTerminalListener();
      } else if (wsRef.current) {
        wsRef.current.close();
      }
      term.dispose();
    };
  }, [workspacePath]);

  return (
    <div
      ref={terminalRef}
      className="w-full h-full bg-bg-base overflow-hidden rounded-t-md"
    />
  );
});

export default Terminal;
