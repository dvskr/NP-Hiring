/**
 * Browser side of the widget preview harness: plays an MCP Apps host with the
 * SDK's own AppBridge. It loads the built widget in a sandboxed iframe, sends
 * the scenario's tool input and result, answers the widget's tool calls with
 * fixtures, and switches theme, host style variables, width and display mode.
 *
 * Bundled by server.mjs; not part of the app.
 */
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import { findScenario, SCENARIOS } from './scenarios.mjs';

/** A plausible Claude-like variable set, to check the widget with host tokens applied. */
const HOST_VARIABLES = {
    light: {
        '--color-background-primary': '#ffffff',
        '--color-background-secondary': '#f5f4ed',
        '--color-background-tertiary': '#f0eee6',
        '--color-text-primary': '#141413',
        '--color-text-secondary': '#3d3d3a',
        '--color-text-tertiary': '#73726c',
        '--color-border-primary': 'rgba(31, 30, 29, 0.15)',
        '--color-border-secondary': 'rgba(31, 30, 29, 0.1)',
        '--color-ring-primary': '#2c84db',
        '--color-background-info': '#d6e4f6',
        '--color-text-info': '#0f4c91',
        '--color-background-success': '#e9f1dc',
        '--color-text-success': '#3e6116',
        '--color-background-warning': '#f6eedf',
        '--color-text-warning': '#805300',
        '--color-background-danger': '#f7eceb',
        '--color-text-danger': '#a32c2c',
        '--font-sans': '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
        '--border-radius-md': '8px',
        '--border-radius-lg': '12px',
    },
    dark: {
        '--color-background-primary': '#30302e',
        '--color-background-secondary': '#262624',
        '--color-background-tertiary': '#1f1e1d',
        '--color-text-primary': '#faf9f5',
        '--color-text-secondary': '#c2c0b6',
        '--color-text-tertiary': '#9c9a92',
        '--color-border-primary': 'rgba(222, 220, 209, 0.15)',
        '--color-border-secondary': 'rgba(222, 220, 209, 0.1)',
        '--color-ring-primary': '#5aa0e6',
        '--color-background-info': '#253e5f',
        '--color-text-info': '#a8c8f0',
        '--color-background-success': '#2b3a1b',
        '--color-text-success': '#b5d48a',
        '--color-background-warning': '#45351a',
        '--color-text-warning': '#f0c878',
        '--color-background-danger': '#4a2423',
        '--color-text-danger': '#f2a6a3',
        '--font-sans': '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
        '--border-radius-md': '8px',
        '--border-radius-lg': '12px',
    },
};

const params = new URLSearchParams(window.location.search);
const state = {
    scenario: findScenario(params.get('scenario') ?? 'list'),
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    width: Number(params.get('width') ?? 720),
    vars: params.get('vars') === 'claude' ? 'claude' : 'none',
    displayMode: params.get('mode') === 'fullscreen' ? 'fullscreen' : 'inline',
};
if (state.scenario.host?.displayMode) state.displayMode = state.scenario.host.displayMode;

const log = [];
window.__harness = { log, ready: false, calls: [] };

function record(kind, detail) {
    log.push({ kind, detail, at: Date.now() });
    const panel = document.getElementById('log');
    if (panel) panel.textContent = log.map((entry) => `${entry.kind}: ${JSON.stringify(entry.detail)}`).join('\n');
}

function hostContext() {
    const variables = state.vars === 'claude' ? HOST_VARIABLES[state.theme] : undefined;
    return {
        theme: state.theme,
        ...(variables ? { styles: { variables } } : {}),
        displayMode: state.displayMode,
        availableDisplayModes: ['inline', 'fullscreen'],
        containerDimensions: { width: state.width, maxHeight: 6000 },
        platform: 'web',
        locale: 'en-US',
        timeZone: 'America/Chicago',
        deviceCapabilities: { hover: true, touch: false },
        toolInfo: { tool: { name: state.scenario.tool, inputSchema: { type: 'object' } } },
    };
}

function applyStage() {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.style.colorScheme = state.theme;
    const stage = document.getElementById('stage');
    stage.dataset.mode = state.displayMode;
    stage.style.width = state.displayMode === 'fullscreen' ? '' : `${state.width + 32}px`;
}

async function respond(name, args) {
    const responses = state.scenario.responses ?? {};
    const response = responses[name];
    window.__harness.calls.push({ name, args });
    record('tools/call', { name, args });
    if (response === 'pending') return new Promise(() => {});
    const result = typeof response === 'function' ? response(args) : response;
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (result) return result;
    return { isError: true, content: [{ type: 'text', text: `The harness has no fixture for ${name}.` }] };
}

function buildToolbar() {
    const scenarioSelect = document.getElementById('scenario');
    for (const scenario of SCENARIOS) {
        const option = document.createElement('option');
        option.value = scenario.name;
        option.textContent = scenario.name;
        scenarioSelect.append(option);
    }
    scenarioSelect.value = state.scenario.name;
    const go = (patch) => {
        const next = new URLSearchParams(window.location.search);
        for (const [key, value] of Object.entries(patch)) next.set(key, value);
        window.location.search = next.toString();
    };
    scenarioSelect.addEventListener('change', () => go({ scenario: scenarioSelect.value }));
    document.getElementById('width').value = String(state.width);
    document.getElementById('width').addEventListener('change', (event) => go({ width: event.target.value }));
    document.getElementById('vars').value = state.vars;
    document.getElementById('vars').addEventListener('change', (event) => go({ vars: event.target.value }));
    return go;
}

async function start() {
    const go = buildToolbar();
    applyStage();
    const iframe = document.getElementById('widget');
    const bridge = new AppBridge(
        null,
        { name: 'NP Hiring preview host', version: '1.0.0' },
        { openLinks: {}, serverTools: {}, logging: {}, updateModelContext: { text: {} } },
        { hostContext: hostContext() },
    );

    bridge.oncalltool = async (request) => respond(request.name, request.arguments ?? {});
    bridge.onopenlink = async ({ url }) => {
        record('ui/open-link', { url });
        return {};
    };
    bridge.onupdatemodelcontext = async (request) => {
        record('ui/update-model-context', request);
        return {};
    };
    bridge.onrequestdisplaymode = async ({ mode }) => {
        state.displayMode = mode === 'fullscreen' ? 'fullscreen' : 'inline';
        applyStage();
        bridge.setHostContext(hostContext());
        record('ui/request-display-mode', { mode: state.displayMode });
        return { mode: state.displayMode };
    };
    bridge.onloggingmessage = (message) => record('log', message);
    bridge.addEventListener('sizechange', ({ height }) => {
        if (typeof height === 'number' && state.displayMode === 'inline') iframe.style.height = `${height}px`;
    });
    bridge.addEventListener('initialized', () => {
        const { input, result } = state.scenario;
        void bridge.sendToolInput({ arguments: input });
        if (result !== 'pending') {
            setTimeout(() => {
                void bridge.sendToolResult(result);
                window.__harness.ready = true;
            }, 60);
        } else {
            window.__harness.ready = true;
        }
    });

    await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
    iframe.src = '/widget.html';

    document.getElementById('theme').addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        applyStage();
        bridge.setHostContext(hostContext());
        const next = new URLSearchParams(window.location.search);
        next.set('theme', state.theme);
        window.history.replaceState(null, '', `?${next.toString()}`);
    });
    document.getElementById('mode').addEventListener('click', () => {
        state.displayMode = state.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
        applyStage();
        bridge.setHostContext(hostContext());
    });
    document.getElementById('reload').addEventListener('click', () => go({}));
}

void start();
