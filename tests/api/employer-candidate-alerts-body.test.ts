/**
 * Regression (EMP-ALERT-1): POST /api/employer/candidate-alerts stored its
 * body as it arrived. A 70,000 entry specialties array was saved as one
 * comma string, and the daily candidate-alerts cron split it back into one
 * query branch per entry, past the Postgres bind limit, which aborted the
 * whole run. A non-array value or malformed JSON answered 500.
 *
 * The fix parses the body with zod and answers 400. The caps come from the
 * option lists the settings page offers (every state, twice the specialty
 * presets). The second block pins the payloads the settings page really
 * sends (app/employer/settings/EmployerSettingsClient.tsx posts back the
 * GET object, extra id and a null workMode included), so validation never
 * breaks a real save.
 *
 * Prisma and Supabase are mocked; nothing here touches a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SPECIALTY_PRESETS, LICENSE_STATE_OPTIONS } from '@/config/niche/credentials';

let mockUser: { id: string } | null = null;
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: mockUser }, error: null }) },
    }),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: async () => null,
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));

const profileFindUnique = vi.fn();
const alertFindFirst = vi.fn();
const alertCreate = vi.fn();
const alertUpdate = vi.fn();
vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: { findUnique: (...a: unknown[]) => profileFindUnique(...a) },
        employerCandidateAlert: {
            findFirst: (...a: unknown[]) => alertFindFirst(...a),
            create: (...a: unknown[]) => alertCreate(...a),
            update: (...a: unknown[]) => alertUpdate(...a),
            updateMany: vi.fn(),
        },
    },
}));

import { GET, POST } from '@/app/api/employer/candidate-alerts/route';

const MAX_SPECIALTIES = SPECIALTY_PRESETS.length * 2;

function post(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/employer/candidate-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

function expectNoWrite(): void {
    expect(alertCreate).not.toHaveBeenCalled();
    expect(alertUpdate).not.toHaveBeenCalled();
}

beforeEach(() => {
    mockUser = { id: 'supa-emp-1' };
    profileFindUnique.mockReset().mockResolvedValue({ id: 'profile-emp-1', role: 'employer' });
    alertFindFirst.mockReset().mockResolvedValue(null);
    alertCreate.mockReset().mockResolvedValue({});
    alertUpdate.mockReset().mockResolvedValue({});
});

describe('POST /api/employer/candidate-alerts rejects bodies outside the schema (EMP-ALERT-1)', () => {
    it('rejects the reported attack: a 70,000 entry specialties array', async () => {
        const res = await POST(post({ specialties: Array.from({ length: 70_000 }, () => 'a') }));
        expect(res.status).toBe(400);
        expectNoWrite();
    });

    it('rejects a specialties list one over the cap and accepts one at the cap', async () => {
        const over = Array.from({ length: MAX_SPECIALTIES + 1 }, (_, i) => `Specialty ${i}`);
        expect((await POST(post({ specialties: over }))).status).toBe(400);
        expectNoWrite();

        const atCap = over.slice(0, MAX_SPECIALTIES);
        expect((await POST(post({ specialties: atCap }))).status).toBe(200);
        expect(alertCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({ specialties: atCap.join(',') }),
        });
    });

    it('rejects a specialty holding a comma, which would re-split past the count cap in the cron', async () => {
        const res = await POST(post({ specialties: [Array.from({ length: 5_000 }, () => 'a').join(',')] }));
        expect(res.status).toBe(400);
        expectNoWrite();
    });

    it('rejects a blank specialty and one over 60 characters', async () => {
        expect((await POST(post({ specialties: ['   '] }))).status).toBe(400);
        expect((await POST(post({ specialties: ['x'.repeat(61)] }))).status).toBe(400);
        expectNoWrite();
    });

    it('answers 400, not 500, for lists that are not arrays', async () => {
        expect((await POST(post({ specialties: 'Oncology' }))).status).toBe(400);
        expect((await POST(post({ states: 'TX' }))).status).toBe(400);
        expect((await POST(post({ specialties: { 0: 'Oncology', length: 1 } }))).status).toBe(400);
        expectNoWrite();
    });

    it('rejects a state that is not a two-letter code', async () => {
        for (const state of ['TX,', 'T1', 'Texas', '', 'T']) {
            const res = await POST(post({ states: [state] }));
            expect(res.status, `state ${JSON.stringify(state)}`).toBe(400);
        }
        expectNoWrite();
    });

    it('rejects more states than there are codes', async () => {
        const res = await POST(post({ states: [...LICENSE_STATE_OPTIONS, 'TX'] }));
        expect(res.status).toBe(400);
        expectNoWrite();
    });

    it('rejects wrong types for minExperience, workMode and isActive', async () => {
        const bad: Record<string, unknown>[] = [
            { minExperience: '5' },
            { minExperience: 1.5 },
            { minExperience: -1 },
            { minExperience: 61 },
            { workMode: 5 },
            { workMode: 'x'.repeat(31) },
            { isActive: 'yes' },
        ];
        for (const body of bad) {
            const res = await POST(post(body));
            expect(res.status, JSON.stringify(body)).toBe(400);
        }
        expectNoWrite();
    });

    it('answers 400 for malformed JSON and for a body that is not an object', async () => {
        for (const raw of ['{not json', 'null', '[]', '"text"', '42']) {
            const res = await POST(post(raw));
            expect(res.status, raw).toBe(400);
        }
        expectNoWrite();
    });

    it('still answers 403 to a job seeker before reading the body', async () => {
        profileFindUnique.mockResolvedValue({ id: 'profile-seeker-1', role: 'job_seeker' });
        const res = await POST(post({ specialties: 'not even an array' }));
        expect(res.status).toBe(403);
        expectNoWrite();
    });

    it('still answers 401 to an anonymous caller', async () => {
        mockUser = null;
        const res = await POST(post({}));
        expect(res.status).toBe(401);
        expectNoWrite();
    });
});

describe('POST /api/employer/candidate-alerts keeps every real settings page save working', () => {
    it('saves the first-time payload (empty lists, empty work mode, alerts off)', async () => {
        const res = await POST(post({ specialties: [], states: [], minExperience: null, workMode: '', isActive: false }));
        expect(res.status).toBe(200);
        expect(alertCreate).toHaveBeenCalledWith({
            data: {
                employerId: 'profile-emp-1',
                specialties: null,
                states: null,
                minExperience: null,
                workMode: null,
                isActive: false,
            },
        });
    });

    it('saves the GET object posted back, with its extra id and a null workMode', async () => {
        alertFindFirst.mockResolvedValue({ id: 'alert-1' });
        const res = await POST(post({
            id: 'alert-1',
            specialties: ['Oncology', 'Primary Care'],
            states: ['TX', 'CA'],
            minExperience: 5,
            workMode: null,
            isActive: true,
        }));
        expect(res.status).toBe(200);
        expect(alertUpdate).toHaveBeenCalledWith({
            where: { id: 'alert-1' },
            data: {
                specialties: 'Oncology,Primary Care',
                states: 'TX,CA',
                minExperience: 5,
                workMode: null,
                isActive: true,
            },
        });
        expect(alertCreate).not.toHaveBeenCalled();
    });

    it('saves a full selection: every specialty preset, every state, each experience and work mode option', async () => {
        for (const minExperience of [0, 1, 3, 5, 10]) {
            for (const workMode of ['Remote', 'On-site', 'Hybrid', 'Telehealth', 'Any']) {
                alertCreate.mockClear();
                const res = await POST(post({
                    specialties: [...SPECIALTY_PRESETS],
                    states: [...LICENSE_STATE_OPTIONS],
                    minExperience,
                    workMode,
                    isActive: true,
                }));
                expect(res.status, `${minExperience} ${workMode}`).toBe(200);
                expect(alertCreate).toHaveBeenCalledWith({
                    data: {
                        employerId: 'profile-emp-1',
                        specialties: SPECIALTY_PRESETS.join(','),
                        states: LICENSE_STATE_OPTIONS.join(','),
                        minExperience,
                        workMode,
                        isActive: true,
                    },
                });
            }
        }
    });

    it('saves a preset list plus values from an earlier list that GET handed back', async () => {
        const earlier = ['Child and Adolescent', 'Substance Use', 'Forensic'];
        const res = await POST(post({ specialties: [...earlier, ...SPECIALTY_PRESETS] }));
        expect(res.status).toBe(200);
        expect(alertCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({ specialties: [...earlier, ...SPECIALTY_PRESETS].join(',') }),
        });
    });

    it('stores trimmed, upper-cased, de-duplicated values', async () => {
        const res = await POST(post({
            specialties: [' Oncology ', 'Oncology'],
            states: ['tx', 'TX', ' ca '],
            workMode: ' Remote ',
        }));
        expect(res.status).toBe(200);
        expect(alertCreate).toHaveBeenCalledWith({
            data: {
                employerId: 'profile-emp-1',
                specialties: 'Oncology',
                states: 'TX,CA',
                minExperience: null,
                workMode: 'Remote',
                isActive: true,
            },
        });
    });
});

describe('GET /api/employer/candidate-alerts hands back lists the POST accepts', () => {
    it('drops empty entries from a stored row so the settings page can save it again', async () => {
        alertFindFirst.mockResolvedValue({
            id: 'alert-1',
            specialties: 'Oncology,,',
            states: 'TX,',
            minExperience: null,
            workMode: null,
            isActive: true,
        });
        const res = await GET();
        expect(res.status).toBe(200);
        const { alert } = await res.json();
        expect(alert.specialties).toEqual(['Oncology']);
        expect(alert.states).toEqual(['TX']);

        // Round trip: posting the GET object back succeeds.
        const saved = await POST(post(alert));
        expect(saved.status).toBe(200);
    });

    it('hands back a row stored before the caps cut to the entries the digest uses, so it saves again', async () => {
        // Register 2.26: GET returned every stored entry, so a row saved before
        // EMP-ALERT-1 came back over the cap and the page could not save it.
        alertFindFirst.mockResolvedValue({
            id: 'alert-1',
            specialties: Array.from({ length: 5_000 }, (_, i) => `Specialty ${i}`).join(','),
            states: [...LICENSE_STATE_OPTIONS, ...LICENSE_STATE_OPTIONS].join(','),
            minExperience: null,
            workMode: null,
            isActive: true,
        });
        const { alert } = await (await GET()).json();
        expect(alert.specialties).toHaveLength(MAX_SPECIALTIES);
        expect(alert.specialties[0]).toBe('Specialty 0');
        expect(alert.states).toEqual(LICENSE_STATE_OPTIONS);

        expect((await POST(post(alert))).status).toBe(200);
    });
});
