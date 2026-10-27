/**
 * The invoice and receipt links open with the post's dashboard token only
 * (security review LOW-1, 2026-10-27).
 *
 * Both routes also took the post's edit token, with no time limit, while the
 * edit form and the save refuse an edit token 30 days after the post expires
 * (lib/edit-token-window.ts). No caller sends the edit token: the paid post
 * and renewal emails and the dashboard link with the dashboard token, and
 * Settings uses the session. So a leaked edit token (an address bar, a
 * history, a log) no longer opens the post's billing documents, which carry
 * the buyer's billing name and address.
 *
 * Pinned, for both routes: a token request matches the dashboard token alone,
 * and a token that matches nothing answers 404.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/invoice-generator', () => ({ generateInvoice: vi.fn() }));

const ROUTES = [
    ['invoice', '@/app/api/employer/invoice/route'],
    ['receipt', '@/app/api/employer/receipt/route'],
] as const;

// Load both route graphs once, outside any single test's time budget.
beforeAll(async () => {
    for (const [, mod] of ROUTES) await import(mod);
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
});

async function getWithToken(name: string, mod: string, token: string): Promise<Response> {
    const { GET } = await import(mod) as { GET: (request: NextRequest) => Promise<Response> };
    return GET(new NextRequest(`https://test.local/api/employer/${name}?jobId=job-1&token=${token}`));
}

describe.each(ROUTES)('GET /api/employer/%s with a token', (name, mod) => {
    it('matches the dashboard token alone, never the edit token', async () => {
        await getWithToken(name, mod, 'a'.repeat(64));

        expect(prisma.employerJob.findFirst).toHaveBeenCalledTimes(1);
        const where = (vi.mocked(prisma.employerJob.findFirst).mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect(where).toEqual({ jobId: 'job-1', dashboardToken: 'a'.repeat(64) });
        expect(JSON.stringify(where)).not.toContain('editToken');
    });

    it('answers 404 for a token that matches no post, an edit token among them', async () => {
        const res = await getWithToken(name, mod, 'b'.repeat(64));

        expect(res.status).toBe(404);
    });
});
