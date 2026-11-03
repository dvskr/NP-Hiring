/**
 * The two MCP endpoints end to end: app/mcp/route.ts (Claude) and
 * app/mcp/chatgpt/route.ts (ChatGPT) through lib/mcp/handler.ts, the SDK's
 * createMcpHandler and lib/mcp/server.ts, with real JSON-RPC in real Request
 * objects (the 2025-era flow the hosts speak today: initialize, then
 * tools/list, resources/list, resources/read and tools/call).
 *
 * Pinned:
 *   - twelve tools, names of at most 64 characters, each with a title and all
 *     four annotation booleans; submit and withdraw are destructive, the read
 *     tools read-only; no dash used as punctuation in any title, description
 *     or the server instructions;
 *   - Claude: no openai/* or securitySchemes key anywhere, a widget resource
 *     with no ui.domain and only https://assets.claude.ai as a resource
 *     domain; ChatGPT: securitySchemes on every tool (noauth for the three
 *     public tools, oauth2 with the tool's scopes for the rest),
 *     openai/outputTemplate equal to ui.resourceUri, ui.domain and the
 *     redirect domain equal to the site origin;
 *   - the widget resource answers text/html;profile=mcp-app with WIDGET_HTML,
 *     and an earlier widget URI still resolves;
 *   - sign-in: an anonymous candidate tool call is an HTTP 401 on /mcp but an
 *     isError result with mcp/www_authenticate on /mcp/chatgpt; a bad token is
 *     a 401 on both, even for a public tool; a missing scope is a 403 on /mcp;
 *     a signed-in call reads only the token holder's rows;
 *   - the body cap (413, counted in bytes), invalid JSON (-32700), the CORS
 *     preflight, rate limits, and an unexpected failure inside a tool turning
 *     into a generic isError result with no stack and no Prisma text.
 *
 * Prisma, the access token check, the rate limiter and the logger are mocked;
 * nothing reaches a database or the network.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
    verify: vi.fn(),
    job: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    savedJob: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    jobApplication: { findMany: vi.fn(), groupBy: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    userProfile: { findUnique: vi.fn() },
    checkRateLimit: vi.fn(),
    rateLimit: vi.fn(),
    submit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/oauth/access-token', () => ({ verifyAccessToken: h.verify }));
vi.mock('@/lib/prisma', () => ({
    prisma: { job: h.job, savedJob: h.savedJob, jobApplication: h.jobApplication, userProfile: h.userProfile },
}));
vi.mock('@/lib/rate-limit', () => ({
    checkRateLimit: h.checkRateLimit,
    rateLimit: h.rateLimit,
    RATE_LIMITS: { applyDirect: { limit: 10, windowSeconds: 60 } },
}));
vi.mock('@/lib/applications/submit-direct-application', () => ({
    submitDirectApplication: h.submit,
    MAX_COVER_LETTER_LENGTH: 5000,
}));
vi.mock('@/lib/logger', () => ({ logger: h.logger }));

import * as claudeRoute from '@/app/mcp/route';
import * as chatgptRoute from '@/app/mcp/chatgpt/route';
import { MAX_MCP_BODY_BYTES, MCP_RATE_LIMITS } from '@/lib/mcp/handler';
import { SERVER_INSTRUCTIONS, WIDGET_URI } from '@/lib/mcp/server';
import { TOOL_SCOPES } from '@/lib/mcp/auth';
import { MCP_SCOPES, mcpHostProfile } from '@/lib/mcp/config';
import { TOOL, type ToolName } from '@/lib/mcp/tool-names';
import { WIDGET_HTML, WIDGET_VERSION } from '@/lib/mcp/widgets/generated/widget-html';
import { brand } from '@/config/brand';
import {
    DASH_AS_PUNCTUATION,
    JOB_ID,
    JOB_ID_2,
    ME,
    SITE,
    deepKeys,
    jobDetailRow,
    jobRow,
    type Row,
} from './fixtures';

type Host = 'claude' | 'chatgpt';

interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: number | string | null;
    method?: string;
    result?: Row;
    error?: { code: number; message: string; data?: unknown };
}

interface ListedTool {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: Row;
    outputSchema?: Row;
    annotations?: Row;
    _meta?: Row;
}

interface ToolResult {
    content: { type: string; text: string }[];
    structuredContent?: Row;
    isError?: boolean;
    _meta?: Row;
}

interface ListedResource {
    uri: string;
    name: string;
    mimeType?: string;
    _meta?: Row;
}

interface ResourceContents {
    uri: string;
    mimeType?: string;
    text?: string;
    _meta?: Row;
}

const HOSTS: Host[] = ['claude', 'chatgpt'];
const ROUTES = { claude: claudeRoute, chatgpt: chatgptRoute } as const;
const PROFILES = { claude: mcpHostProfile('claude'), chatgpt: mcpHostProfile('chatgpt') } as const;
const PROTOCOL = '2025-11-25';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl';
const MCP_APP_MIME = 'text/html;profile=mcp-app';
const UNEXPECTED = `${brand.name} could not complete this request. Try again in a moment.`;

const PUBLIC_TOOLS: readonly ToolName[] = [TOOL.searchJobs, TOOL.getJob, TOOL.practiceAuthority];
const READ_ONLY_TOOLS: readonly ToolName[] = [
    TOOL.searchJobs,
    TOOL.getJob,
    TOOL.practiceAuthority,
    TOOL.profileStatus,
    TOOL.startApplication,
    TOOL.listApplications,
    TOOL.listSavedJobs,
];
const WRITE_TOOLS: readonly ToolName[] = [
    TOOL.submitApplication,
    TOOL.trackEmployerSiteApplication,
    TOOL.withdrawApplication,
    TOOL.saveJob,
    TOOL.unsaveJob,
];
const UI_TOOLS: readonly ToolName[] = [
    TOOL.searchJobs,
    TOOL.getJob,
    TOOL.startApplication,
    TOOL.submitApplication,
    TOOL.listApplications,
    TOOL.listSavedJobs,
];

// ── Wire helpers ────────────────────────────────────────────────────────────

function mcpRequest(host: Host, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Request {
    return new Request(PROFILES[host].resourceUrl, {
        method: init.method ?? 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...init.headers,
        },
        ...(init.body !== undefined && { body: init.body }),
    });
}

function send(host: Host, request: Request): Promise<Response> {
    const route = ROUTES[host];
    switch (request.method) {
        case 'OPTIONS':
            return route.OPTIONS(request);
        case 'GET':
            return route.GET(request);
        case 'DELETE':
            return route.DELETE(request);
        default:
            return route.POST(request);
    }
}

/** The JSON-RPC messages in a response, from a JSON body or an SSE stream's data lines. */
async function readMessages(response: Response): Promise<JsonRpcMessage[]> {
    const text = await response.text();
    if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
        return text
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trim())
            .filter((data) => data.length > 0)
            .map((data) => JSON.parse(data) as JsonRpcMessage);
    }
    if (text.trim() === '') return [];
    const parsed = JSON.parse(text) as JsonRpcMessage | JsonRpcMessage[];
    return Array.isArray(parsed) ? parsed : [parsed];
}

