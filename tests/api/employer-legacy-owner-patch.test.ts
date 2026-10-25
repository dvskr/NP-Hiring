/**
 * Register 2.26, security review follow-up: the two employer writes that load
 * the posting first and decide ownership in code, PATCH /api/employer/applicants
 * (an application's status and notes) and PATCH /api/employer/settings/notifications
 * (a posting's alert settings), wrote the legacy rule inline: an unclaimed row
 * filed under the session's email. They skipped the confirmed email rule every
 * other route now applies (lib/employer-ownership.ts), so a session whose
 * unconfirmed email matched a legacy posting could change its applicants'
 * statuses and switch off its owner's alerts. Both now ask isEmployerJobOwner.
 *
 * Also here: PATCH /api/employer/applicants reads the application id as a plain
 * string. It is the only key of the jobApplication.findUnique that decides
 * ownership and of the update after it, and the route had no try/catch, so a
 * JSON body that carried an object there answered an unhandled 500. It now
 * answers 400 before any query (lib/request-body.ts).
 *
 * Supabase and the database are mocked; nothing here reaches either.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    profileFindUnique: vi.fn(),
    applicationFindUnique: vi.fn(),
    applicationUpdate: vi.fn(),
    employerJobFindUnique: vi.fn(),
    employerJobUpdate: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: { findUnique: h.profileFindUnique },
        jobApplication: { findUnique: h.applicationFindUnique, update: h.applicationUpdate },
        employerJob: { findUnique: h.employerJobFindUnique, update: h.employerJobUpdate },
    },
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/resume-storage', () => ({ mintResumeReadUrl: vi.fn(), extractRequestContext: vi.fn(() => ({})) }));

import { PATCH as patchApplication } from '@/app/api/employer/applicants/route';
import { PATCH as patchNotifications } from '@/app/api/employer/settings/notifications/route';

const EMAIL = 'hiring@clinic.example';
const CONFIRMED = { id: 'auth-employer', email: EMAIL, email_confirmed_at: '2026-01-15T10:00:00.000Z' };
const UNCONFIRMED = { id: 'auth-employer', email: EMAIL };
/** An unclaimed legacy posting filed under EMAIL. */
const LEGACY = { userId: null, contactEmail: EMAIL };

function patch(path: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    h.profileFindUnique.mockResolvedValue({ id: 'profile-employer', role: 'employer' });
    h.applicationFindUnique.mockResolvedValue({
        id: 'app-1',
        userId: 'auth-candidate',
        status: 'applied',
        job: { title: 'Family NP', employer: 'Clinic', employerJobs: LEGACY },
    });
    h.applicationUpdate.mockResolvedValue({ id: 'app-1', status: 'applied', notes: 'Strong fit', statusUpdatedAt: null });
    h.employerJobFindUnique.mockResolvedValue(LEGACY);
    h.employerJobUpdate.mockResolvedValue({ id: 'ej-1', notifyOnApplication: false, notifyDigest: 'off' });
});

describe('the legacy owner of a posting is a confirmed email', () => {
    it('PATCH /api/employer/applicants refuses a session whose email is not confirmed', async () => {
        h.getUser.mockResolvedValue({ data: { user: UNCONFIRMED }, error: null });

        const res = await patchApplication(patch('/api/employer/applicants', { applicationId: 'app-1', notes: 'Strong fit' }));

        expect(res.status).toBe(403);
        expect(h.applicationUpdate).not.toHaveBeenCalled();
    });

    it('PATCH /api/employer/applicants still lets the confirmed owner write', async () => {
        h.getUser.mockResolvedValue({ data: { user: CONFIRMED }, error: null });

        const res = await patchApplication(patch('/api/employer/applicants', { applicationId: 'app-1', notes: 'Strong fit' }));

        expect(res.status).toBe(200);
        expect(h.applicationUpdate).toHaveBeenCalledTimes(1);
    });

    it('PATCH /api/employer/settings/notifications refuses a session whose email is not confirmed', async () => {
        h.getUser.mockResolvedValue({ data: { user: UNCONFIRMED }, error: null });

        const res = await patchNotifications(patch('/api/employer/settings/notifications', { employerJobId: 'ej-1', notifyDigest: 'off' }));

        expect(res.status).toBe(403);
        expect(h.employerJobUpdate).not.toHaveBeenCalled();
    });

    it('PATCH /api/employer/settings/notifications still lets the confirmed owner write', async () => {
        h.getUser.mockResolvedValue({ data: { user: CONFIRMED }, error: null });

        const res = await patchNotifications(patch('/api/employer/settings/notifications', { employerJobId: 'ej-1', notifyDigest: 'off' }));

        expect(res.status).toBe(200);
        expect(h.employerJobUpdate).toHaveBeenCalledTimes(1);
    });

    it('neither route writes the rule by hand any more', async () => {
        const fs = await import('node:fs');
        for (const file of ['app/api/employer/applicants/route.ts', 'app/api/employer/settings/notifications/route.ts']) {
            const src = fs.readFileSync(file, 'utf8');
            expect(src, file).toContain('isEmployerJobOwner(');
            expect(src, file).not.toMatch(/contactEmail === user\.email/);
        }
    });
});

const BAD_APPLICATION_IDS: Array<[string, unknown]> = [
    ['a not filter', { not: '' }],
    ['a startsWith filter', { startsWith: 'app' }],
    ['an array', ['app-1']],
    ['a number', 12345],
    ['a boolean', true],
    ['null', null],
    ['no value', undefined],
    ['an empty string', ''],
    ['an overlong string', 'a'.repeat(201)],
];

describe('PATCH /api/employer/applicants: the application id is a plain string', () => {
    beforeEach(() => {
        h.getUser.mockResolvedValue({ data: { user: CONFIRMED }, error: null });
    });

    it.each(BAD_APPLICATION_IDS)('refuses %s as the application id with 400 and no query', async (_label, applicationId) => {
        const res = await patchApplication(patch('/api/employer/applicants', { applicationId, notes: 'Strong fit' }));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'applicationId is required' });
        expect(h.applicationFindUnique).not.toHaveBeenCalled();
        expect(h.applicationUpdate).not.toHaveBeenCalled();
    });

    it.each([
        ['a null body', null],
        ['an array body', [{ applicationId: 'app-1', notes: 'Strong fit' }]],
        ['a string body', 'app-1'],
    ])('refuses %s with 400 and no query', async (_label, body) => {
        const res = await patchApplication(patch('/api/employer/applicants', body));

        expect(res.status).toBe(400);
        expect(h.applicationFindUnique).not.toHaveBeenCalled();
        expect(h.applicationUpdate).not.toHaveBeenCalled();
    });

    it('still looks a string application id up by equality and updates that row', async () => {
        const res = await patchApplication(patch('/api/employer/applicants', { applicationId: 'app-1', notes: 'Strong fit' }));

        expect(res.status).toBe(200);
        expect(h.applicationFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'app-1' } }));
        expect(h.applicationUpdate).toHaveBeenCalledWith({ where: { id: 'app-1' }, data: { notes: 'Strong fit' } });
    });
});
