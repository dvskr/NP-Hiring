/**
 * MCP budgets. The finding these pin: a signed-out caller chooses its own
 * openai/subject, so if the subject picked the bucket, a fresh value per
 * call would mean no limit at all. The IP is always charged; a subject only
 * adds a second, tighter bucket.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/config/brand';

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit }));

import { checkRequestBudget, checkToolBudget } from '@/lib/mcp/server/rate-limits';
import type { ToolContext } from '@/lib/mcp/server/types';

function anonymous(meta?: Record<string, unknown>): ToolContext {
  return { endpoint: 'candidate', access: null, baseUrl: brand.baseUrl, ip: '203.0.113.9', requestMeta: meta };
}

const allowed = { success: true, reset: Date.now() + 60_000, remaining: 5 };

beforeEach(() => {
  checkRateLimit.mockReset();
  checkRateLimit.mockResolvedValue(allowed);
});

describe('signed-out tool calls', () => {
  it('are always charged to the IP, and a ChatGPT subject only adds a bucket', async () => {
    await checkToolBudget('search_jobs', anonymous({ 'openai/subject': 'fresh-1' }));
    const keys = checkRateLimit.mock.calls.map(([key]) => key);
    expect(keys).toEqual(['ratelimit:mcp:candidate:anon:ip:203.0.113.9', 'ratelimit:mcp:candidate:anon:s:fresh-1']);
  });

  it('share one IP bucket across tools, so switching tools buys nothing', async () => {
    await checkToolBudget('search_jobs', anonymous());
    await checkToolBudget('get_job', anonymous());
    expect(new Set(checkRateLimit.mock.calls.map(([key]) => key))).toEqual(new Set(['ratelimit:mcp:candidate:anon:ip:203.0.113.9']));
  });

  it('cannot buy back an exhausted IP budget with a new subject', async () => {
    checkRateLimit.mockImplementation(async (key: string) =>
      key.includes(':ip:') ? { success: false, reset: Date.now() + 30_000, remaining: 0 } : allowed,
    );
    for (const subject of ['fresh-1', 'fresh-2', 'fresh-3']) {
      const verdict = await checkToolBudget('search_jobs', anonymous({ 'openai/subject': subject }));
      expect(verdict.allowed).toBe(false);
      expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('a busy subject is refused even while the shared IP has room', async () => {
    checkRateLimit.mockImplementation(async (key: string) =>
      key.includes(':s:') ? { success: false, reset: Date.now() + 10_000, remaining: 0 } : allowed,
    );
    expect((await checkToolBudget('search_jobs', anonymous({ 'openai/subject': 'busy' }))).allowed).toBe(false);
  });
});

describe('signed-in tool calls', () => {
  it('are budgeted per account, with tighter hourly limits on writes', async () => {
    const access = {
      grantId: 'g', clientId: 'c', clientName: 'Claude', userId: 'user-fic-1', email: 'a@example.test',
      role: 'job_seeker', scopes: ['candidate'], resource: `${brand.baseUrl}/mcp`,
    };
    await checkToolBudget('submit_application', { ...anonymous(), access });
    expect(checkRateLimit).toHaveBeenCalledWith('ratelimit:mcp:candidate:submit_application:u:user-fic-1', { limit: 20, windowSeconds: 3600 });
  });

  it('bound the reviews too, since each one stores a row', async () => {
    const access = {
      grantId: 'g', clientId: 'c', clientName: 'Claude', userId: 'user-fic-1', email: 'a@example.test',
      role: 'employer', scopes: ['employer'], resource: `${brand.baseUrl}/mcp/employer`,
    };
    await checkToolBudget('preview_job_posting', { ...anonymous(), endpoint: 'employer', access });
    expect(checkRateLimit).toHaveBeenCalledWith('ratelimit:mcp:employer:preview_job_posting:u:user-fic-1', { limit: 30, windowSeconds: 3600 });
  });
});

describe('the endpoint itself', () => {
  it('meters every request per IP, whatever the method', async () => {
    const verdict = await checkRequestBudget('employer', '203.0.113.9');
    expect(verdict.allowed).toBe(true);
    expect(checkRateLimit.mock.calls[0][0]).toBe('ratelimit:mcp:employer:req:ip:203.0.113.9');
  });
});
