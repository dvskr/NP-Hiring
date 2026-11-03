/**
 * The widget's top-level state: what the host has told it so far (tool input,
 * tool result, display context). main.tsx feeds it from the App events and
 * re-renders the tree on every change; views keep their own local state.
 */
import type { McpUiDisplayMode } from '@modelcontextprotocol/ext-apps';
import type { WidgetView } from '../../contracts';
import { GENERIC_ERROR } from './copy';
import { readToolResult, skeletonFor, type SkeletonKind, type ToolResultLike } from './results';

export type Phase =
    | { kind: 'connecting' }
    | { kind: 'waiting'; skeleton: SkeletonKind }
    | { kind: 'ready'; seq: number; view: WidgetView }
    | { kind: 'error'; seq: number; message: string }
    | { kind: 'cancelled' };

export interface HostUi {
    displayMode: McpUiDisplayMode;
    canFullscreen: boolean;
    timeZone: string | undefined;
}

export interface WidgetState {
    phase: Phase;
    host: HostUi;
    toolName: string | undefined;
    toolInput: Record<string, unknown> | undefined;
    seq: number;
}

export type Listener = (state: WidgetState) => void;

export interface Store {
    get(): WidgetState;
    subscribe(listener: Listener): () => void;
    connected(toolName: string | undefined): void;
    connectFailed(): void;
    toolInput(args: Record<string, unknown>): void;
    toolResult(result: ToolResultLike): void;
    toolCancelled(): void;
    setHost(host: Partial<HostUi>): void;
}

export function createStore(): Store {
    let state: WidgetState = {
        phase: { kind: 'connecting' },
        host: { displayMode: 'inline', canFullscreen: false, timeZone: undefined },
        toolName: undefined,
        toolInput: undefined,
        seq: 0,
    };
    const listeners = new Set<Listener>();
    let lastResultKey: string | null = null;

    const set = (next: WidgetState): void => {
        state = next;
        listeners.forEach((listener) => listener(state));
    };
    const waitingOrConnecting = (): boolean => state.phase.kind === 'connecting' || state.phase.kind === 'waiting';

    return {
        get: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        connected(toolName) {
            const phase: Phase = waitingOrConnecting()
                ? { kind: 'waiting', skeleton: skeletonFor(toolName, state.toolInput) }
                : state.phase;
            set({ ...state, toolName, phase });
        },
        connectFailed() {
            if (!waitingOrConnecting()) return;
            set({ ...state, seq: state.seq + 1, phase: { kind: 'error', seq: state.seq + 1, message: GENERIC_ERROR } });
        },
        toolInput(args) {
            const phase: Phase = waitingOrConnecting()
                ? { kind: 'waiting', skeleton: skeletonFor(state.toolName, args) }
                : state.phase;
            set({ ...state, toolInput: args, phase });
        },
        toolResult(result) {
            // A host that delivers the same result again must not reset where the candidate navigated to.
            const key = JSON.stringify([result.isError ?? false, result.structuredContent ?? null, result.content ?? []]);
            if (key === lastResultKey) return;
            lastResultKey = key;
            const outcome = readToolResult(result);
            const seq = state.seq + 1;
            let phase: Phase;
            if (!outcome.ok) phase = { kind: 'error', seq, message: outcome.message };
            else if (outcome.view) phase = { kind: 'ready', seq, view: outcome.view };
            else phase = { kind: 'error', seq, message: GENERIC_ERROR };
            set({ ...state, seq, phase });
        },
        toolCancelled() {
            if (!waitingOrConnecting()) return;
            set({ ...state, phase: { kind: 'cancelled' } });
        },
        setHost(host) {
            set({ ...state, host: { ...state.host, ...host } });
        },
    };
}
