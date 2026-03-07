import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test the reconnection logic extracted from Terminal.jsx browser WebSocket path
describe('Terminal WebSocket Reconnection Logic', () => {
  let mockXterm;
  let mockInstance;
  let connectFn;

  const MAX_RETRIES = 5;
  const RETRY_DELAY = 3000;

  beforeEach(() => {
    vi.useFakeTimers();

    mockXterm = {
      writeln: vi.fn(),
      write: vi.fn(),
      cols: 80,
      rows: 24,
      onData: vi.fn(() => ({ dispose: vi.fn() })),
    };

    mockInstance = { ws: null, reconnectTimer: null, stopReconnect: null };

    // Simulate the reconnection logic from Terminal.jsx
    let retryCount = 0;
    let intentionalClose = false;
    let dataHandler = null;
    const wsUrl = 'ws://localhost:3000/term';

    const connect = () => {
      const mockWs = {
        binaryType: '',
        readyState: 1, // OPEN
        send: vi.fn(),
        close: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null,
        onerror: null,
      };
      mockInstance.ws = mockWs;

      mockWs._simulateOpen = () => mockWs.onopen?.();
      mockWs._simulateClose = () => mockWs.onclose?.();
      mockWs._simulateError = () => mockWs.onerror?.();

      // Replicate onopen handler
      mockWs.onopen = () => {
        retryCount = 0;
        mockXterm.writeln("\x1b[32mConnected to terminal server\x1b[0m");
        mockWs.send(JSON.stringify({ cols: mockXterm.cols, rows: mockXterm.rows }));
      };

      // Replicate onclose handler
      mockWs.onclose = () => {
        if (intentionalClose) return;
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          mockXterm.writeln(`\r\n\x1b[33mDisconnected. Reconnecting (${retryCount}/${MAX_RETRIES})...\x1b[0m`);
          mockInstance.reconnectTimer = setTimeout(connect, RETRY_DELAY);
        } else {
          mockXterm.writeln("\r\n\x1b[31mDisconnected from terminal server. Max retries reached.\x1b[0m");
          mockXterm.writeln(`\x1b[2mServer URL: ${wsUrl}\x1b[0m`);
        }
      };

      if (dataHandler) dataHandler.dispose();
      dataHandler = mockXterm.onData((data) => {
        if (mockWs.readyState === 1) {
          mockWs.send(data);
        }
      });
    };

    mockInstance.stopReconnect = () => {
      intentionalClose = true;
      if (mockInstance.reconnectTimer) {
        clearTimeout(mockInstance.reconnectTimer);
        mockInstance.reconnectTimer = null;
      }
    };

    connectFn = connect;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows connected message on successful connection', () => {
    connectFn();
    mockInstance.ws.onopen();

    expect(mockXterm.writeln).toHaveBeenCalledWith(
      expect.stringContaining('Connected to terminal server')
    );
  });

  it('sends initial dimensions on connect', () => {
    connectFn();
    mockInstance.ws.onopen();

    expect(mockInstance.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ cols: 80, rows: 24 })
    );
  });

  it('retries on disconnect with yellow message', () => {
    connectFn();
    mockInstance.ws.onclose();

    expect(mockXterm.writeln).toHaveBeenCalledWith(
      expect.stringContaining('Reconnecting (1/5)')
    );
  });

  it('retries up to MAX_RETRIES times', () => {
    connectFn();

    // Each close triggers a reconnect attempt; advance timer to let connect() run
    for (let i = 0; i < MAX_RETRIES; i++) {
      mockInstance.ws.onclose();
      vi.advanceTimersByTime(RETRY_DELAY);
    }

    // One more close after all retries exhausted triggers "Max retries reached"
    mockInstance.ws.onclose();

    expect(mockXterm.writeln).toHaveBeenCalledWith(
      expect.stringContaining('Max retries reached')
    );
  });

  it('shows server URL on final failure', () => {
    connectFn();

    for (let i = 0; i < MAX_RETRIES; i++) {
      mockInstance.ws.onclose();
      vi.advanceTimersByTime(RETRY_DELAY);
    }

    // Final close after retries exhausted shows server URL
    mockInstance.ws.onclose();

    expect(mockXterm.writeln).toHaveBeenCalledWith(
      expect.stringContaining('ws://localhost:3000/term')
    );
  });

  it('resets retry count on successful reconnect', () => {
    connectFn();
    mockInstance.ws.onclose(); // retry 1
    vi.advanceTimersByTime(RETRY_DELAY);

    // Simulate successful reconnect
    mockInstance.ws.onopen();

    // Now disconnect again — should start from retry 1
    mockInstance.ws.onclose();
    expect(mockXterm.writeln).toHaveBeenLastCalledWith(
      expect.stringContaining('Reconnecting (1/5)')
    );
  });

  it('stopReconnect prevents further retries', () => {
    connectFn();
    mockInstance.ws.onclose(); // starts reconnect timer

    mockInstance.stopReconnect();
    vi.advanceTimersByTime(RETRY_DELAY);

    // Should NOT have attempted a second reconnection
    const reconnectCalls = mockXterm.writeln.mock.calls.filter(
      c => c[0].includes('Reconnecting')
    );
    expect(reconnectCalls).toHaveLength(1);
  });

  it('intentional close does not trigger reconnect', () => {
    connectFn();
    mockInstance.stopReconnect();
    mockInstance.ws.onclose();

    const reconnectCalls = mockXterm.writeln.mock.calls.filter(
      c => c[0].includes('Reconnecting') || c[0].includes('Disconnected')
    );
    expect(reconnectCalls).toHaveLength(0);
  });
});