let nextId = 1;

async function rpc(
    host: Host,
    method: string,
    params: Row = {},
    options: { token?: string } = {},
): Promise<{ response: Response; message: JsonRpcMessage }> {
    const id = nextId++;
    const headers: Record<string, string> = method === 'initialize' ? {} : { 'mcp-protocol-version': PROTOCOL };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await send(host, mcpRequest(host, { body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), headers }));
    const messages = await readMessages(response);
    const message = messages.find((m) => m.id === id);
    if (!message) throw new Error(`no answer to ${method}: HTTP ${response.status} ${JSON.stringify(messages)}`);
    return { response, message };
}

async function callTool(
    host: Host,
    name: string,
    args: Row = {},
    options: { token?: string } = {},
): Promise<{ response: Response; result: ToolResult }> {
    const { response, message } = await rpc(host, 'tools/call', { name, arguments: args }, options);
    if (message.error) throw new Error(`JSON-RPC error from ${name}: ${JSON.stringify(message.error)}`);
    return { response, result: message.result as unknown as ToolResult };
}

async function listTools(host: Host): Promise<ListedTool[]> {
    const { message } = await rpc(host, 'tools/list');
    return (message.result as { tools: ListedTool[] }).tools;
}

async function listResources(host: Host): Promise<ListedResource[]> {
    const { message } = await rpc(host, 'resources/list');
    return (message.result as { resources: ListedResource[] }).resources;
}

