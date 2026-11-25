/**
 * Every avatar a response carries is a link that expires (owner, 2026-11-25):
 * the person's own views, an admin's view of a profile, and the employer's
 * applicants view. The inbox, a thread and the talent pool surfaces are in
 * tests/api/conversation-surname-disclosure.test.ts and
 * tests/api/candidate-photo-disclosure.test.ts.
 *
 * The avatarUrl column stores the photo's public URL, which /api/upload
 * writes to name the object. These routes sent it as stored, so the photo
 * lived at a permanent public address. Now each one signs it
 * (lib/avatar-url.ts) and none of them sends the public URL; a signing that
 * fails sends null, and nothing writes that null back.
 *
 * Every database and storage call is a fake; nothing reaches Supabase.
 * Every fixture is fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    ensureProfile: vi.fn(),
    uploadAvatar: vi.fn(),
    /** Every key the fake store was asked to sign; `refuse` makes it fail. */
    store: { signedKeys: [] as string[], refuse: false },
    prisma: {
        userProfile: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
        jobApplication: { count: vi.fn(), findMany: vi.fn() },
        jobAlert: { count: vi.fn() },
        job: { findMany: vi.fn() },
        emailLead: { findUnique: vi.fn() },
        employerMessage: { count: vi.fn() },
        profileView: { count: vi.fn() },
        employerJob: { findMany: vi.fn() },
        dataRequest: { create: vi.fn(), update: vi.fn() },
    },
}));

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser, signOut: vi.fn() } })),
}));
vi.mock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({
        storage: {
            from: () => ({
                createSignedUrls: async (paths: string[]) => {
                    if (h.store.refuse) return { data: null, error: { message: 'storage unavailable' } };
                    h.store.signedKeys.push(...paths);
                    return { data: paths.map((path) => ({ path, signedUrl: `https://test.supabase.co/storage/v1/object/sign/avatars/${path}?token=fic`, error: null })), error: null };
                },
            }),
        },
    }),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: {
        auth: { limit: 10, windowSeconds: 60 },
        dataRequest: { limit: 5, windowSeconds: 60 },
        employer: { limit: 30, windowSeconds: 60 },
    },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/email-service', () => ({ sendSignupWelcomeEmail: vi.fn() }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(async () => undefined) } }));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfileFromAuth: h.ensureProfile }));
vi.mock('@/lib/resume-storage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/resume-storage')>()),
    mintResumeReadUrl: vi.fn(async () => null),
    extractRequestContext: vi.fn(() => ({ ip: null, userAgent: null })),
}));
vi.mock('@/lib/verify-extension-token', () => ({ verifyExtensionToken: vi.fn(async () => null) }));
vi.mock('@/lib/audit-log', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/auth/require-api-admin', () => ({
    requireApiAdmin: vi.fn(async () => null),
    requireApiAdminActor: vi.fn(async () => ({ error: null, actor: { profileId: 'profile-admin' } })),
}));
vi.mock('@/lib/ai/feature-flags', () => ({ isAiFeatureEnabled: vi.fn(async () => false) }));
// The upload itself is a fake; the ownership rule the signer applies stays real.
vi.mock('@/lib/supabase-storage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/supabase-storage')>()),
    uploadAvatar: h.uploadAvatar,
    validateFile: vi.fn(() => ({ valid: true })),
}));

import { GET as getProfile, PATCH as patchProfile } from '@/app/api/auth/profile/route';
import { PUT as putAddress } from '@/app/api/profile/address/route';
import { PUT as putEeo } from '@/app/api/profile/eeo/route';
import { PUT as putFederal } from '@/app/api/profile/federal-registrations/route';
import { GET as exportProfile } from '@/app/api/profile/export/route';
import { POST as upload } from '@/app/api/upload/route';
import { GET as dashboard } from '@/app/api/dashboard/route';
import { POST as dataRequest } from '@/app/api/data-request/route';
import { GET as adminUser } from '@/app/api/admin/users/[id]/route';
import { GET as applicants } from '@/app/api/employer/applicants/route';

