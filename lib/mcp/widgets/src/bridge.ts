/**
 * Host bridge for the widgets.
 *
 * Standards first: the MCP Apps protocol (ui/* JSON-RPC over postMessage,
 * spec 2026-01-26), which both Claude and ChatGPT implement. window.openai
 * is used only when no MCP Apps host answers the handshake, which covers
 * older ChatGPT builds. Nothing here branches on a product name.
 *
 * Order matters on strict hosts: Claude keeps the iframe hidden until
 * ui/initialize completes, and a host may not send anything before it
 * receives ui/notifications/initialized. So the handshake is the first
 * message, and no host call is made until it resolves.
 */

export interface ToolResultContent {
  type: string;
  text?: string;
}

export interface ToolResult {
  structuredContent?: Record<string, unknown> | null;
  content?: ToolResultContent[];
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

export interface HostContext {
  theme?: 'light' | 'dark';
  displayMode?: string;
  availableDisplayModes?: string[];
  locale?: string;
  platform?: string;
  styles?: { variables?: Record<string, string | undefined> };
  containerDimensions?: { height?: number; maxHeight?: number; width?: number; maxWidth?: number };
}

export interface BridgeCallbacks {
  onToolInput(args: Record<string, unknown>): void;
  onToolResult(result: ToolResult): void;
  onContext(context: HostContext): void;
}

export interface Bridge {
  readonly kind: 'mcp-apps' | 'openai' | 'none';
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  openLink(url: string): Promise<void>;
  sendMessage(text: string): Promise<void>;
  updateModelContext(text: string, structured?: Record<string, unknown>): Promise<void>;
  requestDisplayMode(mode: 'inline' | 'fullscreen'): Promise<void>;
  notifySize(width: number, height: number): void;
  context(): HostContext;
}

export const MCP_APPS_PROTOCOL_VERSION = '2026-01-26';
const HANDSHAKE_TIMEOUT_MS = 3000;
const REQUEST_TIMEOUT_MS = 60000;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

interface OpenAiGlobals {
  toolOutput?: Record<string, unknown> | null;
  toolResponseMetadata?: Record<string, unknown> | null;
  toolInput?: Record<string, unknown> | null;
  theme?: 'light' | 'dark';
  displayMode?: string;
  locale?: string;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  openExternal?: (options: { href: string }) => void | Promise<void>;
  sendFollowUpMessage?: (options: { prompt: string }) => void | Promise<void>;
  setWidgetState?: (state: Record<string, unknown>) => void | Promise<void>;
  requestDisplayMode?: (options: { mode: string }) => Promise<unknown>;
  notifyIntrinsicHeight?: (height: number) => void;
}

function openAiGlobals(): OpenAiGlobals | null {
  const candidate = (window as unknown as { openai?: OpenAiGlobals }).openai;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

/** Normalises whatever a host hands back from a tool call into a ToolResult. */
export function normalizeToolResult(raw: unknown): ToolResult {
  if (!raw || typeof raw !== 'object') return { isError: true, content: [{ type: 'text', text: 'No response.' }] };
  const value = raw as Record<string, unknown>;
  // Some hosts wrap the MCP result one level down.
  const inner = (value.result && typeof value.result === 'object' ? value.result : value) as Record<string, unknown>;
  return {
    structuredContent: (inner.structuredContent as Record<string, unknown> | undefined) ?? null,
    content: Array.isArray(inner.content) ? (inner.content as ToolResultContent[]) : [],
    _meta: (inner._meta as Record<string, unknown> | undefined) ?? undefined,
    isError: inner.isError === true,
  };
}

function connectMcpApps(callbacks: BridgeCallbacks): Promise<Bridge | null> {
  let nextId = 1;
  let context: HostContext = {};
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();

  const post = (message: JsonRpcMessage) => window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*');

  const request = (method: string, params: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      post({ id, method, params });
    });

  const notify = (method: string, params: Record<string, unknown> = {}) => post({ method, params });

  window.addEventListener('message', (event: MessageEvent) => {
    // Only the embedding host may talk to us.
    if (event.source !== window.parent) return;
    const message = event.data as JsonRpcMessage | null;
    if (!message || message.jsonrpc !== '2.0') return;

    if (message.method === undefined && message.id !== undefined) {
      const entry = pending.get(Number(message.id));
      if (!entry) return;
      pending.delete(Number(message.id));
      window.clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || 'Host error'));
      else entry.resolve(message.result);
      return;
    }

    const params = message.params ?? {};
    if (message.id !== undefined && message.method) {
      // Host-to-app requests. Teardown and ping need an answer; nothing else
      // is implemented, which JSON-RPC reports as method-not-found.
      if (message.method === 'ui/resource-teardown' || message.method === 'ping') {
        post({ id: message.id, result: {} });
      } else {
        post({ id: message.id, error: { code: -32601, message: 'Method not found' } });
      }
      return;
    }

    switch (message.method) {
      case 'ui/notifications/tool-input':
        callbacks.onToolInput((params.arguments as Record<string, unknown>) ?? {});
        break;
      case 'ui/notifications/tool-result':
        callbacks.onToolResult(normalizeToolResult(params));
        break;
      case 'ui/notifications/host-context-changed':
        context = { ...context, ...(params as HostContext) };
        callbacks.onContext(context);
        break;
      default:
        break;
    }
  });

  return request(
    'ui/initialize',
    {
      appInfo: { name: 'job-board-widgets', version: '1.0.0' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
      protocolVersion: MCP_APPS_PROTOCOL_VERSION,
    },
    HANDSHAKE_TIMEOUT_MS,
  ).then(
    (result) => {
      context = ((result as { hostContext?: HostContext } | null)?.hostContext ?? {}) as HostContext;
      notify('ui/notifications/initialized');
      callbacks.onContext(context);
      const bridge: Bridge = {
        kind: 'mcp-apps',
        callTool: async (name, args) => normalizeToolResult(await request('tools/call', { name, arguments: args })),
        openLink: async (url) => {
          await request('ui/open-link', { url });
        },
        sendMessage: async (text) => {
          await request('ui/message', { role: 'user', content: [{ type: 'text', text }] });
        },
        updateModelContext: async (text, structured) => {
          await request('ui/update-model-context', {
            content: [{ type: 'text', text }],
            ...(structured ? { structuredContent: structured } : {}),
          });
        },
        requestDisplayMode: async (mode) => {
          await request('ui/request-display-mode', { mode });
        },
        notifySize: (width, height) => notify('ui/notifications/size-changed', { width, height }),
        context: () => context,
      };
      return bridge;
    },
    () => null,
  );
}

