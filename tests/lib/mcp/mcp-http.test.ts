/**
 * The job seeker MCP endpoint over HTTP, through the real SDK transport.
 *
 * Pins what the directories check and what each host needs to start
 * sign-in:
 *  - every tool has a title and explicit read-only, destructive and
 *    open-world hints, and widget tools point at a ui:// resource served as
 *    text/html;profile=mcp-app with an empty CSP;
 *  - ChatGPT's securitySchemes are on every tool, and ChatGPT is offered
 *    every tool any other host is;
 *  - a signed-out call to an account tool is an HTTP 401 with
 *    resource_metadata (Claude), unless it carries ChatGPT's openai/* call
 *    metadata, which gets the mcp/www_authenticate tool result instead;
 *  - search never pins paid listings.
 *
 * The board's name, host and namespace are the active pack's. All fixtures
 * are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { brand } from '@/config/brand';
import { MCP_PREFIX } from '@/lib/mcp/prefix';
import { escapeRegExp } from '../../helpers/mcp-board';

const { verifyAccessToken, checkRateLimit } = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  checkRateLimit: vi.fn<(key: string, config: unknown) => Promise<{ success: boolean; reset: number; remaining: number }>>(
    async () => ({ success: true, reset: Date.now() + 60_000, remaining: 10 }),
  ),
}));
vi.mock('@/lib/mcp/oauth/tokens', () => ({ verifyAccessToken }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { handleMcpRequest } from '@/lib/mcp/server/http-handler';
import { CANDIDATE_ENDPOINT } from '@/lib/mcp/endpoints/candidate';
import { RESOURCE_MIME_TYPE } from '@/lib/mcp/widgets/resources';

/** JSON-RPC payloads, asserted structurally by each test. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = any;

const MCP_URL = `${brand.baseUrl}/mcp`;
/** The board's name as the server's id: lower case, every other run of characters one hyphen. */
const SERVER_ID = brand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

let nextId = 1;
function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}): Request {
  return new Request(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
}

async function json(response: Response): Promise<Payload> {
  return JSON.parse(await response.text());
}

beforeEach(() => {
  verifyAccessToken.mockReset();
  vi.mocked(logger.warn).mockClear();
});

describe('discovery', () => {
  it('initialize answers signed out with server info and instructions', async () => {
    const res = await handleMcpRequest(
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      }),
      CANDIDATE_ENDPOINT,
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.result.serverInfo.name).toBe(SERVER_ID);
    expect(body.result.serverInfo.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(body.result.serverInfo.version).toBe('1.0.0');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.capabilities.resources).toBeDefined();
    expect(body.result.instructions).toMatch(/submit_application with the review_id it returned, only after they clearly confirm/);
  });

  it('ChatGPT is offered every tool but the guides, which its directory does not allow', async () => {
    const names = async (headers: Record<string, string>): Promise<string[]> => {
      const listed = await json(await handleMcpRequest(rpc('tools/list', {}, headers), CANDIDATE_ENDPOINT));
      return (listed.result.tools as Array<Payload>).map((t) => t.name as string).sort();
    };
    const chatgpt = await names({ 'user-agent': 'openai-mcp/1.0.0' });
    expect(chatgpt).toContain('search_articles');
    expect(chatgpt).not.toContain('find_guides');
    expect(chatgpt).toEqual(CANDIDATE_ENDPOINT.tools.filter((t) => !t.notOnChatGpt).map((t) => t.name).sort());
    expect(await names({})).toEqual(CANDIDATE_ENDPOINT.tools.map((t) => t.name).sort());
  });

  it('tools/list carries titles, hints, widget metadata and securitySchemes on every tool', async () => {
    const res = await handleMcpRequest(rpc('tools/list'), CANDIDATE_ENDPOINT);
    const { result } = await json(res);
    const tools = result.tools as Array<Payload>;
    expect(tools.map((t) => t.name).sort()).toEqual(CANDIDATE_ENDPOINT.tools.map((t) => t.name).sort());
    for (const tool of tools) {
      expect(tool.name.length).toBeLessThanOrEqual(64);
      expect(tool.title).toBeTruthy();
      expect(tool.annotations.title).toBeTruthy();
      for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) {
        expect(typeof tool.annotations[hint], `${tool.name} ${hint}`).toBe('boolean');
      }
      expect(Array.isArray(tool.securitySchemes)).toBe(true);
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
    }
    const search = tools.find((t) => t.name === 'search_jobs')!;
    expect(search._meta.ui.resourceUri).toMatch(new RegExp(`^ui://${escapeRegExp(MCP_PREFIX)}/jobs\\.[a-f0-9]{12}\\.html$`));
    expect(search._meta['openai/outputTemplate']).toBe(search._meta.ui.resourceUri);
    expect(search.securitySchemes).toEqual([{ type: 'noauth' }, { type: 'oauth2', scopes: ['candidate'] }]);
    const submit = tools.find((t) => t.name === 'submit_application')!;
    expect(submit.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['candidate'] }]);
    expect(submit.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  });

  it('serves each widget as a self-contained MCP App with an empty CSP', async () => {
    const list = await json(await handleMcpRequest(rpc('resources/list'), CANDIDATE_ENDPOINT));
    const resources = list.result.resources as Array<Payload>;
    expect(resources.length).toBeGreaterThanOrEqual(5);
    for (const resource of resources) expect(resource.mimeType).toBe(RESOURCE_MIME_TYPE);

    const uri = resources.find((r) => r.uri.includes('/jobs.'))!.uri;
    const read = await json(await handleMcpRequest(rpc('resources/read', { uri }), CANDIDATE_ENDPOINT));
    const content = read.result.contents[0];
    expect(content.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(content.text).toContain('<div id="pm-root"');
    expect(content.text).not.toMatch(/<script[^>]+src=/);
    expect(content.text).not.toMatch(/<link[^>]+href=/);
    expect(content._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [] });
    // Claude rejects any ui.domain that is not its own hash format.
    expect(content._meta.ui.domain).toBeUndefined();
    expect(content._meta['openai/widgetDomain']).toMatch(/^https?:\/\//);
  });
});

