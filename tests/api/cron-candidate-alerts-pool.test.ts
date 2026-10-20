/**
 * Regression (CRON-1, EMP-ALERT-1): GET /api/cron/candidate-alerts.
 *
 * CRON-1: the digest picked new job seekers with only role and
 * profileVisible, so a candidate who had switched "Open to offers" off
 * was still emailed to employers, although every employer-facing
 * candidate route hides them. It also printed licensed states to every
 * alert owner, while GET /api/employer/candidates returns them only to an
 * employer with an active posting (or an admin). The fix applies the live
 * pool rule (role job_seeker, profileVisible, openToOffers, not deleted),
 * re-checks that the alert owner is still an employer or admin, and
 * withholds licensed states unless the owner has an active posting.
 *
 * EMP-ALERT-1: one stored filter list could hold tens of thousands of
 * entries, and the loop had no isolation, so one bad row aborted the run
 * for every later employer. Stored lists are now capped (same caps as the
 * POST route), empty entries are dropped (an empty `contains` matches
 * every candidate), and each alert runs in its own try/catch, counted and
 * reported once.
 *
 * Prisma is mocked; nothing here touches a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SPECIALTY_PRESETS, LICENSE_STATE_OPTIONS } from '@/config/niche/credentials';

const alertFindMany = vi.fn();
const alertUpdate = vi.fn();
const profileFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
    prisma: {
        employerCandidateAlert: {
            findMany: (...a: unknown[]) => alertFindMany(...a),
            update: (...a: unknown[]) => alertUpdate(...a),
        },
        userProfile: { findMany: (...a: unknown[]) => profileFindMany(...a) },
    },
}));

const sendDigest = vi.fn();
vi.mock('@/lib/email-service', () => ({
    sendNewCandidateAlertEmail: (...a: unknown[]) => sendDigest(...a),
}));

const activePostings = vi.fn();
vi.mock('@/lib/tier-limits', () => ({
    getEmployerActivePostings: (...a: unknown[]) => activePostings(...a),
}));

const failureAlert = vi.fn();
vi.mock('@/lib/discord-notifier', () => ({
    sendCronFailureAlert: (...a: unknown[]) => failureAlert(...a),
}));

const logError = vi.fn();
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: (...a: unknown[]) => logError(...a) },
}));

vi.mock('@/lib/auth/verify-cron-or-admin', () => ({
    verifyCronOrAdmin: async () => null,
}));

type RunResult = { response: Response; metrics?: Record<string, unknown> };
let lastRun: RunResult | null = null;
vi.mock('@/lib/cron/track', () => ({
    withCronTracking: async (_name: string, body: () => Promise<RunResult>) => {
        lastRun = await body();
        return lastRun.response;
    },
}));

import { GET } from '@/app/api/cron/candidate-alerts/route';

const MAX_SPECIALTIES = SPECIALTY_PRESETS.length * 2;
const MAX_STATES = LICENSE_STATE_OPTIONS.length;

const OWNER = {
    id: 'profile-emp-1',
    supabaseId: 'supa-emp-1',
    role: 'employer',
    email: 'owner@example.com',
    firstName: 'Olive',
    lastName: 'Owner',
    company: 'Acme Clinic',
};
const SECOND_OWNER = {
    ...OWNER,
    id: 'profile-emp-2',
    supabaseId: 'supa-emp-2',
    email: 'second@example.com',
    company: 'Second Clinic',
};

type AlertFilters = {
    specialties?: string | null;
    states?: string | null;
    minExperience?: number | null;
    workMode?: string | null;
};

function alertRow(id: string, filters: AlertFilters = {}, employer = OWNER) {
    return {
        id,
        employerId: employer.id,
        specialties: null,
        states: null,
        minExperience: null,
        workMode: null,
        isActive: true,
        lastSentAt: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        ...filters,
        employer,
    };
}

const CANDIDATE = {
    supabaseId: 'supa-cand-1',
    firstName: 'Casey',
    lastName: 'Nguyen',
    headline: 'Family NP, 4 years in primary care',
    specialties: 'Primary Care, Family Practice (FNP)',
    licenseStates: 'TX,CO',
    yearsExperience: 4,
};

function req(): Request {
    return new Request('https://example.com/api/cron/candidate-alerts');
}

/** Every `contains` value the where applies to one field, wherever it sits in AND/OR. */
function containsValues(where: unknown, field: 'specialties' | 'licenseStates'): string[] {
    const found: string[] = [];
    JSON.stringify(where, (key, value) => {
        if (key === field && value && typeof value === 'object' && 'contains' in value) {
            found.push((value as { contains: string }).contains);
        }
        return value;
    });
    return found;
}