const ME = 'aaaaaaaa-1111-2222-3333-444444444444';
const EMAIL = 'np.fic@example.com';
const KEY = `prod/${ME}/1700000000000.png`;
const STORED = `https://test.supabase.co/storage/v1/object/public/avatars/${KEY}`;
const SIGNED = `https://test.supabase.co/storage/v1/object/sign/avatars/${KEY}?token=fic`;
const GOOGLE_PICTURE = 'https://lh3.googleusercontent.com/a/ACg8ocK-fic=s96-c';

const RELATIONS = {
    licenses: [], certificationRecords: [], education: [], workExperience: [],
    screeningAnswers: [], openEndedResponses: [], candidateReferences: [],
};

function profileRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'profile-me', supabaseId: ME, email: EMAIL, role: 'job_seeker', firstName: 'Sam', lastName: 'Riverafic',
        avatarUrl: STORED, resumeUrl: null, specialties: null, updatedAt: new Date('2026-11-01T00:00:00Z'),
        ...RELATIONS, ...overrides,
    };
}

/** The response carries the signed link and nowhere the stored public URL. */
function expectSignedOnly(body: unknown): void {
    const raw = JSON.stringify(body);
    expect(raw).toContain(SIGNED);
    expect(raw).not.toContain('/object/public/avatars/');
}

const json = (body: unknown, method = 'PUT') => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

beforeEach(() => {
    vi.clearAllMocks();
    h.store.signedKeys = [];
    h.store.refuse = false;
    h.getUser.mockResolvedValue({ data: { user: { id: ME, email: EMAIL } }, error: null });
    h.ensureProfile.mockResolvedValue(profileRow());
    h.prisma.userProfile.findUnique.mockResolvedValue(profileRow());
    h.prisma.userProfile.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => profileRow(
        'avatarUrl' in data ? { avatarUrl: data.avatarUrl } : {},
    ));
    h.prisma.jobApplication.count.mockResolvedValue(0);
    h.prisma.jobApplication.findMany.mockResolvedValue([]);
    h.prisma.jobAlert.count.mockResolvedValue(0);
    h.prisma.job.findMany.mockResolvedValue([]);
    h.prisma.emailLead.findUnique.mockResolvedValue(null);
    h.prisma.employerMessage.count.mockResolvedValue(0);
    h.prisma.profileView.count.mockResolvedValue(0);
    h.prisma.dataRequest.create.mockResolvedValue({ id: 'dsar-1', dueBy: new Date('2026-12-25T00:00:00Z'), type: 'access' });
    h.prisma.dataRequest.update.mockResolvedValue({});
});

describe("the person's own profile", () => {
    it('GET /api/auth/profile sends the photo as a link that expires', async () => {
        const body = await (await getProfile()).json();

        expect(body.avatarUrl).toBe(SIGNED);
        expectSignedOnly(body);
        expect(h.store.signedKeys).toEqual([KEY]);
    });

    it('passes a Google sign-in picture through untouched', async () => {
        h.ensureProfile.mockResolvedValue(profileRow({ avatarUrl: GOOGLE_PICTURE }));

        expect((await (await getProfile()).json()).avatarUrl).toBe(GOOGLE_PICTURE);
        expect(h.store.signedKeys).toEqual([]);
    });

    it('sends null when the photo cannot be signed, and writes nothing', async () => {
        h.store.refuse = true;

        const body = await (await getProfile()).json();

        expect(body.avatarUrl).toBeNull();
        expect(JSON.stringify(body)).not.toContain(KEY);
        expect(h.prisma.userProfile.update).not.toHaveBeenCalled();
    });

    it('PATCH stores a signed link sent back as the public URL it names, and answers with a link', async () => {
        const res = await patchProfile(new NextRequest('http://localhost:3000/api/auth/profile', json({ avatarUrl: SIGNED, headline: 'PMHNP' }, 'PATCH')));
        const body = await res.json();

        expect(h.prisma.userProfile.update.mock.calls[0][0].data.avatarUrl).toBe(STORED);
        expect(body.avatarUrl).toBe(SIGNED);
        expectSignedOnly(body);
    });

    it.each([
        ['PUT /api/profile/address', putAddress, { city: 'Austin' }],
        ['PUT /api/profile/eeo', putEeo, { gender: 'decline' }],
        ['PUT /api/profile/federal-registrations', putFederal, { npiNumber: '1234567890' }],
    ])('%s answers with the whole row, its photo as a link', async (_label, route, body) => {
        const res = await route(new NextRequest('http://localhost:3000/api/profile/x', json(body)));

        expectSignedOnly(await res.json());
    });

    it('GET /api/profile/export puts a link in the export, not the public URL', async () => {
        const body = await (await exportProfile(new NextRequest('http://localhost:3000/api/profile/export'))).json();

        expect(body.personal.avatarUrl).toBe(SIGNED);
        expectSignedOnly(body);
    });

    it('POST /api/data-request, an access request, exports the photo as a link', async () => {
        const res = await dataRequest(new NextRequest('http://localhost:3000/api/data-request', json({ email: EMAIL, type: 'access' }, 'POST')));
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(body.export.avatarUrl).toBe(SIGNED);
        expectSignedOnly(body);
    });

    it('GET /api/dashboard sends the photo as a link', async () => {
        const body = await (await dashboard(new Request('http://localhost:3000/api/dashboard'))).json();

        expect(body.profile.avatarUrl).toBe(SIGNED);
        expectSignedOnly(body);
    });

    it('POST /api/upload stores the public URL that names the new photo and answers with a link', async () => {
        h.uploadAvatar.mockResolvedValue({ path: KEY, url: STORED });
        const form = new FormData();
        form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'me.png', { type: 'image/png' }));
        form.append('type', 'avatar');

        const res = await upload(new NextRequest('http://localhost:3000/api/upload', { method: 'POST', body: form }));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(h.prisma.userProfile.update.mock.calls[0][0].data).toEqual({ avatarUrl: STORED });
        expect(body).toEqual({ success: true, url: SIGNED, path: KEY });
    });
});

