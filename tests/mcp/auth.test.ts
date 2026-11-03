/**
 * lib/mcp/auth.ts: who is calling an MCP endpoint, and how each host is told
 * to sign in (design section 1).
 *
 * Pinned:
 *   - no Authorization header is anonymous (the public tools answer it); a
 *     header that is not a bearer token is a 401 before anything else runs;
 *   - the token is verified for THIS endpoint's resource URL, and every
 *     verification failure is a 401 whose WWW-Authenticate names this
 *     endpoint's protected resource metadata and error="invalid_token";
 *   - a verified token becomes the principal and the SDK's authInfo with
 *     `resource` equal to the endpoint URL; the reviewer flag comes from
 *     MCP_REVIEWER_USER_IDS and nothing else;
 *   - the Claude gate: a public tool passes, a candidate tool without a token
 *     is a 401 with no error code (RFC 6750 section 3.1), a missing scope a
 *     403 insufficient_scope, and one candidate call in a batch is enough;
 *   - ChatGPT's sign-in result: isError plus `_meta["mcp/www_authenticate"]`
 *     carrying error= and error_description=;
 *   - only search_jobs, get_job and get_state_practice_authority are public.
 *
 * lib/oauth/access-token is mocked; nothing here touches a database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('@/lib/oauth/access-token', () => ({ verifyAccessToken: h.verify }));

import {
    MCP_CORS_HEADERS,
    TOOL_SCOPES,
    authenticateMcpRequest,
    bearerChallenge,
    claudeSignInGate,
    insufficientScopeResponse,
    principalFromAuthInfo,
    requiredScopes,
    signInRequiredResult,
    unauthorizedResponse,
    type McpAuthentication,
    type McpPrincipal,
} from '@/lib/mcp/auth';
import { MCP_SCOPES, mcpHostProfile } from '@/lib/mcp/config';
import { TOOL } from '@/lib/mcp/tool-names';
import { ME, SITE, dashFindings } from './fixtures';

const CLAUDE = mcpHostProfile('claude');
const CHATGPT = mcpHostProfile('chatgpt');
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl';
const EXPIRES_AT = 1_900_000_000;
const ALL_SCOPES = [...MCP_SCOPES];
const PUBLIC_TOOLS = [TOOL.searchJobs, TOOL.getJob, TOOL.practiceAuthority];
const FAILURES = ['malformed', 'invalid', 'expired', 'wrong_audience', 'revoked', 'account', 'unconfigured'] as const;

function verified(scopes: string[] = ALL_SCOPES, userId: string = ME) {
    return {
        ok: true as const,
        token: { token: TOKEN, userId, clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata', grantId: 'grant-1', scopes, resource: CLAUDE.resourceUrl, expiresAt: EXPIRES_AT },
    };
}

function request(authorization?: string): Request {
    return new Request(CLAUDE.resourceUrl, {
        method: 'POST',
        headers: authorization === undefined ? {} : { Authorization: authorization },
    });
}

function principal(scopes: McpPrincipal['scopes'] = ALL_SCOPES): McpPrincipal {
    return { userId: ME, reviewer: false, clientId: 'client-1', grantId: 'grant-1', scopes };
}

function authenticated(scopes: McpPrincipal['scopes'] = ALL_SCOPES): McpAuthentication {
    const who = principal(scopes);
    return {
        kind: 'authenticated',
        principal: who,
        authInfo: { token: TOKEN, clientId: who.clientId, scopes: [...scopes], extra: { userId: ME, grantId: 'grant-1', reviewer: false } },
    };
}

const toolCall = (name: string, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } });

let savedReviewers: string | undefined;
beforeEach(() => {
    savedReviewers = process.env.MCP_REVIEWER_USER_IDS;
    delete process.env.MCP_REVIEWER_USER_IDS;
    h.verify.mockReset().mockResolvedValue(verified());
});
afterEach(() => {
    if (savedReviewers === undefined) delete process.env.MCP_REVIEWER_USER_IDS;
    else process.env.MCP_REVIEWER_USER_IDS = savedReviewers;
});

async function rejection(result: Promise<McpAuthentication>): Promise<Response> {
    const auth = await result;
    if (auth.kind !== 'rejected') throw new Error(`expected a rejection, got ${auth.kind}`);
    return auth.response;
}

// ── authenticateMcpRequest ──────────────────────────────────────────────────

describe('authenticateMcpRequest: no token', () => {
    it.each([
        ['no Authorization header', undefined],
        ['an empty header', ''],
        ['a blank header', '   '],
    ])('%s is anonymous, and no token is verified', async (_label, header) => {
        expect(await authenticateMcpRequest(request(header), CLAUDE)).toEqual({ kind: 'anonymous' });
        expect(h.verify).not.toHaveBeenCalled();
    });
});

describe('authenticateMcpRequest: a header that is not a bearer token', () => {
    it.each([
        ['Basic credentials', 'Basic dXNlcjpwYXNz'],
        ['a bare scheme', 'Bearer'],
        ['a scheme and a space', 'Bearer '],
        ['two tokens', `Bearer ${TOKEN} ${TOKEN}`],
        ['a token with a comma', `Bearer ${TOKEN},extra`],
        ['a token with a quote', 'Bearer "abc"'],
        ['another scheme', `Token ${TOKEN}`],
        ['a scheme glued to the token', `Bearer${TOKEN}`],
    ])('%s is a 401 invalid_token, and nothing is verified', async (_label, header) => {
        const response = await rejection(authenticateMcpRequest(request(header), CLAUDE));
        expect(response.status).toBe(401);
        const challenge = response.headers.get('WWW-Authenticate') ?? '';
        expect(challenge).toContain(`resource_metadata="${CLAUDE.resourceMetadataUrl}"`);
        expect(challenge).toContain('error="invalid_token"');
        expect(h.verify).not.toHaveBeenCalled();
    });

    it('the scheme is case insensitive (RFC 6750 uses RFC 7235 auth-scheme)', async () => {
        const auth = await authenticateMcpRequest(request(`bearer ${TOKEN}`), CLAUDE);
        expect(auth.kind).toBe('authenticated');
        expect(h.verify).toHaveBeenCalledWith(TOKEN, CLAUDE.resourceUrl);
    });
});

describe('authenticateMcpRequest: verification', () => {
    it.each([
        ['Claude', CLAUDE],
        ['ChatGPT', CHATGPT],
    ])('the %s endpoint verifies the token for its own resource URL', async (_label, profile) => {
        await authenticateMcpRequest(request(`Bearer ${TOKEN}`), profile);
        expect(h.verify).toHaveBeenCalledTimes(1);
        expect(h.verify).toHaveBeenCalledWith(TOKEN, profile.resourceUrl);
    });

    for (const profile of [CLAUDE, CHATGPT]) {
        it.each([...FAILURES])(`%s on ${profile.path}: 401, invalid_token, this endpoint's metadata`, async (reason) => {
            h.verify.mockResolvedValue({ ok: false, reason });
            const response = await rejection(authenticateMcpRequest(request(`Bearer ${TOKEN}`), profile));
            expect(response.status).toBe(401);
            const challenge = response.headers.get('WWW-Authenticate') ?? '';
            expect(challenge.startsWith('Bearer ')).toBe(true);
            expect(challenge).toContain(`resource_metadata="${profile.resourceMetadataUrl}"`);
            expect(challenge).toContain('error="invalid_token"');
            expect(challenge).toContain('error_description="');
            const other = profile.id === 'claude' ? CHATGPT : CLAUDE;
            expect(challenge).not.toContain(other.resourceMetadataUrl + '"');
            const body = (await response.json()) as { error: string; error_description: string };
            expect(body.error).toBe('invalid_token');
            expect(body.error_description.length).toBeGreaterThan(0);
            expect(response.headers.get('Cache-Control')).toBe('no-store');
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
            expect(response.headers.get('Access-Control-Expose-Headers')).toContain('WWW-Authenticate');
        });
    }
});

describe('authenticateMcpRequest: a verified token', () => {
    it("builds the principal and the SDK authInfo, with resource equal to this endpoint's URL", async () => {
        const auth = await authenticateMcpRequest(request(`Bearer ${TOKEN}`), CHATGPT);
        if (auth.kind !== 'authenticated') throw new Error(auth.kind);
        expect(auth.principal).toEqual({
            userId: ME,
            reviewer: false,
            clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
            grantId: 'grant-1',
            scopes: ALL_SCOPES,
        });
        expect(auth.authInfo.token).toBe(TOKEN);
        expect(auth.authInfo.clientId).toBe('https://claude.ai/oauth/mcp-oauth-client-metadata');
        expect(auth.authInfo.scopes).toEqual(ALL_SCOPES);
        expect(auth.authInfo.expiresAt).toBe(EXPIRES_AT);
        expect(auth.authInfo.resource?.href).toBe(CHATGPT.resourceUrl);
        expect(auth.authInfo.resourceMetadataUrl).toBe(CHATGPT.resourceMetadataUrl);
        expect(auth.authInfo.extra).toEqual({ userId: ME, grantId: 'grant-1', reviewer: false });
    });

    it('the reviewer flag comes from MCP_REVIEWER_USER_IDS', async () => {
        process.env.MCP_REVIEWER_USER_IDS = ` someone, ${ME} ,other `;
        const reviewer = await authenticateMcpRequest(request(`Bearer ${TOKEN}`), CLAUDE);
        if (reviewer.kind !== 'authenticated') throw new Error(reviewer.kind);
        expect(reviewer.principal.reviewer).toBe(true);
        expect(reviewer.authInfo.extra?.reviewer).toBe(true);

        process.env.MCP_REVIEWER_USER_IDS = 'someone,other';
        const candidate = await authenticateMcpRequest(request(`Bearer ${TOKEN}`), CLAUDE);
        if (candidate.kind !== 'authenticated') throw new Error(candidate.kind);
        expect(candidate.principal.reviewer).toBe(false);

        delete process.env.MCP_REVIEWER_USER_IDS;
        const unset = await authenticateMcpRequest(request(`Bearer ${TOKEN}`), CLAUDE);
        if (unset.kind !== 'authenticated') throw new Error(unset.kind);
        expect(unset.principal.reviewer).toBe(false);
    });
});

describe('principalFromAuthInfo', () => {
    it('reads back what authenticateMcpRequest put on authInfo', async () => {
        const auth = await authenticateMcpRequest(request(`Bearer ${TOKEN}`), CLAUDE);
        if (auth.kind !== 'authenticated') throw new Error(auth.kind);
        expect(principalFromAuthInfo(auth.authInfo)).toEqual(auth.principal);
    });

    it('null without authInfo or without the ids; unknown scopes are dropped; reviewer only when exactly true', () => {
        expect(principalFromAuthInfo(undefined)).toBeNull();
        expect(principalFromAuthInfo({ token: TOKEN, clientId: 'c', scopes: [] })).toBeNull();
        expect(principalFromAuthInfo({ token: TOKEN, clientId: 'c', scopes: [], extra: { userId: ME } })).toBeNull();
        expect(
            principalFromAuthInfo({
                token: TOKEN,
                clientId: 'c',
                scopes: ['applications:read', 'admin', 'offline_access'],
                extra: { userId: ME, grantId: 'g', reviewer: 'true' },
            }),
        ).toEqual({ userId: ME, grantId: 'g', reviewer: false, clientId: 'c', scopes: ['applications:read'] });
    });
});

// ── The Claude gate ─────────────────────────────────────────────────────────

describe('claudeSignInGate', () => {
    it.each(PUBLIC_TOOLS)('the public tool %s passes without a token', (name) => {
        expect(claudeSignInGate(toolCall(name), { kind: 'anonymous' }, CLAUDE)).toBeNull();
    });

    it.each(['initialize', 'tools/list', 'resources/list', 'resources/read', 'ping'])('%s passes without a token', (method) => {
        expect(claudeSignInGate({ jsonrpc: '2.0', id: 1, method, params: {} }, { kind: 'anonymous' }, CLAUDE)).toBeNull();
    });

    it('an unknown tool is left to the SDK to refuse', () => {
        expect(claudeSignInGate(toolCall('delete_everything'), { kind: 'anonymous' }, CLAUDE)).toBeNull();
    });

    it.each(Object.keys(TOOL_SCOPES))('the candidate tool %s without a token: 401 with a challenge and no error code', async (name) => {
        const response = claudeSignInGate(toolCall(name), { kind: 'anonymous' }, CLAUDE);
        expect(response?.status).toBe(401);
        const challenge = response?.headers.get('WWW-Authenticate') ?? '';
        expect(challenge).toBe(`Bearer resource_metadata="${CLAUDE.resourceMetadataUrl}", scope="${MCP_SCOPES.join(' ')}"`);
        expect(challenge).not.toContain('error=');
    });

    it('a token without a scope the tool needs: 403 insufficient_scope', async () => {
        const response = claudeSignInGate(toolCall(TOOL.submitApplication), authenticated(['profile:read', 'applications:read']), CLAUDE);
        expect(response?.status).toBe(403);
        const challenge = response?.headers.get('WWW-Authenticate') ?? '';
        expect(challenge).toContain(`resource_metadata="${CLAUDE.resourceMetadataUrl}"`);
        expect(challenge).toContain('error="insufficient_scope"');
        expect(challenge).toContain(`scope="${MCP_SCOPES.join(' ')}"`);
        expect(((await response?.json()) as { error: string }).error).toBe('insufficient_scope');
    });

    it('a token with every scope the tool needs passes', () => {
        expect(claudeSignInGate(toolCall(TOOL.listApplications), authenticated(['applications:read']), CLAUDE)).toBeNull();
        expect(claudeSignInGate(toolCall(TOOL.startApplication), authenticated(['profile:read', 'applications:read']), CLAUDE)).toBeNull();
        expect(claudeSignInGate(toolCall(TOOL.startApplication), authenticated(['applications:read']), CLAUDE)?.status).toBe(403);
    });

    it('a batch with one candidate call among public ones is refused as a whole', () => {
        const batch = [toolCall(TOOL.searchJobs, 1), toolCall(TOOL.getJob, 2), toolCall(TOOL.listApplications, 3)];
        expect(claudeSignInGate(batch, { kind: 'anonymous' }, CLAUDE)?.status).toBe(401);
        expect(claudeSignInGate(batch.slice(0, 2), { kind: 'anonymous' }, CLAUDE)).toBeNull();
    });

    it('a body that is not a JSON-RPC call is left to the SDK', () => {
        for (const body of [null, 42, 'tools/call', [], [null], { method: 'tools/call' }, { method: 'tools/call', params: { name: 7 } }]) {
            expect(claudeSignInGate(body, { kind: 'anonymous' }, CLAUDE)).toBeNull();
        }
    });
});

// ── Responses and ChatGPT's sign-in result ──────────────────────────────────

describe('challenge responses', () => {
    it('unauthorizedResponse without a failure has no error code; with one, invalid_token', () => {
        expect(unauthorizedResponse(CLAUDE).headers.get('WWW-Authenticate')).not.toContain('error=');
        expect(unauthorizedResponse(CLAUDE, 'expired').headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
    });

    it('every response carries the MCP CORS headers and no-store', () => {
        for (const response of [unauthorizedResponse(CHATGPT), unauthorizedResponse(CHATGPT, 'revoked'), insufficientScopeResponse(CHATGPT)]) {
            for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) expect(response.headers.get(name)).toBe(value);
            expect(response.headers.get('Cache-Control')).toBe('no-store');
            expect(response.headers.get('Content-Type')).toBe('application/json');
        }
    });

    it('bearerChallenge: the metadata URL and the full scope set always, the error parts only when given', () => {
        expect(bearerChallenge(CHATGPT)).toBe(
            `Bearer resource_metadata="${CHATGPT.resourceMetadataUrl}", scope="profile:read applications:read applications:write"`,
        );
        expect(bearerChallenge(CHATGPT, { error: 'invalid_request', description: 'Bad request' })).toBe(
            `Bearer resource_metadata="${CHATGPT.resourceMetadataUrl}", scope="profile:read applications:read applications:write", error="invalid_request", error_description="Bad request"`,
        );
    });

    it('challenge descriptions follow the copy rule and hold no quote or backslash', () => {
        const texts: Record<string, string> = {};
        const challenges = [
            ...FAILURES.map((failure) => unauthorizedResponse(CLAUDE, failure).headers.get('WWW-Authenticate') ?? ''),
            insufficientScopeResponse(CLAUDE).headers.get('WWW-Authenticate') ?? '',
            ...((signInRequiredResult(CHATGPT, false)._meta?.['mcp/www_authenticate'] as string[]) ?? []),
            ...((signInRequiredResult(CHATGPT, true)._meta?.['mcp/www_authenticate'] as string[]) ?? []),
        ];
        for (const [index, challenge] of challenges.entries()) {
            const description = /error_description="([^"]*)"/.exec(challenge)?.[1] ?? '';
            expect(description.length, challenge).toBeGreaterThan(0);
            expect(description).not.toMatch(/["\\]/);
            texts[`challenge ${index}`] = description;
        }
        expect(dashFindings(texts)).toEqual([]);
    });
});

describe('signInRequiredResult (ChatGPT)', () => {
    it.each([
        ['signed out', false],
        ['missing a scope', true],
    ])('%s: isError with one challenge carrying error= and error_description=', (_label, insufficientScope) => {
        const result = signInRequiredResult(CHATGPT, insufficientScope);
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
        const challenges = result._meta?.['mcp/www_authenticate'];
        expect(Array.isArray(challenges)).toBe(true);
        expect(challenges).toHaveLength(1);
        const [challenge] = challenges as string[];
        expect(challenge.startsWith('Bearer ')).toBe(true);
        expect(challenge).toContain(`resource_metadata="${CHATGPT.resourceMetadataUrl}"`);
        expect(challenge).toMatch(/error="[a-z_]+"/);
        expect(challenge).toMatch(/error_description="[^"]+"/);
        expect(challenge).toContain(`scope="${MCP_SCOPES.join(' ')}"`);
    });

    it('names the ChatGPT metadata document, never the Claude one', () => {
        const [challenge] = signInRequiredResult(CHATGPT, false)._meta?.['mcp/www_authenticate'] as string[];
        expect(challenge).toContain(`${SITE}/.well-known/oauth-protected-resource/mcp/chatgpt"`);
        expect(challenge).not.toContain(`${SITE}/.well-known/oauth-protected-resource/mcp"`);
    });
});

// ── Which tools are public ──────────────────────────────────────────────────

describe('tool scopes', () => {
    it('only search_jobs, get_job and get_state_practice_authority are public; every other tool needs a scope', () => {
        const publicTools = Object.values(TOOL).filter((name) => requiredScopes(name) === null);
        expect(publicTools.sort()).toEqual([...PUBLIC_TOOLS].sort());
    });

    it('reads need a read scope, writes need applications:write', () => {
        expect(requiredScopes(TOOL.listApplications)).toEqual(['applications:read']);
        expect(requiredScopes(TOOL.listSavedJobs)).toEqual(['applications:read']);
        expect(requiredScopes(TOOL.profileStatus)).toEqual(['profile:read']);
        expect(requiredScopes(TOOL.startApplication)).toEqual(['profile:read', 'applications:read']);
        for (const name of [TOOL.submitApplication, TOOL.trackEmployerSiteApplication, TOOL.withdrawApplication, TOOL.saveJob, TOOL.unsaveJob]) {
            expect(requiredScopes(name), name).toEqual(['applications:write']);
        }
    });

    it('requiredScopes is null for a name that is not a tool', () => {
        expect(requiredScopes('delete_everything')).toBeNull();
        expect(requiredScopes('')).toBeNull();
    });

    // Regression: TOOL_SCOPES is a plain object literal, so `TOOL_SCOPES[name]`
    // returned the Object.prototype member for 'toString', 'constructor',
    // '__proto__' or 'hasOwnProperty'. claudeSignInGate then challenged
    // anonymous callers for a tool that does not exist, and a signed-in caller
    // made `needed.every` throw outside the handler's try block. requiredScopes
    // now reads own keys only (Object.hasOwn).
    it('a tool name that is an Object.prototype member is not a candidate tool', () => {
        for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
            expect(requiredScopes(name), name).toBeNull();
        }
    });

    it('the Claude gate lets such a name through to the SDK instead of challenging or throwing', () => {
        expect(claudeSignInGate(toolCall('toString'), { kind: 'anonymous' }, CLAUDE)).toBeNull();
        expect(() => claudeSignInGate(toolCall('constructor'), authenticated(), CLAUDE)).not.toThrow();
    });
});
