/**
 * Sibling of AUTOFILL-CLASSIFY-1 (both fix reviews: "Profile block", "take
 * limits are a cheap addition"): the autofill AI routes loaded every license,
 * certification and education row into the model prompt. The profile routes
 * cap each field's length but not the number of rows, so a profile padded
 * with thousands of rows put megabytes into every generation, which still
 * counted as one.
 *
 * Locks in:
 *   - classify-fields, generate-answer, generate-bulk and
 *     generate-cover-letter read a bounded number of rows per section, so
 *     the prompt stays under a fixed size whatever the profile holds;
 *   - a real profile is untouched: an NP licensed in every state still has
 *     every license in the prompt.
 *
 * Prisma, the gateway and storage are mocked: the only database is
 * production. The userProfile.findUnique mock honours `take` the way Prisma
 * does, so the tests see what the real query would return.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { complete } from '@/lib/ai/gateway';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: { findUnique: vi.fn() },
        autofillUsage: { aggregate: vi.fn(), create: vi.fn() },
        candidateOpenEndedResponse: { findMany: vi.fn() },
    },
}));

vi.mock('@/lib/verify-extension-token', () => ({
    verifyExtensionToken: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    checkRateLimit: vi.fn(async () => ({ success: true, reset: 0, remaining: 1 })),
    RATE_LIMITS: { autofill: { limit: 30, windowSeconds: 60 } },
}));

vi.mock('@/lib/ai/feature-flags', () => ({
    isAiFeatureEnabled: vi.fn(async () => true),
}));

vi.mock('@/lib/ai/gateway', () => ({
    complete: vi.fn(),
}));

vi.mock('@/lib/resume-storage', () => ({
    mintResumeReadUrl: vi.fn(async () => null),
    extractRequestContext: vi.fn(() => ({})),
}));

vi.mock('@/lib/resume-parser', () => ({
    extractResumeText: vi.fn(async () => ''),
}));

import { POST as classifyPOST } from '@/app/api/autofill/classify-fields/route';
import { POST as answerPOST } from '@/app/api/autofill/generate-answer/route';
import { POST as bulkPOST } from '@/app/api/autofill/generate-bulk/route';
import { POST as coverLetterPOST } from '@/app/api/autofill/generate-cover-letter/route';

const USER = { userId: 'user-6', supabaseId: 'sb-6', email: 'u@example.com', role: 'pro' };

const STATE_CODES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
    'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
    'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

type Rows = Record<string, unknown>[];
type Profile = Record<string, unknown> & { licenses: Rows; certificationRecords: Rows; education: Rows; workExperience: Rows };

const pad = (i: number) => String(i).padStart(4, '0');
const rows = (n: number, make: (i: number) => Record<string, unknown>): Rows => Array.from({ length: n }, (_, i) => make(i));

function baseProfile(): Omit<Profile, 'licenses' | 'certificationRecords' | 'education' | 'workExperience'> {
    return {
        role: 'pro',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        resumeUrl: null,
        supabaseId: USER.supabaseId,
    };
}

/** Every section padded to `n` rows, each field at the length the profile routes allow. */
function paddedProfile(n: number): Profile {
    return {
        ...baseProfile(),
        licenses: rows(n, (i) => ({ licenseType: 'Compact (APRN)', licenseState: `ST${pad(i)}`, licenseNumber: `LN${pad(i)}` })),
        certificationRecords: rows(n, (i) => ({ certificationName: `${'C'.repeat(96)}${pad(i)}`, certificationNumber: null })),
        education: rows(n, (i) => ({ degreeType: 'D'.repeat(50), fieldOfStudy: 'F'.repeat(200), schoolName: `${'S'.repeat(196)}${pad(i)}`, graduationDate: null })),
        workExperience: rows(n, () => ({ jobTitle: 'J'.repeat(200), employerName: 'E'.repeat(200), isCurrent: false, description: 'W'.repeat(2_000) })),
    };
}

