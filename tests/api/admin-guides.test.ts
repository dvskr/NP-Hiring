/**
 * The guides store back office API (register 2.35): GET /api/admin/guides and
 * POST /api/admin/guides/:id/rotate.
 *
 * Pinned, with the real admin gate and the real CSRF check:
 *   - both answer 401 signed out and 403 for an account that is not an
 *     admin, before a purchase is read or written; the POST refuses a
 *     cross-site request;
 *   - the list never carries an access token, reads newest first and
 *     bounded, and filters by email in any case (trimmed);
 *   - a rotation writes a fresh 48 hex token with emailSentAt null in one
 *     update, then claims the send on that token, sends the new link and
 *     reports when it went; a failed send puts emailSentAt back to null;
 *   - an unknown id answers 404 and a purchase without an email rotates and
 *     reports 'no-address' without a send;
 *   - no log line or audit entry carries the token or the reader's email.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { ADMIN_GUIDE_PURCHASE_SELECT, MAX_ADMIN_GUIDE_PURCHASES_LISTED } from '@/lib/guides/admin';
import { MAX_DOWNLOADS_PER_PURCHASE } from '@/lib/guides/access';

const session = vi.hoisted(() => ({ user: { id: 'admin-supabase-id' } as { id: string } | null }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: vi.fn(async () => ({ data: { user: session.user }, error: null })) } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { admin: { limit: 20, windowMs: 60_000 } },
}));
const logAudit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/audit-log', () => ({ logAudit }));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/guides/email', () => ({ sendGuidePurchaseEmail: vi.fn() }));

import { sendGuidePurchaseEmail } from '@/lib/guides/email';
import { GET } from '@/app/api/admin/guides/route';
import { POST } from '@/app/api/admin/guides/[id]/rotate/route';

const gp = prisma.guidePurchase as unknown as Record<string, ReturnType<typeof vi.fn>>;
const OLD_TOKEN = 'a'.repeat(48);
const READER = 'reader@example.com';
const TOKEN_PATTERN = /^[0-9a-f]{48}$/;
const SAME_SITE = { origin: brand.baseUrl };

function row(overrides: Record<string, unknown> = {}) {
    return {
        id: 'gp_1',
        source: 'stripe',
        stripeSessionId: 'cs_test_abcdefghij',
        stripePaymentIntentId: 'pi_1',
        email: READER,
        userId: null,
        productSlug: 'career-bundle',
        guideSlugs: ['first-year-playbook', 'interview-prep-pack', 'negotiate-like-an-np'],
        amountCents: 4900,
        currency: 'usd',
        accessToken: OLD_TOKEN,
        downloadCount: 4,
        emailSentAt: new Date('2027-02-01T10:00:00.000Z'),
        refundedAt: null,
        disputedAt: null,
        createdAt: new Date('2027-02-01T09:59:00.000Z'),
        ...overrides,
    };
}

function listRequest(query = ''): NextRequest {
    return new NextRequest(`https://test.local/api/admin/guides${query}`);
}

function rotateRequest(headers: Record<string, string> = SAME_SITE): NextRequest {
    return new NextRequest('https://test.local/api/admin/guides/gp_1/rotate', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9', ...headers },
    });
}

async function rotate(id = 'gp_1', headers?: Record<string, string>) {
    const res = await POST(rotateRequest(headers), { params: Promise.resolve({ id }) });
    return { res, json: await res.json() };
}

/** The update echoes the row with the data written, as Prisma returns it. */
function echoUpdate(base: Record<string, unknown> = {}): void {
    gp.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        ...row(base),
        id: where.id,
        ...data,
    }));
}

function writtenToken(): string {
    return (gp.update.mock.calls[0][0] as { data: { accessToken: string } }).data.accessToken;
}

function expectNoSecretsLogged(token: string): void {
    const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls, logAudit.mock.calls]);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(OLD_TOKEN);
    expect(logged).not.toContain(READER);
}

beforeEach(() => {
    vi.clearAllMocks();
    session.user = { id: 'admin-supabase-id' };
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'admin-profile', role: 'admin' } as never);
    gp.findMany.mockReset().mockResolvedValue([]);
    gp.update.mockReset();
    gp.updateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(sendGuidePurchaseEmail).mockReset().mockResolvedValue('sent');
    echoUpdate();
});

