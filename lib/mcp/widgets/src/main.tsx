/** @jsxImportSource preact */
/**
 * Entry point of the NP Hiring widget (MCP Apps view) for Claude and ChatGPT.
 * scripts/build-mcp-widgets.mjs bundles this file and styles.css into the one
 * HTML document the MCP server serves (lib/mcp/widgets/generated).
 *
 * Host rules kept here: every App listener is registered before connect();
 * theme, host style variables, host fonts and safe-area insets are applied on
 * connect and on every host context change; links open only through
 * app.openLink; nothing is fetched, stored or opened by the page itself.
 */
import { render } from 'preact';
import {
    App,
    applyDocumentTheme,
    applyHostFonts,
    applyHostStyleVariables,
    type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { GENERIC_ERROR } from './copy';
import { safeTimeZone } from './format';
import { readToolResult } from './results';
import { Root } from './root';
import type { Services } from './services';
import { createStore } from './store';

const app = new App(
    { name: 'NP Hiring', version: '1.0.0' },
    { availableDisplayModes: ['inline', 'fullscreen'] },
    { autoResize: true },
);
const store = createStore();
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

/** Reports a failed host request to the host's log, when it keeps one. */
function logWarning(message: string): void {
    if (!app.getHostCapabilities()?.logging) return;
    app.sendLog({ level: 'warning', logger: 'np-hiring-widget', data: message }).catch(() => {
        // The log channel itself failed; there is nowhere further to report it.
    });
}

function applyTheme(context: McpUiHostContext | undefined): void {
    // ChatGPT may send no theme: follow the system preference then.
    applyDocumentTheme(context?.theme ?? (darkScheme.matches ? 'dark' : 'light'));
}

function syncHost(context: McpUiHostContext | undefined): void {
    applyTheme(context);
    const variables = context?.styles?.variables;
    if (variables) applyHostStyleVariables(variables);
    const fonts = context?.styles?.css?.fonts;
    if (fonts) applyHostFonts(fonts);
    const insets = context?.safeAreaInsets;
    const root = document.documentElement;
    root.style.setProperty('--np-safe-top', `${insets?.top ?? 0}px`);
    root.style.setProperty('--np-safe-right', `${insets?.right ?? 0}px`);
    root.style.setProperty('--np-safe-bottom', `${insets?.bottom ?? 0}px`);
    root.style.setProperty('--np-safe-left', `${insets?.left ?? 0}px`);
    store.setHost({
        displayMode: context?.displayMode ?? 'inline',
        canFullscreen: (context?.availableDisplayModes ?? []).includes('fullscreen'),
        timeZone: safeTimeZone(context?.timeZone),
    });
}

const services: Services = {
    async callTool(name, args) {
        try {
            return readToolResult(await app.callServerTool({ name, arguments: args }));
        } catch (error) {
            logWarning(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
            return { ok: false, message: GENERIC_ERROR, data: null };
        }
    },
    async openLink(url) {
        try {
            const result = await app.openLink({ url });
            if (result.isError) logWarning('The host declined to open a link.');
            return !result.isError;
        } catch (error) {
            logWarning(`openLink failed: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    },
    async requestFullscreen() {
        try {
            const result = await app.requestDisplayMode({ mode: 'fullscreen' });
            store.setHost({ displayMode: result.mode });
        } catch (error) {
            logWarning(`requestDisplayMode failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
    tellModel(text) {
        if (!app.getHostCapabilities()?.updateModelContext) return;
        app.updateModelContext({ content: [{ type: 'text', text }] }).catch((error: unknown) => {
            logWarning(`updateModelContext failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    },
};

app.addEventListener('toolinput', (params) => store.toolInput(params.arguments ?? {}));
app.addEventListener('toolinputpartial', (params) => store.toolInput(params.arguments ?? {}));
app.addEventListener('toolresult', (result) => store.toolResult(result));
app.addEventListener('toolcancelled', () => store.toolCancelled());
app.addEventListener('hostcontextchanged', () => syncHost(app.getHostContext()));
app.onteardown = () => ({});

darkScheme.addEventListener('change', () => {
    if (!app.getHostContext()?.theme) applyTheme(app.getHostContext());
});

const mount = document.getElementById('root');
if (mount) {
    const paint = () => render(<Root state={store.get()} services={services} />, mount);
    store.subscribe(paint);
    paint();
}

applyTheme(undefined);
app.connect().then(
    () => {
        const context = app.getHostContext();
        syncHost(context);
        store.connected(context?.toolInfo?.tool.name);
    },
    (error: unknown) => {
        logWarning(`connect failed: ${error instanceof Error ? error.message : String(error)}`);
        store.connectFailed();
    },
);
