/**
 * POST /api/employer/testimonials takes a story only from an employer
 * account, and names the employer from server-side records.
 *
 * Before: any signed-in account could submit, a job seeker included, and the
 * stored employerName fell back to user_metadata.company, then
 * user_metadata.full_name. The account holder writes user_metadata from the
 * browser (supabase.auth.updateUser with the public key), so a seeker could
 * file a story under any company name; the admin review list shows only that
 * name and the text, and the public page says every story is an employer's.
 *
 * Pinned:
 *   - No session: 401, as before.
 *   - A job seeker, an admin, or a session with no profile: 403, before the
 *     body is read, with nothing looked up or stored.
 *   - An employer: 200, and employerName is the employer name on its most
 *     recent post, else its profile company, else its profile name, else its
 *     profile email (never shown publicly: FeaturedTestimonials prints
 *     "Verified employer" for anything with an @). user_metadata is never read.
 *   - An employerJobId is still kept only when the employer owns that post.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    prisma: {
        userProfile: { findUnique: vi.fn() },
        employerJob: { findFirst: vi.fn() },
        employerTestimonial: { create: vi.fn() },
    },
}));

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { feedback: { limit: 5, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/employer/testimonials/route';

interface ProfileRow {
    role: string;
    company: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string;
}

const EMAIL = 'hiring@clinic.example';
/**
 * A session whose user_metadata names a company the account has nothing to
 * do with: the account holder can set it to anything.
 */
const SESSION = {
    id: 'auth-account',
    email: EMAIL,
    user_metadata: { company: 'Kaiser Permanente', full_name: 'Mallory Example' },
};
const STORY = { content: 'We hired two family NPs within a month of posting.', consent: true, displayAs: 'full' };
const FORBIDDEN = { status: 403, body: { error: 'Only employer accounts can share a story.' } };

function employer(overrides: Partial<ProfileRow> = {}): ProfileRow {
    return { role: 'employer', company: 'Riverside Psychiatry Group', firstName: 'Ada', lastName: 'Lovelace', email: EMAIL, ...overrides };
}

function signIn(user: typeof SESSION | null, profile: ProfileRow | null): void {
    h.getUser.mockResolvedValue({ data: { user }, error: null });
    h.prisma.userProfile.findUnique.mockResolvedValue(profile);
}

/** The employer name on the account's most recent post, or no post at all. */
function latestPostName(employerName: string | null): void {
    h.prisma.employerJob.findFirst.mockResolvedValue(employerName ? { employerName } : null);
}

async function submit(body: Record<string, unknown> = STORY): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await POST(new NextRequest('http://localhost:3000/api/employer/testimonials', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function storedName(): unknown {
    expect(h.prisma.employerTestimonial.create).toHaveBeenCalledTimes(1);
    const [args] = h.prisma.employerTestimonial.create.mock.calls[0] as [{ data: { employerName: unknown } }];
    return args.data.employerName;
}

beforeEach(() => {
    vi.clearAllMocks();
    h.prisma.employerTestimonial.create.mockResolvedValue({ id: 'testimonial-1' });
    latestPostName(null);
    signIn(SESSION, employer());
});

describe('who may submit', () => {
    it('answers 401 without a session', async () => {
        signIn(null, null);

        expect(await submit()).toEqual({ status: 401, body: { error: 'Authentication required' } });
        expect(h.prisma.employerTestimonial.create).not.toHaveBeenCalled();
    });

    it.each([
        ['a job seeker', employer({ role: 'job_seeker', company: null })],
        ['an admin', employer({ role: 'admin' })],
        ['a session with no profile', null],
    ])('turns away %s with 403 and stores nothing', async (_label, profile) => {
        signIn(SESSION, profile);

        expect(await submit()).toEqual(FORBIDDEN);
        expect(h.prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(h.prisma.employerTestimonial.create).not.toHaveBeenCalled();
    });

    it('turns a job seeker away before reading the body', async () => {
        signIn(SESSION, employer({ role: 'job_seeker', company: null }));

        expect(await submit({ content: 'short', consent: false })).toEqual(FORBIDDEN);
    });

    it('takes a story from an employer', async () => {
        expect(await submit()).toEqual({ status: 200, body: { success: true } });
        expect(h.prisma.employerTestimonial.create).toHaveBeenCalledWith({
            data: {
                userId: SESSION.id,
                employerJobId: null,
                employerName: 'Riverside Psychiatry Group',
                content: STORY.content,
                rating: null,
                consent: true,
                displayAs: 'full',
            },
        });
    });
});

describe('the employer name comes from server-side records, never user_metadata', () => {
    it('uses the employer name on the most recent post', async () => {
        latestPostName('Riverside Psychiatry');

        await submit();

        expect(storedName()).toBe('Riverside Psychiatry');
    });

    it('uses the profile company when the employer has no post', async () => {
        await submit();

        expect(storedName()).toBe('Riverside Psychiatry Group');
    });

    it('uses the profile name when there is no post and no company', async () => {
        signIn(SESSION, employer({ company: null }));

        await submit();

        expect(storedName()).toBe('Ada Lovelace');
    });

    it('falls back to the profile email last', async () => {
        signIn(SESSION, employer({ company: null, firstName: null, lastName: null }));

        await submit();

        expect(storedName()).toBe(EMAIL);
    });
});

describe('the posting link', () => {
    it('keeps an employerJobId only when the employer owns that post', async () => {
        h.prisma.employerJob.findFirst
            .mockResolvedValueOnce(null) // the name lookup: no post
            .mockResolvedValueOnce(null); // the ownership check: not theirs

        await submit({ ...STORY, employerJobId: 'ej-someone-else' });

        expect(h.prisma.employerTestimonial.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ employerJobId: null }),
        });
        expect(h.prisma.employerJob.findFirst).toHaveBeenLastCalledWith({
            where: { id: 'ej-someone-else', OR: [{ userId: SESSION.id }, { userId: null, contactEmail: EMAIL }] },
            select: { id: true },
        });
    });
});