function candidateWhere(call = 0): Record<string, unknown> {
    return profileFindMany.mock.calls[call][0].where;
}

function digestFor(call = 0) {
    return sendDigest.mock.calls[call][2] as Array<{ name: string; states: string[]; profileUrl: string }>;
}

beforeEach(() => {
    lastRun = null;
    alertFindMany.mockReset().mockResolvedValue([alertRow('alert-1')]);
    alertUpdate.mockReset().mockResolvedValue({});
    profileFindMany.mockReset().mockResolvedValue([CANDIDATE]);
    sendDigest.mockReset().mockResolvedValue({ success: true });
    activePostings.mockReset().mockResolvedValue([]);
    failureAlert.mockReset().mockResolvedValue(undefined);
    logError.mockReset();
});

describe('candidate-alerts cron selects only the live candidate pool (CRON-1)', () => {
    const SHAPES: Array<[string, AlertFilters]> = [
        ['no filters', {}],
        ['specialties only', { specialties: 'Oncology,Primary Care' }],
        ['states only', { states: 'TX,CA' }],
        ['specialties and states', { specialties: 'Oncology', states: 'TX', minExperience: 3, workMode: 'Remote' }],
    ];

    it.each(SHAPES)('%s: requires job_seeker, visible, open to offers and not deleted', async (_label, filters) => {
        alertFindMany.mockResolvedValue([alertRow('alert-1', filters)]);
        const res = await GET(req());
        expect(res.status).toBe(200);
        expect(candidateWhere()).toMatchObject({
            role: 'job_seeker',
            profileVisible: true,
            openToOffers: true,
            deletedAt: null,
        });
    });

    it('keeps the alert filters: any listed specialty and any listed state, plus experience and work mode', async () => {
        alertFindMany.mockResolvedValue([alertRow('alert-1', {
            specialties: 'Oncology,Primary Care',
            states: 'TX,CA',
            minExperience: 3,
            workMode: 'Remote',
        })]);
        await GET(req());
        expect(candidateWhere()).toMatchObject({
            AND: [
                {
                    OR: [
                        { specialties: { contains: 'Oncology', mode: 'insensitive' } },
                        { specialties: { contains: 'Primary Care', mode: 'insensitive' } },
                    ],
                },
                {
                    OR: [
                        { licenseStates: { contains: 'TX', mode: 'insensitive' } },
                        { licenseStates: { contains: 'CA', mode: 'insensitive' } },
                    ],
                },
            ],
            yearsExperience: { gte: 3 },
            preferredWorkMode: { equals: 'Remote', mode: 'insensitive' },
            createdAt: { gt: expect.any(Date) },
        });
    });

    it('loads only active alerts whose owner is still an employer or admin and not deleted', async () => {
        await GET(req());
        expect(alertFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                isActive: true,
                employer: { role: { in: ['employer', 'admin'] }, deletedAt: null },
            },
        }));
    });
});

describe('candidate-alerts cron withholds licensed states like the list route (CRON-1)', () => {
    it('sends no licensed states to an owner without an active posting', async () => {
        activePostings.mockResolvedValue([]);
        await GET(req());
        // The posting check needs the Supabase id: EmployerJob.userId holds it.
        expect(activePostings).toHaveBeenCalledWith('supa-emp-1');
        expect(sendDigest).toHaveBeenCalledOnce();
        expect(digestFor()[0].states).toEqual([]);
    });

    it('sends licensed states to an owner with an active posting', async () => {
        activePostings.mockResolvedValue([{ id: 'employer-job-1' }]);
        await GET(req());
        expect(activePostings).toHaveBeenCalledWith('supa-emp-1');
        expect(digestFor()[0].states).toEqual(['TX', 'CO']);
    });

    it('sends licensed states to an admin owner without a posting lookup', async () => {
        alertFindMany.mockResolvedValue([alertRow('alert-1', {}, { ...OWNER, role: 'admin' })]);
        await GET(req());
        expect(activePostings).not.toHaveBeenCalled();
        expect(digestFor()[0].states).toEqual(['TX', 'CO']);
    });

    it('keeps the fields the list route shows without a posting', async () => {
        await GET(req());
        expect(sendDigest).toHaveBeenCalledWith('owner@example.com', 'Acme Clinic', [{
            name: 'Casey N.',
            headline: 'Family NP, 4 years in primary care',
            profileUrl: expect.stringMatching(/\/employer\/candidates\/supa-cand-1$/),
            specialties: ['Primary Care', 'Family Practice (FNP)'],
            states: [],
            experience: 4,
        }]);
    });
});