async function readResource(host: Host, uri: string): Promise<ResourceContents[]> {
    const { message } = await rpc(host, 'resources/read', { uri });
    if (message.error) throw new Error(`resources/read ${uri}: ${JSON.stringify(message.error)}`);
    return (message.result as { contents: ResourceContents[] }).contents;
}

function verifiedToken(scopes: string[] = [...MCP_SCOPES], userId: string = ME) {
    return {
        ok: true as const,
        token: { token: TOKEN, userId, clientId: 'client-1', grantId: 'grant-1', scopes, resource: PROFILES.claude.resourceUrl, expiresAt: 1_900_000_000 },
    };
}

const openAiKeys = (value: unknown): string[] =>
    deepKeys(value).filter((key) => key.startsWith('openai/') || key === 'securitySchemes');

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
    // createMcpHandler warns once that responseMode 'json' drops mid-call notifications.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterAll(() => {
    warnSpy.mockRestore();
});

beforeEach(() => {
    delete process.env.MCP_BASE_URL;
    delete process.env.MCP_REVIEWER_USER_IDS;
    h.verify.mockReset().mockResolvedValue(verifiedToken());
    h.job.findMany.mockReset().mockResolvedValue([jobRow(), jobRow({ id: JOB_ID_2, title: 'Pediatric Nurse Practitioner' })]);
    h.job.count.mockReset().mockResolvedValue(2);
    h.job.findFirst.mockReset().mockResolvedValue(jobDetailRow());
    h.savedJob.findMany.mockReset().mockResolvedValue([]);
    h.jobApplication.findMany.mockReset().mockResolvedValue([]);
    h.jobApplication.groupBy.mockReset().mockResolvedValue([]);
    h.jobApplication.findUnique.mockReset().mockResolvedValue(null);
    h.userProfile.findUnique.mockReset().mockResolvedValue(null);
    h.checkRateLimit.mockReset().mockResolvedValue({ success: true, reset: Date.now() + 60_000, remaining: 100 });
    h.rateLimit.mockReset().mockResolvedValue(null);
    h.submit.mockReset();
    for (const fn of Object.values(h.logger)) fn.mockReset();
});

// ── The 2025-era handshake ──────────────────────────────────────────────────

describe.each(HOSTS)('%s endpoint: the 2025-era handshake', (host) => {
    it('initialize answers the requested revision, the server identity and the instructions', async () => {
        const { response, message } = await rpc(host, 'initialize', {
            protocolVersion: PROTOCOL,
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
        });
        expect(response.status).toBe(200);
        const result = message.result as {
            protocolVersion: string;
            serverInfo: Row;
            instructions?: string;
            capabilities: Row;
        };
        expect(result.protocolVersion).toBe(PROTOCOL);
        expect(result.serverInfo).toMatchObject({ name: 'np-hiring', title: brand.name, version: '1.0.0' });
        expect(result.instructions).toBe(SERVER_INSTRUCTIONS);
        expect(result.capabilities).toHaveProperty('tools');
        expect(result.capabilities).toHaveProperty('resources');
        expect(SERVER_INSTRUCTIONS).not.toMatch(DASH_AS_PUNCTUATION);
    });

    it('the initialized notification is accepted with no body', async () => {
        const response = await send(
            host,
            mcpRequest(host, {
                body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
                headers: { 'mcp-protocol-version': PROTOCOL },
            }),
        );
        expect(response.status).toBe(202);
    });

    it('every answer carries CORS for bearer clients and noindex', async () => {
        const { response } = await rpc(host, 'tools/list');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(response.headers.get('Access-Control-Expose-Headers')).toContain('WWW-Authenticate');
        expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });
});

// ── tools/list ──────────────────────────────────────────────────────────────