describe('sign-in signals', () => {
  it('a signed-out account tool call is an HTTP 401 that points at the resource metadata', async () => {
    const res = await handleMcpRequest(rpc('tools/call', { name: 'prepare_application', arguments: { job_id: 'x' } }), CANDIDATE_ENDPOINT);
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toMatch(/resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
  });

  it('the same call from ChatGPT gets a tool result carrying mcp/www_authenticate', async () => {
    const res = await handleMcpRequest(
      rpc('tools/call', { name: 'prepare_application', arguments: { job_id: 'x' }, _meta: { 'openai/subject': 'anon-fic' } }),
      CANDIDATE_ENDPOINT,
    );
    expect(res.status).toBe(200);
    const { result } = await json(res);
    expect(result.isError).toBe(true);
    const challenge = result._meta['mcp/www_authenticate'][0] as string;
    expect(challenge).toMatch(/error="insufficient_scope"/);
    expect(challenge).toMatch(/error_description="/);
  });

  it('a bad token is a 401 with error="invalid_token", even on a public tool', async () => {
    verifyAccessToken.mockResolvedValue({ ok: false, reason: 'expired' });
    const res = await handleMcpRequest(
      rpc('tools/call', { name: 'search_jobs', arguments: {} }, { authorization: `Bearer ${MCP_PREFIX}_at_stale` }),
      CANDIDATE_ENDPOINT,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);
  });

  it('a token without the scope is a 403 insufficient_scope', async () => {
    verifyAccessToken.mockResolvedValue({ ok: false, reason: 'insufficient_scope' });
    const res = await handleMcpRequest(rpc('tools/list', {}, { authorization: `Bearer ${MCP_PREFIX}_at_x` }), CANDIDATE_ENDPOINT);
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toMatch(/error="insufficient_scope"/);
  });
});

describe('transport edges', () => {
  it('GET has no stream to open in stateless mode', async () => {
    const res = await handleMcpRequest(new Request(MCP_URL, { method: 'GET' }), CANDIDATE_ENDPOINT);
    expect(res.status).toBe(405);
  });

  it('a body that is not JSON is a JSON-RPC parse error', async () => {
    const res = await handleMcpRequest(
      new Request(MCP_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' }),
      CANDIDATE_ENDPOINT,
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe(-32700);
  });

  it('a request the transport refuses is logged with its method and protocol version, never its arguments', async () => {
    const res = await handleMcpRequest(
      rpc('tools/call', { name: 'search_jobs', arguments: { query: 'private words' } }, { 'mcp-protocol-version': '2099-01-01' }),
      CANDIDATE_ENDPOINT,
    );
    expect(res.status).toBe(400);
    const refusals = vi.mocked(logger.warn).mock.calls.filter(([message]) => /refused/.test(String(message)));
    expect(refusals).toHaveLength(1);
    expect(refusals[0][1]).toMatchObject({
      endpoint: 'candidate',
      status: 400,
      methods: ['tools/call'],
      protocolVersion: '2099-01-01',
      reason: expect.stringMatching(/protocol version/i),
    });
    expect(JSON.stringify(refusals[0][1])).not.toContain('private words');
  });

  it('clips the method name and the version header, which the caller chooses', async () => {
    await handleMcpRequest(rpc('x'.repeat(500), {}, { 'mcp-protocol-version': 'v'.repeat(500) }), CANDIDATE_ENDPOINT);
    const context = vi.mocked(logger.warn).mock.calls.find(([message]) => /refused/.test(String(message)))![1] as {
      methods: string[];
      protocolVersion: string;
    };
    expect(context.methods[0].length).toBeLessThanOrEqual(80);
    expect(context.protocolVersion.length).toBeLessThanOrEqual(80);
  });

  it('a body that is not JSON is logged as refused too, and an answered request is not', async () => {
    await handleMcpRequest(
      new Request(MCP_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' }),
      CANDIDATE_ENDPOINT,
    );
    const refusals = () => vi.mocked(logger.warn).mock.calls.filter(([message]) => /refused/.test(String(message)));
    expect(refusals()).toHaveLength(1);
    expect(refusals()[0][1]).toMatchObject({ status: 400, methods: [], reason: expect.stringMatching(/not valid JSON/) });

    vi.mocked(logger.warn).mockClear();
    expect((await handleMcpRequest(rpc('tools/list'), CANDIDATE_ENDPOINT)).status).toBe(200);
    expect(refusals()).toHaveLength(0);
  });

  it('an IP over its request budget is refused before anything is parsed or looked up', async () => {
    checkRateLimit.mockResolvedValueOnce({ success: false, reset: Date.now() + 20_000, remaining: 0 });
    const res = await handleMcpRequest(
      new Request(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${MCP_PREFIX}_at_x`, 'x-forwarded-for': '203.0.113.7' },
        body: '{bad',
      }),
      CANDIDATE_ENDPOINT,
    );
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(checkRateLimit.mock.calls.at(-1)![0]).toBe('ratelimit:mcp:candidate:req:ip:203.0.113.7');
  });

  it('refuses a body over 128 KB', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(130 * 1024) } });
    const res = await handleMcpRequest(
      new Request(MCP_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
      CANDIDATE_ENDPOINT,
    );
    expect(res.status).toBe(413);
  });
});

describe('search_jobs', () => {
  it('answers signed out, newest first, with ids the model can act on', async () => {
    const row = {
      id: '11111111-2222-4333-8444-555555555555',
      slug: 'psychiatric-nurse-practitioner-11111111-2222-4333-8444-555555555555',
      title: 'Psychiatric Nurse Practitioner',
      employer: 'Fictional Behavioral Health',
      location: 'Austin, TX',
      city: 'Austin',
      state: 'Texas',
      stateCode: 'TX',
      isRemote: false,
      isHybrid: false,
      mode: 'In-Person',
      jobType: 'Full-Time',
      displaySalary: '$150k-$180k/yr',
      normalizedMinSalary: 150000,
      normalizedMaxSalary: 180000,
      salaryRange: null,
      salaryPeriod: 'annual',
      minSalary: 150000,
      maxSalary: 180000,
      originalPostedAt: new Date('2026-10-20T00:00:00Z'),
      createdAt: new Date('2026-10-20T00:00:00Z'),
      experienceLabel: '2-4 yrs',
      newGradFriendly: false,
      applyOnPlatform: true,
    };
    vi.mocked(prisma.job.findMany).mockResolvedValue([row] as never);
    vi.mocked(prisma.job.count).mockResolvedValue(1 as never);

    const res = await handleMcpRequest(
      rpc('tools/call', { name: 'search_jobs', arguments: { job_location: 'TX', work_mode: ['onsite'] } }),
      CANDIDATE_ENDPOINT,
    );
    expect(res.status).toBe(200);
    const { result } = await json(res);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.view).toBe('jobs');
    expect(result.structuredContent.jobs[0]).toMatchObject({ id: row.id, easyApply: true, location: 'Austin, TX' });
    expect(result.content[0].text).toContain(`id: ${row.id}`);

    // The search's own read is the one that carries an order; the cards are then read by id.
    const call = vi.mocked(prisma.job.findMany).mock.calls.map(([args]) => args as { orderBy?: unknown }).findLast((args) => args.orderBy !== undefined)!;
    const order = JSON.stringify(call.orderBy);
    expect(order).not.toContain('employerJobs');
    expect(order).not.toContain('isFeatured');
  });

  it('searches on the first five keywords only, however many a signed-out caller sends', async () => {
    vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.job.count).mockResolvedValue(0 as never);
    const query = 'telehealth adult outpatient evenings weekends spanish bilingual remote';
    const res = await handleMcpRequest(rpc('tools/call', { name: 'search_jobs', arguments: { query } }), CANDIDATE_ENDPOINT);
    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.job.findMany).mock.calls.at(-1)![0] as { where: unknown };
    const where = JSON.stringify(call.where);
    for (const term of ['telehealth', 'adult', 'outpatient', 'evenings', 'weekends']) {
      expect(where).toContain(`"contains":"${term}"`);
    }
    expect(where).not.toContain('"contains":"spanish"');
    expect(where).not.toContain('"contains":"bilingual"');
  });
});