describe('candidate-alerts cron survives a bad stored row (EMP-ALERT-1)', () => {
    it('caps a stored 70,000 entry specialties list instead of sending it to the database', async () => {
        const huge = Array.from({ length: 70_000 }, (_, i) => `s${i}`).join(',');
        alertFindMany.mockResolvedValue([alertRow('alert-1', { specialties: huge, states: [...LICENSE_STATE_OPTIONS, 'XX', 'YY'].join(',') })]);
        const res = await GET(req());
        expect(res.status).toBe(200);
        expect(containsValues(candidateWhere(), 'specialties')).toHaveLength(MAX_SPECIALTIES);
        expect(containsValues(candidateWhere(), 'licenseStates')).toHaveLength(MAX_STATES);
    });

    it('drops empty entries, which would otherwise match every candidate', async () => {
        alertFindMany.mockResolvedValue([alertRow('alert-1', { specialties: 'Oncology,, ', states: 'TX,' })]);
        await GET(req());
        expect(containsValues(candidateWhere(), 'specialties')).toEqual(['Oncology']);
        expect(containsValues(candidateWhere(), 'licenseStates')).toEqual(['TX']);
    });

    it('applies no list filter when a stored list holds only separators', async () => {
        alertFindMany.mockResolvedValue([alertRow('alert-1', { specialties: ',,', states: ' , ' })]);
        await GET(req());
        expect(containsValues(candidateWhere(), 'specialties')).toEqual([]);
        expect(containsValues(candidateWhere(), 'licenseStates')).toEqual([]);
    });

    it('a failing candidate query on the first alert still sends the second, and the failure is reported once', async () => {
        alertFindMany.mockResolvedValue([
            alertRow('alert-1'),
            alertRow('alert-2', {}, SECOND_OWNER),
        ]);
        profileFindMany
            .mockRejectedValueOnce(new Error('too many bind variables'))
            .mockResolvedValueOnce([CANDIDATE]);

        const res = await GET(req());

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ sent: 1, failed: 1, total: 2 });
        expect(sendDigest).toHaveBeenCalledOnce();
        expect(sendDigest.mock.calls[0][0]).toBe('second@example.com');
        expect(alertUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'alert-2' } }));
        expect(alertUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'alert-1' } }));
        expect(logError).toHaveBeenCalledWith('Candidate alert failed', expect.any(Error), { alertId: 'alert-1' });
        expect(failureAlert).toHaveBeenCalledOnce();
        expect(failureAlert.mock.calls[0][0]).toBe('candidate-alerts');
        expect(String(failureAlert.mock.calls[0][1])).toContain('alert-1');
        expect(lastRun?.metrics).toMatchObject({ alertsProcessed: 2, emailsSent: 1, alertsFailed: 1 });
    });

    it('a failing lastSentAt update is counted and the next alert still runs', async () => {
        alertFindMany.mockResolvedValue([
            alertRow('alert-1'),
            alertRow('alert-2', {}, SECOND_OWNER),
        ]);
        alertUpdate.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce({});

        const res = await GET(req());

        expect(res.status).toBe(200);
        expect(sendDigest).toHaveBeenCalledTimes(2);
        expect(await res.json()).toMatchObject({ failed: 1, total: 2 });
        expect(failureAlert).toHaveBeenCalledOnce();
    });

    it('reports nothing when every alert succeeds', async () => {
        const res = await GET(req());
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ sent: 1, failed: 0, total: 1 });
        expect(failureAlert).not.toHaveBeenCalled();
        expect(lastRun?.metrics).toMatchObject({ alertsProcessed: 1, emailsSent: 1, alertsFailed: 0 });
    });
});