describe.each(HOSTS)('%s endpoint: tools/list', (host) => {
    let tools: ListedTool[];
    beforeEach(async () => {
        tools = await listTools(host);
    });
    const tool = (name: string): ListedTool => {
        const found = tools.find((t) => t.name === name);
        if (!found) throw new Error(`${name} is not listed`);
        return found;
    };

    it('lists exactly the twelve tools, each name at most 64 characters', () => {
        expect(tools).toHaveLength(12);
        expect(tools.map((t) => t.name).sort()).toEqual(Object.values(TOOL).sort());
        for (const { name } of tools) {
            expect(name.length, name).toBeLessThanOrEqual(64);
            expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
        }
    });

    it('every tool has a title, a description and all four annotation booleans', () => {
        for (const t of tools) {
            expect(typeof t.title === 'string' && t.title.length > 0, t.name).toBe(true);
            expect(typeof t.description === 'string' && t.description.length > 0, t.name).toBe(true);
            for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint', 'idempotentHint']) {
                expect(typeof t.annotations?.[hint], `${t.name}.${hint}`).toBe('boolean');
            }
        }
    });

    it('submit_application and withdraw_application are destructive writes', () => {
        for (const name of [TOOL.submitApplication, TOOL.withdrawApplication]) {
            expect(tool(name).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
        }
    });

    it('the read tools are read-only and not destructive; every other tool is a write', () => {
        for (const name of READ_ONLY_TOOLS) {
            expect(tool(name).annotations, name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
        }
        for (const name of WRITE_TOOLS) {
            expect(tool(name).annotations?.readOnlyHint, name).toBe(false);
        }
    });

    it('only submit_application reaches outside NP Hiring (it sends to an employer)', () => {
        const openWorld = tools.filter((t) => t.annotations?.openWorldHint === true).map((t) => t.name);
        expect(openWorld).toEqual([TOOL.submitApplication]);
    });

    it('no title or description uses a dash as punctuation', () => {
        const findings: string[] = [];
        for (const t of tools) {
            for (const [field, text] of [
                ['title', t.title],
                ['annotations.title', t.annotations?.title],
                ['description', t.description],
            ] as const) {
                if (typeof text === 'string' && DASH_AS_PUNCTUATION.test(text)) findings.push(`${t.name} ${field}: ${text}`);
            }
        }
        expect(findings).toEqual([]);
    });

    it('the UI tools point at the widget (current and legacy key); the others carry no UI link', () => {
        for (const t of tools) {
            const ui = t._meta?.ui as { resourceUri?: string } | undefined;
            if (UI_TOOLS.includes(t.name as ToolName)) {
                expect(ui?.resourceUri, t.name).toBe(WIDGET_URI);
                expect(t._meta?.['ui/resourceUri'], t.name).toBe(WIDGET_URI);
            } else {
                expect(ui, t.name).toBeUndefined();
            }
        }
        expect(WIDGET_URI).toBe(`ui://np-hiring/widget-${WIDGET_VERSION}.html`);
    });

    it('no input schema accepts an NPI, DEA, SSN, birth date, license number or EEO field', () => {
        const forbidden = /npi|dea(number)?$|^dea|ssn|socialsecurity|birth|dob|licensenumber|race|ethnicity|gender|veteran|disabilit/;
        for (const t of tools) {
            const keys = deepKeys(t.inputSchema).map((key) => key.toLowerCase().replace(/[^a-z]/g, ''));
            expect(keys.filter((key) => forbidden.test(key)), t.name).toEqual([]);
        }
    });
});

describe('Claude endpoint: no ChatGPT-only keys, a widget with no domain', () => {
    it('no tool carries an openai/* key or securitySchemes', async () => {
        const tools = await listTools('claude');
        expect(openAiKeys(tools)).toEqual([]);
    });

    it('the widget resource: no ui.domain, only https://assets.claude.ai as a resource domain, nothing to connect to', async () => {
        const resources = await listResources('claude');
        const listed = resources.find((r) => r.uri === WIDGET_URI);
        expect(listed?.mimeType).toBe(MCP_APP_MIME);
        const [contents] = await readResource('claude', WIDGET_URI);
        for (const meta of [listed?._meta, contents._meta]) {
            const ui = meta?.ui as { domain?: string; csp?: { resourceDomains?: string[]; connectDomains?: string[] } };
            expect(ui).toBeDefined();
            expect(ui).not.toHaveProperty('domain');
            expect(ui.csp?.resourceDomains).toEqual(['https://assets.claude.ai']);
            expect(ui.csp?.connectDomains).toEqual([]);
            expect(openAiKeys(meta)).toEqual([]);
        }
    });
});

describe('ChatGPT endpoint: securitySchemes, output templates and the widget domain', () => {
    it('securitySchemes on every tool: noauth for the three public tools, oauth2 with the tool scopes for the rest', async () => {
        const tools = await listTools('chatgpt');
        for (const t of tools) {
            const schemes = t._meta?.securitySchemes;
            if (PUBLIC_TOOLS.includes(t.name as ToolName)) {
                expect(schemes, t.name).toEqual([{ type: 'noauth' }]);
            } else {
                expect(schemes, t.name).toEqual([{ type: 'oauth2', scopes: [...(TOOL_SCOPES[t.name as ToolName] ?? [])] }]);
                expect((schemes as { scopes: string[] }[])[0].scopes.length, t.name).toBeGreaterThan(0);
            }
        }
    });

    it('openai/outputTemplate equals ui.resourceUri on every UI tool, and only there', async () => {
        const tools = await listTools('chatgpt');
        for (const t of tools) {
            const template = t._meta?.['openai/outputTemplate'];
            if (UI_TOOLS.includes(t.name as ToolName)) {
                expect(template, t.name).toBe((t._meta?.ui as { resourceUri: string }).resourceUri);
                expect(t._meta?.['openai/widgetAccessible'], t.name).toBe(true);
                for (const key of ['openai/toolInvocation/invoking', 'openai/toolInvocation/invoked']) {
                    const status = t._meta?.[key];
                    expect(typeof status === 'string' && status.length > 0 && status.length <= 64, `${t.name} ${key}`).toBe(true);
                    expect(status as string).not.toMatch(DASH_AS_PUNCTUATION);
                }
            } else {
                expect(template, t.name).toBeUndefined();
            }
        }
    });

    it('the widget resource: ui.domain and the redirect domain are the site origin, nothing else allowed', async () => {
        const resources = await listResources('chatgpt');
        const listed = resources.find((r) => r.uri === WIDGET_URI);
        expect(listed?.mimeType).toBe(MCP_APP_MIME);
        const [contents] = await readResource('chatgpt', WIDGET_URI);
        for (const meta of [listed?._meta, contents._meta]) {
            const ui = meta?.ui as { domain?: string; csp?: { resourceDomains?: string[]; connectDomains?: string[] } };
            expect(ui.domain).toBe(SITE);
            expect(ui.csp?.resourceDomains).toEqual([]);
            expect(ui.csp?.connectDomains).toEqual([]);
            expect(meta?.['openai/widgetDomain']).toBe(SITE);
            expect(meta?.['openai/widgetCSP']).toEqual({ connect_domains: [], resource_domains: [], redirect_domains: [SITE] });
        }
    });
});

describe.each(HOSTS)('%s endpoint: the widget resource', (host) => {
    it('answers text/html;profile=mcp-app with the built widget', async () => {
        const contents = await readResource(host, WIDGET_URI);
        expect(contents).toHaveLength(1);
        expect(contents[0]).toMatchObject({ uri: WIDGET_URI, mimeType: MCP_APP_MIME });
        expect(contents[0].text).toBe(WIDGET_HTML);
    });

    it('an earlier widget URI (a conversation from before a deploy) still resolves to the current widget', async () => {
        const earlier = 'ui://np-hiring/widget-0123abcd4567.html';
        expect(earlier).not.toBe(WIDGET_URI);
        const contents = await readResource(host, earlier);
        expect(contents).toHaveLength(1);
        expect(contents[0]).toMatchObject({ uri: earlier, mimeType: MCP_APP_MIME });
        expect(contents[0].text).toBe(WIDGET_HTML);
        const [current] = await readResource(host, WIDGET_URI);
        expect(contents[0]._meta).toEqual(current._meta);
    });

    it('resources/list advertises only the current widget', async () => {
        const resources = await listResources(host);
        expect(resources.map((r) => r.uri)).toEqual([WIDGET_URI]);
    });
});

// ── Sign-in ─────────────────────────────────────────────────────────────────

describe('a candidate tool without a token', () => {
    it('on /mcp (Claude): HTTP 401 with WWW-Authenticate, before the tool runs', async () => {
        const response = await send(
            'claude',
            mcpRequest('claude', {
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: TOOL.listApplications, arguments: {} } }),
                headers: { 'mcp-protocol-version': PROTOCOL },
            }),
        );
        expect(response.status).toBe(401);
        const challenge = response.headers.get('WWW-Authenticate') ?? '';
        expect(challenge).toBe(
            `Bearer resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp", scope="${MCP_SCOPES.join(' ')}"`,
        );
        expect(response.headers.get('Access-Control-Expose-Headers')).toContain('WWW-Authenticate');
        expect(h.jobApplication.findMany).not.toHaveBeenCalled();
    });

    it('on /mcp/chatgpt: an isError result carrying mcp/www_authenticate, and the tool body never runs', async () => {
        const { response, result } = await callTool('chatgpt', TOOL.listApplications);
        expect(response.status).toBe(200);
        expect(response.headers.get('WWW-Authenticate')).toBeNull();
        expect(result.isError).toBe(true);
        const challenges = result._meta?.['mcp/www_authenticate'] as string[];
        expect(challenges).toHaveLength(1);
        expect(challenges[0]).toContain(`resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp/chatgpt"`);
        expect(challenges[0]).toMatch(/error="[a-z_]+"/);
        expect(challenges[0]).toMatch(/error_description="[^"]+"/);
        expect(h.jobApplication.findMany).not.toHaveBeenCalled();
        expect(h.verify).not.toHaveBeenCalled();
    });

    it.each(PUBLIC_TOOLS.map((name) => [name]))('the public tool %s still works signed out on /mcp', async (name) => {
        const args: Row = name === TOOL.practiceAuthority ? { state: 'TX' } : name === TOOL.getJob ? { job_id: JOB_ID } : {};
        const { response, result } = await callTool('claude', name, args);
        expect(response.status).toBe(200);
        expect(result.isError).not.toBe(true);
    });
});