describe('an admin, and the employer applicants view', () => {
    it('GET /api/admin/users/:id sends the photo as a link', async () => {
        const res = await adminUser(new NextRequest('http://localhost:3000/api/admin/users/profile-me'), {
            params: Promise.resolve({ id: 'profile-me' }),
        });
        const body = await res.json();

        expect(body.user.avatarUrl).toBe(SIGNED);
        expectSignedOnly(body);
    });

    it("GET /api/employer/applicants sends each applicant's photo as a link, signed in one call", async () => {
        const EMPLOYER = { id: 'supabase-employer-fic', email: 'hiring@clinic.example', email_confirmed_at: '2026-10-01T00:00:00Z' };
        h.getUser.mockResolvedValue({ data: { user: EMPLOYER }, error: null });
        h.prisma.userProfile.findUnique.mockResolvedValue({ role: 'employer' });
        h.prisma.employerJob.findMany.mockResolvedValue([{ jobId: 'job-1', job: { id: 'job-1', title: 'Family NP' } }]);
        const OTHER = 'bbbbbbbb-5555-6666-7777-888888888888';
        const applicant = (id: string, supabaseId: string, avatarUrl: string | null) => ({
            id, status: 'applied', notes: null, coverLetter: null, coverLetterUrl: null, resumeUrl: null,
            appliedAt: new Date('2026-11-20T00:00:00Z'), statusUpdatedAt: null, aiMatchScore: null, aiMatchReasons: [],
            aiMissingItems: [], screeningAnswers: null,
            user: {
                supabaseId, firstName: 'Ada', lastName: 'Okafic', email: 'ada@example.com', avatarUrl, headline: null,
                yearsExperience: 3, certifications: null, licenseStates: null, specialties: null, bio: null, skills: [],
                education: [], workExperience: [], certificationRecords: [], licenses: [],
            },
            job: { id: 'job-1', title: 'Family NP', isPublished: true, expiresAt: null },
        });
        h.prisma.jobApplication.findMany.mockResolvedValue([
            applicant('app-1', ME, STORED),
            applicant('app-2', OTHER, null),
        ]);

        const body = await (await applicants(new NextRequest('http://localhost:3000/api/employer/applicants'))).json();

        expect(body.applicants.map((a: { candidate: { avatarUrl: string | null } }) => a.candidate.avatarUrl)).toEqual([SIGNED, null]);
        expectSignedOnly(body);
        expect(h.store.signedKeys).toEqual([KEY]);
    });
});