/** An NP licensed in every state and DC, plus a multistate RN license. */
function everyStateProfile(): Profile {
    return {
        ...baseProfile(),
        licenses: [
            ...STATE_CODES.map((state, i) => ({ licenseType: 'APRN', licenseState: state, licenseNumber: `AP${pad(i)}` })),
            { licenseType: 'Compact (NLC)', licenseState: 'TX', licenseNumber: 'RN0001' },
        ],
        certificationRecords: [{ certificationName: 'FNP-BC', certificationNumber: null }],
        education: [{ degreeType: 'MSN', fieldOfStudy: 'Family Nurse Practitioner', schoolName: 'State University', graduationDate: null }],
        workExperience: [{ jobTitle: 'Nurse Practitioner', employerName: 'Acme Clinic', isCurrent: true, description: '' }],
    };
}

/** What Prisma returns for `include`: list relations cut to `take` when one is given. */
function applyInclude(profile: Profile, args: unknown): Profile {
    const include = (args as { include?: Record<string, unknown> } | undefined)?.include ?? {};
    const out: Record<string, unknown> = { ...profile };
    for (const [key, spec] of Object.entries(include)) {
        const all = profile[key];
        if (!Array.isArray(all)) continue;
        const take = typeof spec === 'object' && spec !== null ? (spec as { take?: unknown }).take : undefined;
        out[key] = typeof take === 'number' ? all.slice(0, take) : all;
    }
    return out as Profile;
}

function useProfile(profile: Profile): void {
    vi.mocked(prisma.userProfile.findUnique).mockImplementation((async (args: unknown) => applyInclude(profile, args)) as never);
}

function post(handler: (req: NextRequest) => Promise<Response>, route: string, body: unknown): Promise<Response> {
    return handler(new NextRequest(`http://localhost/api/autofill/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
        body: JSON.stringify(body),
    }));
}

/** The user message handed to the gateway on the only complete() call. */
function promptSent(): string {
    const calls = vi.mocked(complete).mock.calls;
    expect(calls).toHaveLength(1);
    const messages = (calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages;
    return messages.find((m) => m.role === 'user')?.content ?? '';
}

const ROUTES: Array<[string, (req: NextRequest) => Promise<Response>, string, unknown]> = [
    ['classify-fields', classifyPOST, 'classify-fields', { fields: [{ label: 'States where you hold an active license', fieldType: 'text', attributes: { name: 'licensed_states' }, options: [] }] }],
    ['generate-answer', answerPOST, 'generate-answer', { questionText: 'Which states are you licensed in?' }],
    ['generate-bulk', bulkPOST, 'generate-bulk', { questions: [{ questionText: 'Which states are you licensed in?' }] }],
    ['generate-cover-letter', coverLetterPOST, 'generate-cover-letter', { jobTitle: 'Family Nurse Practitioner', employerName: 'Acme Health' }],
];

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyExtensionToken).mockResolvedValue(USER as never);
    vi.mocked(prisma.autofillUsage.aggregate).mockResolvedValue({ _sum: { aiGenerations: 0 } } as never);
    vi.mocked(prisma.autofillUsage.create).mockResolvedValue({} as never);
    vi.mocked(prisma.candidateOpenEndedResponse.findMany).mockResolvedValue([] as never);
    vi.mocked(complete).mockResolvedValue({ content: '{"fields":[]}', model: 'test-model' } as never);
});

describe('autofill AI prompts read a bounded number of profile rows', () => {
    it.each(ROUTES)('%s keeps a profile padded with 5,000 rows per section under 100,000 characters', async (_name, handler, route, body) => {
        useProfile(paddedProfile(5_000));
        const res = await post(handler, route, body);
        expect(res.status).toBe(200);
        const prompt = promptSent();
        expect(prompt).toContain('Compact (APRN) (ST0000)');
        expect(prompt.length).toBeLessThan(100_000);
    });

    it.each(ROUTES)('%s still lists every license of an NP licensed in every state', async (_name, handler, route, body) => {
        useProfile(everyStateProfile());
        const res = await post(handler, route, body);
        expect(res.status).toBe(200);
        const prompt = promptSent();
        for (const state of STATE_CODES) expect(prompt).toContain(`APRN (${state})`);
        expect(prompt).toContain('Compact (NLC) (TX)');
    });
});