describe('a bad bearer token', () => {
    beforeEach(() => {
        h.verify.mockResolvedValue({ ok: false, reason: 'invalid' });
    });

    it.each(HOSTS)('on %s: 401 invalid_token naming that endpoint, even for a public tool', async (host) => {
        for (const name of [TOOL.searchJobs, TOOL.listApplications]) {
            const response = await send(
                host,
                mcpRequest(host, {
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }),
                    headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-protocol-version': PROTOCOL },
                }),
            );
            expect(response.status, name).toBe(401);
            const challenge = response.headers.get('WWW-Authenticate') ?? '';
            expect(challenge).toContain(`resource_metadata="${PROFILES[host].resourceMetadataUrl}"`);
            expect(challenge).toContain('error="invalid_token"');
        }
        expect(h.verify).toHaveBeenCalledWith(TOKEN, PROFILES[host].resourceUrl);
        expect(h.job.findMany).not.toHaveBeenCalled();
    });

    it.each(HOSTS)('on %s: a header that is not a bearer token is a 401 too', async (host) => {
        const response = await send(
            host,
            mcpRequest(host, {
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
                headers: { Authorization: 'Basic dXNlcjpwYXNz' },
            }),
        );
        expect(response.status).toBe(401);
        expect(h.verify).not.toHaveBeenCalled();
    });
});

