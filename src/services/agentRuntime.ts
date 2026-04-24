import type {
  AgentSessionStartOptions,
  AgentSessionEventPayload,
  AgentSessionExitPayload,
} from '@/types/electron-api';

function isElectron(): boolean {
  return !!(window.electronAPI && window.electronAPI.agentSessionStart);
}

export const isElectronAgentRuntime = isElectron;

export interface AgentSessionCallbacks {
  onEvent: (event: Record<string, unknown>) => void;
  onExit: (payload: { code: number | null; signal: string | null }) => void;
  onError: (message: string) => void;
}

export interface AgentSessionHandle {
  sessionKey: string;
  /** Send a user message turn. */
  sendUserMessage: (body: string) => void;
  /** Respond to a `can_use_tool` control_request using its request_id. */
  respondToPermission: (
    requestId: string,
    decision: 'allow' | 'deny',
    opts?: { message?: string; updatedInput?: unknown },
  ) => void;
  /** Kill the subprocess. */
  stop: () => Promise<void>;
}

/**
 * Start a persistent Claude Code session using stream-json I/O. Returns a
 * handle for writing messages and permission responses. The subprocess stays
 * alive across turns until `stop()` is called or it exits on its own.
 */
export async function startSession(
  agentId: string,
  options: AgentSessionStartOptions,
  callbacks: AgentSessionCallbacks,
): Promise<AgentSessionHandle> {
  if (!isElectron()) {
    throw new Error('Agent runtime is only available in Electron for now.');
  }
  const api = window.electronAPI!;

  let settled = false;
  const eventHandler = api.onAgentSessionEvent((payload: AgentSessionEventPayload) => {
    if (payload.agentId !== agentId) return;
    callbacks.onEvent(payload.event);
  });
  const exitHandler = api.onAgentSessionExit((payload: AgentSessionExitPayload) => {
    if (payload.agentId !== agentId) return;
    if (settled) return;
    settled = true;
    api.removeAgentSessionEventListener(eventHandler);
    api.removeAgentSessionExitListener(exitHandler);
    callbacks.onExit({ code: payload.code, signal: payload.signal });
  });

  let sessionKey: string;
  try {
    const result = await api.agentSessionStart(agentId, options);
    sessionKey = result.sessionKey;
  } catch (err) {
    api.removeAgentSessionEventListener(eventHandler);
    api.removeAgentSessionExitListener(exitHandler);
    callbacks.onError(err instanceof Error ? err.message : String(err));
    throw err;
  }

  return {
    sessionKey,
    sendUserMessage: (body: string) => {
      api.agentSessionWrite(sessionKey, {
        type: 'user',
        message: { role: 'user', content: body },
      });
    },
    respondToPermission: (requestId, decision, opts) => {
      // The stream-json control protocol: reply to a can_use_tool control_request
      // with a control_response whose response payload is a PermissionResult.
      const payload = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: decision === 'allow'
            ? { behavior: 'allow', updatedInput: opts?.updatedInput ?? {} }
            : { behavior: 'deny', message: opts?.message ?? 'Denied by user.' },
        },
      };
      api.agentSessionWrite(sessionKey, payload);
    },
    stop: async () => {
      try {
        await api.agentSessionStop(sessionKey);
      } finally {
        if (!settled) {
          settled = true;
          api.removeAgentSessionEventListener(eventHandler);
          api.removeAgentSessionExitListener(exitHandler);
        }
      }
    },
  };
}