describe('the admin gate', () => {
    it.each([
        ['signed out', () => { session.user = null; }, 401],
        ['an employer', () => { vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'p', role: 'employer' } as never); }, 403],
    ])('%s: GET and POST answer %i before a purchase is read or written', async (_who, arrange, status) => {
        arrange();

        expect((await GET(listRequest())).status).toBe(status);
        expect((await rotate()).res.status).toBe(status);
        expect(gp.findMany).not.toHaveBeenCalled();
        expect(gp.update).not.toHaveBeenCalled();
        expect(gp.updateMany).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('a cross-site POST: 403, nothing written or sent', async () => {
        const { res } = await rotate('gp_1', { origin: 'https://evil.example' });

        expect(res.status).toBe(403);
        expect(gp.update).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/guides', () => {
    it('lists newest first, bounded, and never returns an access token', async () => {
        gp.findMany.mockResolvedValue([row()]);

        const res = await GET(listRequest());
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(ADMIN_GUIDE_PURCHASE_SELECT).not.toHaveProperty('accessToken');
        expect(gp.findMany).toHaveBeenCalledWith({
            where: {},
            orderBy: { createdAt: 'desc' },
            take: MAX_ADMIN_GUIDE_PURCHASES_LISTED,
            select: ADMIN_GUIDE_PURCHASE_SELECT,
        });
        expect(json.success).toBe(true);
        expect(json.purchases).toEqual([{
            id: 'gp_1',
            createdAt: '2027-02-01T09:59:00.000Z',
            email: READER,
            source: 'stripe',
            productSlug: 'career-bundle',
            productTitle: expect.any(String),
            guideCount: 3,
            amount: '$49',
            downloadsUsed: 4,
            downloadsAllowed: MAX_DOWNLOADS_PER_PURCHASE,
            emailSentAt: '2027-02-01T10:00:00.000Z',
            status: 'active',
        }]);
        expect(JSON.stringify(json)).not.toContain(OLD_TOKEN);
        expect(res.headers.get('cache-control')).toContain('no-store');
    });

    it.each([
        [{ refundedAt: new Date() }, 'refunded'],
        [{ disputedAt: new Date() }, 'disputed'],
    ])('a purchase with %o reads as %s', async (overrides, status) => {
        gp.findMany.mockResolvedValue([row(overrides)]);

        const json = await (await GET(listRequest())).json();

        expect(json.purchases[0].status).toBe(status);
    });

    it('filters by email in any case, trimmed', async () => {
        await GET(listRequest(`?email=${encodeURIComponent('  Reader@Example.COM ')}`));

        expect(gp.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { email: { equals: 'Reader@Example.COM', mode: 'insensitive' } },
        }));
    });

    it('a blank email lists everything', async () => {
        await GET(listRequest('?email=%20%20'));

        expect(gp.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it.each([
        ['no @', 'reader.example.com'],
        ['too long', `${'a'.repeat(250)}@example.com`],
    ])('an email that cannot be an address (%s): 400, nothing read', async (_label, email) => {
        const res = await GET(listRequest(`?email=${encodeURIComponent(email)}`));

        expect(res.status).toBe(400);
        expect((await res.json()).success).toBe(false);
        expect(gp.findMany).not.toHaveBeenCalled();
    });
});

describe('POST /api/admin/guides/:id/rotate', () => {
    it('writes a new 48 hex token with emailSentAt null, then claims, sends and records the send', async () => {
        const { res, json } = await rotate();

        expect(res.status).toBe(200);
        expect(gp.update).toHaveBeenCalledTimes(1);
        expect(gp.update).toHaveBeenCalledWith({
            where: { id: 'gp_1' },
            data: { accessToken: expect.stringMatching(TOKEN_PATTERN), emailSentAt: null },
        });
        const token = writtenToken();
        expect(token).not.toBe(OLD_TOKEN);

        expect(gp.updateMany).toHaveBeenCalledTimes(1);
        expect(gp.updateMany).toHaveBeenCalledWith({
            where: { id: 'gp_1', accessToken: token, emailSentAt: null },
            data: { emailSentAt: expect.any(Date) },
        });
        expect(sendGuidePurchaseEmail).toHaveBeenCalledWith(expect.objectContaining({ id: 'gp_1', email: READER, accessToken: token }));

        expect(json).toEqual({ success: true, purchase: expect.objectContaining({ id: 'gp_1', status: 'active' }), delivery: 'sent' });
        expect(json.purchase.emailSentAt).toEqual(expect.any(String));
        expect(json.purchase).not.toHaveProperty('accessToken');
        expect(JSON.stringify(json)).not.toContain(token);
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'guide_purchase.rotate_access',
            actorType: 'admin',
            actorId: 'admin-profile',
            targetType: 'guide_purchase',
            targetId: 'gp_1',
            ip: '203.0.113.9',
            metadata: { delivery: 'sent' },
        }));
        expectNoSecretsLogged(token);
    });

    it.each(['retry', 'refused'] as const)('a failed send (%s) puts emailSentAt back to null; the link stays replaced', async (result) => {
        vi.mocked(sendGuidePurchaseEmail).mockResolvedValueOnce(result);

        const { res, json } = await rotate();

        expect(res.status).toBe(200);
        const token = writtenToken();
        expect(gp.updateMany).toHaveBeenCalledTimes(2);
        expect(gp.updateMany).toHaveBeenLastCalledWith({
            where: { id: 'gp_1', accessToken: token },
            data: { emailSentAt: null },
        });
        expect(json.delivery).toBe(result);
        expect(json.purchase.emailSentAt).toBeNull();
        expectNoSecretsLogged(token);
    });

    it('a claim lost to an overlapping rotation sends nothing and reports retry', async () => {
        gp.updateMany.mockResolvedValueOnce({ count: 0 });

        const { res, json } = await rotate();

        expect(res.status).toBe(200);
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
        expect(json.delivery).toBe('retry');
    });

    it('a database failure after the token is replaced still answers the rotation, as retry', async () => {
        gp.updateMany.mockRejectedValueOnce(new Error('connection reset'));

        const { res, json } = await rotate();

        expect(res.status).toBe(200);
        expect(json.delivery).toBe('retry');
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
    });

    it('an unknown id: 404, nothing sent or audited', async () => {
        gp.update.mockRejectedValueOnce(Object.assign(new Error('Record to update not found.'), { code: 'P2025' }));

        const { res, json } = await rotate('gp_missing');

        expect(res.status).toBe(404);
        expect(json).toEqual({ success: false, error: 'Purchase not found' });
        expect(gp.updateMany).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('an id too long to be one: 404 without a write', async () => {
        const { res } = await rotate('x'.repeat(65));

        expect(res.status).toBe(404);
        expect(gp.update).not.toHaveBeenCalled();
    });

    it('any other database failure on the update: 500, nothing sent', async () => {
        gp.update.mockRejectedValueOnce(new Error('connection reset'));

        const { res } = await rotate();

        expect(res.status).toBe(500);
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
    });

    it('a purchase with no email rotates and reports no-address without a send', async () => {
        echoUpdate({ email: null });

        const { res, json } = await rotate();

        expect(res.status).toBe(200);
        expect(gp.update).toHaveBeenCalledWith(expect.objectContaining({
            data: { accessToken: expect.stringMatching(TOKEN_PATTERN), emailSentAt: null },
        }));
        expect(gp.updateMany).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
        expect(json.delivery).toBe('no-address');
        expect(json.purchase).toMatchObject({ email: null, emailSentAt: null });
    });

    it.each([
        [{ refundedAt: new Date('2027-03-01T00:00:00.000Z') }, 'refunded'],
        [{ disputedAt: new Date('2027-03-01T00:00:00.000Z') }, 'disputed'],
    ])('a purchase with %o rotates without an email saying its guides are ready', async (overrides, status) => {
        echoUpdate(overrides);

        const { res, json } = await rotate();

        expect(res.status).toBe(200);
        expect(json.purchase.status).toBe(status);
        expect(json.delivery).toBe('blocked');
        expect(gp.update).toHaveBeenCalledTimes(1);
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
    });
});