function connectOpenAi(callbacks: BridgeCallbacks, openai: OpenAiGlobals): Bridge {
  const readContext = (): HostContext => ({
    theme: openai.theme,
    displayMode: openai.displayMode,
    locale: openai.locale,
  });

  // openai:set_globals fires whenever any global changes: the theme, the
  // display mode, widget state. Only a different tool output is a new
  // result. Replaying the same one would reset the card and throw away a
  // half-typed cover letter, so each is forwarded once, compared by value.
  let lastInput = '';
  let lastOutput = '';
  const emitGlobals = () => {
    callbacks.onContext(readContext());
    const input = openai.toolInput ? JSON.stringify(openai.toolInput) : '';
    if (openai.toolInput && input !== lastInput) {
      lastInput = input;
      callbacks.onToolInput(openai.toolInput);
    }
    const output = openai.toolOutput ? JSON.stringify(openai.toolOutput) : '';
    if (openai.toolOutput && output !== lastOutput) {
      lastOutput = output;
      callbacks.onToolResult({
        structuredContent: openai.toolOutput,
        _meta: openai.toolResponseMetadata ?? undefined,
      });
    }
  };

  window.addEventListener('openai:set_globals', emitGlobals);
  // Globals may already be present when the script runs.
  window.setTimeout(emitGlobals, 0);

  return {
    kind: 'openai',
    callTool: async (name, args) => {
      if (!openai.callTool) throw new Error('Tool calls are not available here.');
      return normalizeToolResult(await openai.callTool(name, args));
    },
    openLink: async (url) => {
      await openai.openExternal?.({ href: url });
    },
    sendMessage: async (text) => {
      await openai.sendFollowUpMessage?.({ prompt: text });
    },
    updateModelContext: async (_text, structured) => {
      if (structured) await openai.setWidgetState?.(structured);
    },
    requestDisplayMode: async (mode) => {
      await openai.requestDisplayMode?.({ mode });
    },
    notifySize: (_width, height) => openai.notifyIntrinsicHeight?.(height),
    context: readContext,
  };
}

function standalone(): Bridge {
  const unavailable = async (): Promise<never> => {
    throw new Error('Open this inside ChatGPT or Claude to use it.');
  };
  return {
    kind: 'none',
    callTool: unavailable,
    openLink: async (url) => {
      window.open(url, '_blank', 'noopener');
    },
    sendMessage: unavailable,
    updateModelContext: async () => undefined,
    requestDisplayMode: async () => undefined,
    notifySize: () => undefined,
    context: () => ({}),
  };
}

export async function connectBridge(callbacks: BridgeCallbacks): Promise<Bridge> {
  if (window.parent && window.parent !== window) {
    const mcp = await connectMcpApps(callbacks);
    if (mcp) return mcp;
  }
  const openai = openAiGlobals();
  if (openai) return connectOpenAi(callbacks, openai);
  return standalone();
}