describe('a token without the scope a tool needs', () => {
    beforeEach(() => {
        h.verify.mockResolvedValue(verifiedToken(['profile:read', 'applications:read']));
    });

    it('on /mcp: 403 insufficient_scope, and nothing is submitted', async () => {
        const response = await send(
            'claude',
            mcpRequest('claude', {
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: TOOL.submitApplication, arguments: { job_id: JOB_ID, consent: true } },
                }),
                headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-protocol-version': PROTOCOL },
            }),
        );
        expect(response.status).toBe(403);
        expect(response.headers.get('WWW-Authenticate')).toContain('error="insufficient_scope"');
        expect(h.submit).not.toHaveBeenCalled();
    });

    it('on /mcp/chatgpt: an isError result asking for the missing permission, and nothing is submitted', async () => {
        const { result } = await callTool('chatgpt', TOOL.submitApplication, { job_id: JOB_ID, consent: true }, { token: TOKEN });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('Allow NP Hiring to use your applications to continue.');
        expect((result._meta?.['mcp/www_authenticate'] as string[])[0]).toContain('error="insufficient_scope"');
        expect(h.submit).not.toHaveBeenCalled();
    });
});

describe.each(HOSTS)('%s endpoint: a signed-in candidate', (host) => {
    it("list_my_applications reads only the token holder's rows", async () => {
        h.verify.mockResolvedValue(verifiedToken([...MCP_SCOPES], ME));
        const { response, result } = await callTool(host, TOOL.listApplications, { limit: 5 }, { token: TOKEN });
        expect(response.status).toBe(200);
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent?.view).toBe('applications');
        expect(h.jobApplication.findMany).toHaveBeenCalledTimes(1);
        expect(h.jobApplication.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: ME }, take: 5 });
        expect(h.jobApplication.groupBy.mock.calls[0][0]).toMatchObject({ where: { userId: ME } });
        expect(h.checkRateLimit).toHaveBeenCalledWith(`mcp:candidate:${ME}`, MCP_RATE_LIMITS.candidate);
    });

    it('a candidate over the per-candidate budget gets a 429 with Retry-After, and no tool runs', async () => {
        h.checkRateLimit.mockResolvedValue({ success: false, reset: Date.now() + 30_000, remaining: 0 });
        const response = await send(
            host,
            mcpRequest(host, {
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: TOOL.listApplications, arguments: {} } }),
                headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-protocol-version': PROTOCOL },
            }),
        );
        expect(response.status).toBe(429);
        expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(h.jobApplication.findMany).not.toHaveBeenCalled();
    });
});

