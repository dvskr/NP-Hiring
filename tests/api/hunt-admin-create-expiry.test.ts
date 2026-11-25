/**
 * POST /api/admin/jobs, from the sister boards' second hunt review.
 *
 * A job created from the admin panel was written:
 *   - with no expiry, which the listings and the sitemaps read as "never
 *     ends", so the job stayed listed for ever;
 *   - with no posting date, so it sorted last under Newest First;
 *   - with a slug that ended in a base36 timestamp, not the job's UUID.
 *     middleware.ts answers a /jobs/<slug> with no UUID at its end as an
 *     unknown page (410), so the new job's page was gone the moment it was
 *     created.
 *
 * All fixtures are fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { config } from '@/lib/config';

const mocks = vi.hoisted(() => ({ create: vi.fn(), logAudit: vi.fn() }));

vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdmin: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/audit-log', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn().mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'sb-admin-1' } } }) },
    }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: { job: { create: mocks.create } } }));

import { POST } from '@/app/api/admin/jobs/route';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The job id at the end of a job page's slug, as middleware.ts reads it. */
const SLUG_UUID = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

function createRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('https://example.com/api/admin/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const VALID_JOB = {
    title: 'Family Nurse Practitioner',
    employer: 'Acme Health (Fixture)',
    location: 'Austin, TX',
    description: 'A fictional posting.',
    applyLink: 'https://example.com/apply',
};

const written = () => mocks.create.mock.calls[0][0].data as Record<string, unknown>;

beforeEach(() => {
    mocks.create.mockReset();
    mocks.logAudit.mockReset();
    mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
});

describe('POST /api/admin/jobs', () => {
    it('gives the new job the standard listing term, so it does not stay listed for ever', async () => {
        const before = Date.now();

        const response = await POST(createRequest(VALID_JOB));
        const after = Date.now();

        expect(response.status).toBe(201);
        const expiresAt = written().expiresAt as Date;
        expect(expiresAt).toBeInstanceOf(Date);
        const term = config.durationDays * DAY_MS;
        expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + term);
        expect(expiresAt.getTime()).toBeLessThanOrEqual(after + term);
    });

    it('dates the job now, so it sorts with the other new jobs, and counts its content as new now', async () => {
        const before = Date.now();

        await POST(createRequest(VALID_JOB));

        const postedAt = written().originalPostedAt as Date;
        expect(postedAt).toBeInstanceOf(Date);
        expect(postedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(postedAt.getTime()).toBeLessThanOrEqual(Date.now());
        expect(written().contentChangedAt).toBeInstanceOf(Date);
    });

    it('ends the slug in the job id, so the middleware serves the job page instead of a 410', async () => {
        await POST(createRequest(VALID_JOB));

        const { id, slug } = written() as { id: string; slug: string };
        expect(id).toMatch(SLUG_UUID);
        expect(slug.match(SLUG_UUID)?.[1]).toBe(id);
        expect(slug.startsWith('family-nurse-practitioner-acme-health-fixture-')).toBe(true);
    });

    it('mints a new id for every job', async () => {
        await POST(createRequest(VALID_JOB));
        await POST(createRequest(VALID_JOB));

        const [first, second] = mocks.create.mock.calls.map((call) => (call[0].data as { id: string }).id);
        expect(first).not.toBe(second);
    });

    it('still refuses a job with a required field missing, before anything is written', async () => {
        const response = await POST(createRequest({ ...VALID_JOB, applyLink: '' }));

        expect(response.status).toBe(400);
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('records the creating admin against the new job', async () => {
        await POST(createRequest(VALID_JOB));

        expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'admin.job.create',
            actorId: 'sb-admin-1',
            targetId: written().id,
        }));
    });
});