// ── Public tools ────────────────────────────────────────────────────────────

describe.each(HOSTS)('%s endpoint: public tools signed out', (host) => {
    it('search_jobs answers the job-list view plus text with every job id', async () => {
        const { response, result } = await callTool(host, TOOL.searchJobs, { query: 'family', state: 'TX' });
        expect(response.status).toBe(200);
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent?.view).toBe('job-list');
        expect(result.structuredContent?.signedIn).toBe(false);
        const text = result.content.map((c) => c.text).join('\n');
        expect(text).toContain(`(id ${JOB_ID})`);
        expect(text).toContain(`(id ${JOB_ID_2})`);
        const where = (h.job.findMany.mock.calls[0][0] as { where: { AND: Row[] } }).where;
        expect(where.AND[0]).toMatchObject({ isPublished: true });
        expect(h.rateLimit).toHaveBeenCalledWith(expect.any(Request), `mcp:${host}:anonymous`, MCP_RATE_LIMITS.anonymous);
    });

    it('get_job answers the job-detail view and never the employer apply link', async () => {
        const row = jobDetailRow({ applyOnPlatform: false });
        h.job.findFirst.mockResolvedValue(row);
        const { result } = await callTool(host, TOOL.getJob, { job_id: `${SITE}/jobs/fnp-${JOB_ID}` });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent?.view).toBe('job-detail');
        expect(JSON.stringify(result)).not.toContain(row.applyLink as string);
        expect(deepKeys(result)).not.toContain('applyLink');
    });

    it('get_job for a job that is gone is an isError result', async () => {
        h.job.findFirst.mockResolvedValue(null);
        const { result } = await callTool(host, TOOL.getJob, { job_id: JOB_ID });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(`This job is no longer available on ${brand.name}.`);
    });

    it('get_state_practice_authority answers the AANP tier with its source', async () => {
        const { result } = await callTool(host, TOOL.practiceAuthority, { state: 'tx' });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({ state: 'Texas', source: 'AANP State Practice Environment' });
        const unknown = await callTool(host, TOOL.practiceAuthority, { state: 'Narnia' });
        expect(unknown.result.isError).toBe(true);
    });

    it('a search refusal is an isError result with the sentence', async () => {
        const { result } = await callTool(host, TOOL.searchJobs, { city: 'Austin' });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('A city search needs the state too.');
        expect(h.job.findMany).not.toHaveBeenCalled();
    });

    it('an unexpected Prisma failure inside a tool is a generic isError result: no stack, no Prisma text', async () => {
        const failure = new Error(
            'Invalid `prisma.job.findMany()` invocation:\n\nCan\'t reach database server at `db.ytpmrlpnpbdylujbtgij.supabase.co:5432`',
        );
        failure.name = 'PrismaClientInitializationError';
        h.job.findMany.mockRejectedValue(failure);
        const { response, result } = await callTool(host, TOOL.searchJobs, { query: 'family' });
        expect(response.status).toBe(200);
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ type: 'text', text: UNEXPECTED }]);
        const serialized = JSON.stringify(result);
        for (const leak of ['prisma', 'Prisma', 'supabase', 'database', '5432', 'at ']) expect(serialized).not.toContain(leak);
        expect(h.logger.error).toHaveBeenCalled();
    });
});

// ── The HTTP edges ──────────────────────────────────────────────────────────

describe.each(HOSTS)('%s endpoint: HTTP edges', (host) => {
    it('OPTIONS answers the CORS preflight at once', async () => {
        const response = await send(host, mcpRequest(host, { method: 'OPTIONS' }));
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
        const allowed = (response.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
        for (const header of ['authorization', 'content-type', 'mcp-protocol-version', 'mcp-session-id']) expect(allowed).toContain(header);
        expect(response.headers.get('Access-Control-Expose-Headers')).toContain('WWW-Authenticate');
        expect(h.verify).not.toHaveBeenCalled();
        expect(h.rateLimit).not.toHaveBeenCalled();
    });

    it(`a body over ${MAX_MCP_BODY_BYTES} bytes is a 413 before anything is parsed`, async () => {
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: TOOL.searchJobs, arguments: { query: 'a'.repeat(MAX_MCP_BODY_BYTES) } },
        });
        const response = await send(host, mcpRequest(host, { body }));
        expect(response.status).toBe(413);
        const message = (await response.json()) as JsonRpcMessage;
        expect(message.error?.code).toBe(-32600);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(h.job.findMany).not.toHaveBeenCalled();
    });

    it('the cap counts bytes, not characters', async () => {
        const characters = Math.floor(MAX_MCP_BODY_BYTES / 2) + 100;
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'é'.repeat(characters) } });
        expect(body.length).toBeLessThan(MAX_MCP_BODY_BYTES);
        expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(MAX_MCP_BODY_BYTES);
        const response = await send(host, mcpRequest(host, { body }));
        expect(response.status).toBe(413);
    });

    it('a body under the cap is served', async () => {
        const { response, message } = await rpc(host, 'ping', { pad: 'a'.repeat(1024) });
        expect(response.status).toBe(200);
        expect(message.error).toBeUndefined();
    });

    it('invalid JSON is a -32700 parse error', async () => {
        const response = await send(host, mcpRequest(host, { body: '{"jsonrpc": "2.0", "id": 1, "method": ' }));
        expect(response.status).toBe(400);
        const message = (await response.json()) as JsonRpcMessage;
        expect(message.error?.code).toBe(-32700);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('a signed-out caller over the per-IP budget gets the 429, with CORS', async () => {
        h.rateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '20' } }));
        const response = await send(
            host,
            mcpRequest(host, { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }),
        );
        expect(response.status).toBe(429);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(response.headers.get('Retry-After')).toBe('20');
    });
});

// ── Regressions ─────────────────────────────────────────────────────────────

// A tools/call whose name is an Object.prototype member ('constructor',
// 'toString') used to reach `needed.every` with a function and throw outside
// handleMcpRequest's try block, so Next.js answered a bare 500 with no CORS
// headers (see tests/mcp/auth.test.ts). Expected: the SDK's own "tool not
// found" JSON-RPC error.
it('/mcp answers a signed-in tools/call named "constructor" instead of throwing', async () => {
    const response = await send(
        'claude',
        mcpRequest('claude', {
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'constructor', arguments: {} } }),
            headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-protocol-version': PROTOCOL },
        }),
    );
    expect(response.status).toBe(200);
    const [message] = await readMessages(response);
    expect(message.error ?? (message.result as { isError?: boolean } | undefined)?.isError).toBeTruthy();
});
