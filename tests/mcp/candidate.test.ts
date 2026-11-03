/**
 * lib/mcp/candidate.ts: the signed-in candidate's tools.
 *
 * Pinned:
 *   - start_application: an Easy Apply job shows its screening questions with
 *     no knockout setting in or out of the query; any other job gets the
 *     employer's link only through safeApplyHref and canSubmit false; a
 *     resume key outside the candidate's own upload folder counts as no
 *     resume; an existing application is reported;
 *   - submit_application: rate limited per candidate before anything else,
 *     gated on the same visibility as the job page, hands the shared routine
 *     the visible job's id, the caller's own id and `allowSandboxJob` only for
 *     a reviewer, rewords each refusal, never logs the cover letter;
 *   - track_employer_site_application: refuses Easy Apply jobs, creates the
 *     tracker row once and never rewrites it, survives a P2002 race;
 *   - list_my_applications: never selects the employer notes or the AI
 *     assessment, only the caller's rows, the withdrawn rule, summary counts,
 *     Easy Apply from sourceUrl === 'platform';
 *   - withdraw_application: another candidate's id answers exactly like a
 *     missing one and writes nothing; the scrub matches the site route;
 *   - save, unsave and the saved list (saved order, closed jobs dropped);
 *   - get_my_profile_status never returns an NPI or DEA number, nor a missing
 *     item that names one.
 *
 * Prisma is a fake that projects stored rows through each query's select, so
 * a widened select fails here instead of passing on a canned row. Nothing
 * reaches a database or the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
    job: { findFirst: vi.fn(), findMany: vi.fn() },
    userProfile: { findUnique: vi.fn() },
    jobApplication: { findUnique: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(), create: vi.fn(), update: vi.fn() },
    savedJob: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    checkRateLimit: vi.fn(),
    submit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    applyDirectBudget: { limit: 10, windowSeconds: 60 },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: { job: h.job, userProfile: h.userProfile, jobApplication: h.jobApplication, savedJob: h.savedJob },
}));
vi.mock('@/lib/rate-limit', () => ({
    checkRateLimit: h.checkRateLimit,
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { applyDirect: h.applyDirectBudget },
}));
vi.mock('@/lib/applications/submit-direct-application', () => ({
    submitDirectApplication: h.submit,
    MAX_COVER_LETTER_LENGTH: 5000,
}));
vi.mock('@/lib/logger', () => ({ logger: h.logger }));

import {
    JOB_GONE,
    listApplications,
    listSavedJobs,
    profileStatus,
    saveJob,
    startApplication,
    submitApplication,
    trackEmployerSiteApplication,
    unsaveJob,
    withdrawApplication,
} from '@/lib/mcp/candidate';
import type { McpViewer } from '@/lib/mcp/jobs';
import type { ApplyView, SubmitApplicationInput } from '@/lib/mcp/contracts';
import { APPLY_CONSENT_TEXT, COVER_LETTER_MAX } from '@/lib/mcp/tool-names';
import { REVIEW_SANDBOX_SOURCE_PROVIDER } from '@/lib/mcp/sandbox';
import { safeApplyHref } from '@/components/jobs/safe-external-href';
import { calculateCompleteness, type ProfileDataV2 } from '@/lib/profile-completeness';
import { brand } from '@/config/brand';
import {
    JOB_ID,
    JOB_ID_2,
    JOB_ID_3,
    ME,
    SANDBOX_JOB_ID,
    SITE,
    SOMEONE_ELSE,
    deepKeys,
    jobDetailRow,
    jobRow,
    projectRow,
    type Row,
} from './fixtures';

const CANDIDATE: McpViewer = { userId: ME, reviewer: false };
const REVIEWER: McpViewer = { userId: ME, reviewer: true };
const MY_APPLICATIONS = `${SITE}/my-applications`;
const EMPLOYER_LINK = 'https://careers.northside.example/apply/123';
const OWN_RESUME = `local/${ME}/1700000000000-Jane-Doe-CV.pdf`;
const FOREIGN_RESUME = `local/${SOMEONE_ELSE}/1700000000001-cv.pdf`;
const STORAGE = 'https://test.supabase.co/storage/v1/object';

// ── A tiny where evaluator for the operators these queries use ─────────────

function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (key === 'OR') return (condition as Row[]).some((branch) => matches(row, branch));
        if (key === 'AND') return (condition as Row[]).every((branch) => matches(row, branch));
        const value = row[key];
        if (condition === null) return value === null || value === undefined;
        if (typeof condition !== 'object' || condition instanceof Date) return value === condition;
        const ops = condition as Row;
        if ('not' in ops) return ops.not === null ? value !== null && value !== undefined : value !== ops.not;
        if ('in' in ops) return (ops.in as unknown[]).includes(value);
        throw new Error(`the fake does not evaluate ${key}: ${JSON.stringify(condition)}`);
    });
}

// ── Stored rows ─────────────────────────────────────────────────────────────

const QUESTIONS: Row[] = [
    {
        id: 'q1',
        jobId: JOB_ID,
        questionText: 'Do you hold an active Texas APRN license?',
        questionType: 'boolean',
        options: [],
        isRequired: true,
        isKnockout: true,
        knockoutAnswer: 'KNOCKOUT-no',
        sortOrder: 0,
    },
    {
        id: 'q2',
        jobId: JOB_ID,
        questionText: 'Preferred shift',
        questionType: 'select',
        options: ['Days', 'Nights'],
        isRequired: false,
        isKnockout: false,
        knockoutAnswer: null,
        sortOrder: 1,
    },
    {
        id: 'q3',
        jobId: JOB_ID,
        questionText: 'Languages spoken',
        questionType: 'multiselect',
        options: [],
        isRequired: false,
        isKnockout: true,
        knockoutAnswer: 'KNOCKOUT-none',
        sortOrder: 2,
    },
];

/** A job as stored, every column the tools could ask for. */
function storedJob(overrides: Row = {}): Row {
    return { ...jobDetailRow(), screeningQuestions: QUESTIONS, expiresAt: null, ...overrides };
}

function storedProfile(overrides: Row = {}): Row {
    return {
        id: 'profile-1',
        supabaseId: ME,
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '555-0100',
        headline: 'Family NP, six years in primary care',
        addressLine1: '1 Main St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        npiNumber: '1234567893',
        deaNumber: 'AB1234563',
        resumeUrl: OWN_RESUME,
        bio: 'Family nurse practitioner focused on preventive care for rural adults and children.',
        specialties: 'Family Practice, Pediatrics',
        licenseStates: 'TX, CA,',
        yearsExperience: 6,
        skills: ['Suturing'],
        _count: {
            licenses: 1,
            certificationRecords: 1,
            education: 1,
            workExperience: 1,
            screeningAnswers: 5,
            openEndedResponses: 3,
            candidateReferences: 3,
        },
        ...overrides,
    };
}

function storedApplication(overrides: Row = {}, jobOverrides: Row = {}): Row {
    return {
        id: 'app-1',
        userId: ME,
        jobId: JOB_ID,
        sourceUrl: 'platform',
        coverLetter: 'Dear Northside team',
        coverLetterUrl: null,
        resumeUrl: OWN_RESUME,
        appliedAt: new Date('2026-10-01T12:00:00.000Z'),
        status: 'screening',
        notes: 'EMPLOYER-PRIVATE note',
        statusUpdatedAt: null,
        consentGiven: true,
        consentGivenAt: new Date('2026-10-01T12:00:00.000Z'),
        withdrawnAt: null,
        aiMatchScore: 87,
        aiMatchReasons: ['EMPLOYER-PRIVATE reason'],
        aiMissingItems: ['EMPLOYER-PRIVATE missing item'],
        screeningAnswers: [{ questionId: 'q1', questionText: 'Licensed?', answer: 'yes' }],
        job: {
            ...storedJob({ applyLink: 'https://careers.northside.example/EMPLOYER-PRIVATE' }),
            employerJobs: { contactEmail: 'EMPLOYER-PRIVATE@northside.example' },
            ...jobOverrides,
        },
        ...overrides,
    };
}

let jobs: Row[];
let profile: Row | null;
let applications: Row[];
let savedRows: Row[];

function jobQueryWhere(callIndex = 0): Row {
    return (h.job.findFirst.mock.calls[callIndex][0] as { where: Row }).where;
}

/**
 * The publication half of visibleJobWhere (lib/mcp/jobs.ts), evaluated: the
 * public rule (`isPublished: true` at the top) or the reviewer rule (an OR of
 * the public rule and the sandbox). Expiry and dead links are pinned on the
 * where shape in tests/mcp/jobs.test.ts.
 */
function findVisibleJob(where: Row): Row | undefined {
    const job = jobs.find((row) => row.id === where.id);
    if (!job) return undefined;
    const sandbox = job.isPublished === false && job.sourceProvider === REVIEW_SANDBOX_SOURCE_PROVIDER;
    if (where.isPublished === true) return job.isPublished === true ? job : undefined;
    return job.isPublished === true || sandbox ? job : undefined;
}

beforeEach(() => {
    jobs = [storedJob()];
    profile = storedProfile();
    applications = [];
    savedRows = [];

    h.job.findFirst.mockReset().mockImplementation(async (args: { where: Row; select: Row }) => {
        const row = findVisibleJob(args.where);
        return row ? projectRow(row, args.select) : null;
    });
    h.job.findMany.mockReset().mockImplementation(async (args: { where: { AND: Row[] }; select: Row }) => {
        const ids = ((args.where.AND[0] as { id: { in: string[] } }).id.in) ?? [];
        return jobs.filter((job) => ids.includes(job.id as string)).map((job) => projectRow(job, args.select));
    });
    h.userProfile.findUnique.mockReset().mockImplementation(async (args: { where: { supabaseId: string }; select: Row }) =>
        profile && profile.supabaseId === args.where.supabaseId ? projectRow(profile, args.select) : null,
    );
    h.jobApplication.findUnique.mockReset().mockImplementation(async (args: { where: Row; select: Row }) => {
        const key = args.where.userId_jobId as { userId: string; jobId: string } | undefined;
        const row = key
            ? applications.find((a) => a.userId === key.userId && a.jobId === key.jobId)
            : applications.find((a) => a.id === args.where.id);
        return row ? projectRow(row, args.select) : null;
    });
    h.jobApplication.findMany.mockReset().mockImplementation(
        async (args: { where: Row; select: Row; take?: number }) => {
            const found = applications.filter((a) => matches(a, args.where));
            return found
                .slice(0, args.take ?? found.length)
                .map((a) => projectRow(a, args.select));
        },
    );
    h.jobApplication.groupBy.mockReset().mockImplementation(async (args: { by: string[]; where: Row }) => {
        const groups = new Map<string, { sample: Row; count: number }>();
        for (const row of applications.filter((a) => matches(a, args.where))) {
            const key = args.by.map((field) => JSON.stringify(row[field] ?? null)).join('|');
            const group = groups.get(key) ?? { sample: row, count: 0 };
            group.count += 1;
            groups.set(key, group);
        }
        return [...groups.values()].map(({ sample, count }) => ({
            ...Object.fromEntries(args.by.map((field) => [field, sample[field] ?? null])),
            _count: { _all: count },
        }));
    });
    h.jobApplication.create.mockReset().mockResolvedValue({ id: 'app-new' });
    h.jobApplication.update.mockReset().mockResolvedValue({});
    h.savedJob.findMany.mockReset().mockImplementation(
        async (args: { where: Row; select: Row; orderBy?: Row; take?: number }) => {
            let found = savedRows.filter((row) => matches(row, args.where));
            if (args.orderBy) found = [...found].sort((a, b) => (b.savedAt as Date).getTime() - (a.savedAt as Date).getTime());
            return found.slice(0, args.take ?? found.length).map((row) => projectRow(row, args.select));
        },
    );
    h.savedJob.upsert.mockReset().mockResolvedValue({});
    h.savedJob.deleteMany.mockReset().mockResolvedValue({ count: 1 });
    h.checkRateLimit.mockReset().mockResolvedValue({ success: true, reset: Date.now() + 60_000, remaining: 9 });
    h.submit.mockReset();
    for (const fn of Object.values(h.logger)) fn.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

// ── start_application ───────────────────────────────────────────────────────

async function start(viewer: McpViewer, jobArg: string = JOB_ID, draft?: string): Promise<ApplyView> {
    const view = await startApplication(viewer, jobArg, draft);
    if (typeof view === 'string') throw new Error(`refused: ${view}`);
    return view;
}

describe('start_application: an Easy Apply job', () => {
    it('shows the screening questions, and no knockout setting ever leaves the server', async () => {
        const view = await start(CANDIDATE);
        expect(view.questions).toEqual([
            { id: 'q1', text: 'Do you hold an active Texas APRN license?', type: 'boolean', options: [], required: true },
            { id: 'q2', text: 'Preferred shift', type: 'select', options: ['Days', 'Nights'], required: false },
            { id: 'q3', text: 'Languages spoken', type: 'text', options: [], required: false },
        ]);
        expect(JSON.stringify(view)).not.toContain('KNOCKOUT');
        expect(deepKeys(view)).not.toContain('isKnockout');
        expect(deepKeys(view)).not.toContain('knockoutAnswer');
        const select = (h.job.findFirst.mock.calls[0][0] as { select: Row }).select;
        expect(deepKeys(select)).not.toContain('isKnockout');
        expect(deepKeys(select)).not.toContain('knockoutAnswer');
    });

    it('can be submitted, and never offers the employer link even when the job has one', async () => {
        const view = await start(CANDIDATE);
        expect(view.job.applyRoute).toBe('easy_apply');
        expect(view.canSubmit).toBe(true);
        expect(view.blockedReason).toBeNull();
        expect(view.employerApplyUrl).toBeNull();
        expect(JSON.stringify(view)).not.toContain(EMPLOYER_LINK);
    });

    it('carries the consent line, the links and the draft, clipped to the cover letter cap', async () => {
        const view = await start(CANDIDATE, JOB_ID, 'Dear Northside team');
        expect(view).toMatchObject({
            view: 'apply',
            consentText: APPLY_CONSENT_TEXT,
            privacyUrl: `${SITE}/privacy`,
            profileUrl: `${SITE}/settings?tab=personal#section-resume`,
            coverLetterDraft: 'Dear Northside team',
            coverLetterMax: COVER_LETTER_MAX,
            candidate: { firstName: 'Jane', headline: 'Family NP, six years in primary care' },
        });
        expect((await start(CANDIDATE)).coverLetterDraft).toBe('');
        expect((await start(CANDIDATE, JOB_ID, 'x'.repeat(COVER_LETTER_MAX + 50))).coverLetterDraft).toHaveLength(COVER_LETTER_MAX);
    });
});

describe('start_application: a job that continues on the employer site', () => {
    it('employer site: the link, through safeApplyHref, canSubmit false and no questions', async () => {
        jobs = [storedJob({ applyOnPlatform: false, sourceType: 'employer', applyLink: EMPLOYER_LINK })];
        const view = await start(CANDIDATE);
        expect(view.job.applyRoute).toBe('employer_site');
        expect(view.employerApplyUrl).toBe(safeApplyHref(EMPLOYER_LINK));
        expect(view.canSubmit).toBe(false);
        expect(view.blockedReason).toBe('This employer takes applications on their own site.');
        expect(view.questions).toEqual([]);
    });

    it('external: the same link rule and canSubmit false', async () => {
        const link = 'https://board.example/listing/1';
        jobs = [storedJob({ applyOnPlatform: false, sourceType: 'aggregator', applyLink: link })];
        const view = await start(CANDIDATE);
        expect(view.job.applyRoute).toBe('external');
        expect(view.employerApplyUrl).toBe(link);
        expect(view.canSubmit).toBe(false);
    });

    it.each([
        ['a javascript: URL', 'javascript:alert(document.cookie)', null],
        ['a data: URL', 'data:text/html,<script>alert(1)</script>', null],
        ['a protocol-relative URL', '//evil.example/apply', null],
        ['a URL with a space', 'https://northside.example/apply now', null],
        ['a mailto address', 'mailto:jobs@northside.example', 'mailto:jobs@northside.example'],
        ['a bare host', 'www.northside.example/apply', 'https://www.northside.example/apply'],
    ])('%s becomes exactly what safeApplyHref allows', async (_label, raw, expected) => {
        jobs = [storedJob({ applyOnPlatform: false, sourceType: 'employer', applyLink: raw })];
        const view = await start(CANDIDATE);
        expect(view.employerApplyUrl).toBe(expected);
        expect(view.employerApplyUrl).toBe(safeApplyHref(raw));
        if (expected === null) expect(JSON.stringify(view)).not.toContain(raw);
    });

    it('no link at all: nothing to follow, and a plain reason', async () => {
        jobs = [storedJob({ applyOnPlatform: false, sourceType: 'aggregator', applyLink: null })];
        const view = await start(CANDIDATE);
        expect(view.job.applyRoute).toBe('none');
        expect(view.employerApplyUrl).toBeNull();
        expect(view.canSubmit).toBe(false);
        expect(view.blockedReason).toBe('This job has no application link right now.');
    });
});

describe("start_application: the resume is the candidate's own or none", () => {
    it.each([
        ['their own key', OWN_RESUME, true, 'Jane-Doe-CV.pdf'],
        ['their own signed link', `${STORAGE}/sign/resumes/${OWN_RESUME}?token=t`, true, 'Jane-Doe-CV.pdf'],
        ["another candidate's key", FOREIGN_RESUME, false, null],
        ["a signed link to another candidate's file", `${STORAGE}/sign/resumes/${FOREIGN_RESUME}?token=t`, false, null],
        ['a dot-dot path out of their folder', `local/${ME}/../${SOMEONE_ELSE}/1700000000001-cv.pdf`, false, null],
        ['an outside link', 'https://example.com/resume.pdf', false, null],
        ['nothing', null, false, null],
    ])('%s: onFile %s', async (_label, resumeUrl, onFile, fileName) => {
        profile = storedProfile({ resumeUrl });
        const view = await start(CANDIDATE);
        expect(view.resume).toEqual({ onFile, fileName });
        expect(h.userProfile.findUnique.mock.calls[0][0]).toMatchObject({ where: { supabaseId: ME } });
    });

    it('no profile row: no resume and no name, still a review', async () => {
        profile = null;
        const view = await start(CANDIDATE);
        expect(view.resume).toEqual({ onFile: false, fileName: null });
        expect(view.candidate).toEqual({ firstName: null, headline: null });
    });
});

describe('start_application: an existing application', () => {
    it.each([
        ['an active one', { status: 'interview', withdrawnAt: null }, 'interview', 'Interview'],
        ['a withdrawn one', { status: 'interview', withdrawnAt: new Date('2026-10-05T00:00:00.000Z') }, 'withdrawn', 'Withdrawn'],
        ['an unknown status', { status: 'mystery', withdrawnAt: null }, 'applied', 'Applied'],
    ])('%s is reported with its status label', async (_label, fields, status, statusLabel) => {
        applications = [storedApplication({ id: 'app-1', ...fields })];
        const view = await start(CANDIDATE, `${SITE}/jobs/fnp-${JOB_ID}`);
        expect(view.existingApplication).toEqual({ id: 'app-1', status, statusLabel, appliedAt: '2026-10-01T12:00:00.000Z' });
        expect(h.jobApplication.findUnique.mock.calls[0][0]).toMatchObject({
            where: { userId_jobId: { userId: ME, jobId: JOB_ID } },
        });
    });

    it("another candidate's application to the job is not theirs", async () => {
        applications = [storedApplication({ id: 'app-other', userId: SOMEONE_ELSE })];
        expect((await start(CANDIDATE)).existingApplication).toBeNull();
    });
});

describe('start_application: visibility', () => {
    it('a job the query does not find, or an argument that names no job, answers JOB_GONE', async () => {
        expect(await startApplication(CANDIDATE, JOB_ID_2)).toBe(JOB_GONE);
        h.job.findFirst.mockClear();
        expect(await startApplication(CANDIDATE, 'no job here')).toBe(JOB_GONE);
        expect(h.job.findFirst).not.toHaveBeenCalled();
        expect(JOB_GONE).toBe(`This job is no longer available on ${brand.name}.`);
    });

    it('a candidate is held to the published, unexpired listing; a reviewer may also open a sandbox job', async () => {
        await startApplication(CANDIDATE, JOB_ID);
        expect(jobQueryWhere()).toMatchObject({ id: JOB_ID, isPublished: true });
        expect(JSON.stringify(jobQueryWhere())).not.toContain(REVIEW_SANDBOX_SOURCE_PROVIDER);

        h.job.findFirst.mockClear();
        await startApplication(REVIEWER, JOB_ID);
        expect(JSON.stringify(jobQueryWhere())).toContain(REVIEW_SANDBOX_SOURCE_PROVIDER);
    });
});

// ── submit_application ──────────────────────────────────────────────────────

const SUBMIT_INPUT: SubmitApplicationInput = {
    job_id: `${SITE}/jobs/family-nurse-practitioner-austin-tx-${JOB_ID}`,
    cover_letter: 'Dear Northside team, COVER-LETTER-TEXT',
    screening_answers: [
        { question_id: 'q1', answer: 'yes' },
        { question_id: 'q2', answer: 'Days' },
    ],
    consent: true,
};

const SUBMITTED = {
    ok: true as const,
    applicationId: 'app-9',
    isNew: true,
    appliedAt: new Date('2026-10-28T09:30:00.000Z'),
    autoRejected: false,
    autoRejectReason: '',
    job: { id: JOB_ID, title: 'Family Nurse Practitioner', employer: 'Northside Clinic' },
};

describe('submit_application', () => {
    it('is rate limited per candidate before any lookup or submission', async () => {
        h.checkRateLimit.mockResolvedValue({ success: false, reset: Date.now() + 30_000, remaining: 0 });
        expect(await submitApplication(CANDIDATE, SUBMIT_INPUT)).toBe(
            'Too many applications in a short time. Wait a minute and try again.',
        );
        expect(h.checkRateLimit).toHaveBeenCalledWith(`mcp:submit:${ME}`, h.applyDirectBudget);
        expect(h.job.findFirst).not.toHaveBeenCalled();
        expect(h.submit).not.toHaveBeenCalled();
    });

    it('a job the viewer may not see is gone, and nothing is submitted', async () => {
        jobs = [];
        expect(await submitApplication(CANDIDATE, SUBMIT_INPUT)).toBe(JOB_GONE);
        expect(await submitApplication(CANDIDATE, { ...SUBMIT_INPUT, job_id: 'nothing' })).toBe(JOB_GONE);
        expect(h.submit).not.toHaveBeenCalled();
        expect(jobQueryWhere()).toMatchObject({ id: JOB_ID, isPublished: true });
    });

    it("hands the shared routine the visible job's id, the caller's own id and the profile resume", async () => {
        h.submit.mockResolvedValue(SUBMITTED);
        await submitApplication(CANDIDATE, SUBMIT_INPUT);
        expect(h.submit).toHaveBeenCalledTimes(1);
        expect(h.submit).toHaveBeenCalledWith({
            userId: ME,
            jobId: JOB_ID,
            coverLetter: SUBMIT_INPUT.cover_letter,
            coverLetterUrl: undefined,
            resumeUrl: undefined,
            consent: true,
            screeningAnswers: [
                { questionId: 'q1', answer: 'yes' },
                { questionId: 'q2', answer: 'Days' },
            ],
            allowSandboxJob: false,
        });
    });

    it('allowSandboxJob is the viewer reviewer flag, nothing else', async () => {
        h.submit.mockResolvedValue(SUBMITTED);
        await submitApplication(REVIEWER, SUBMIT_INPUT);
        expect(h.submit.mock.calls[0][0]).toMatchObject({ allowSandboxJob: true });

        jobs = [storedJob({ id: SANDBOX_JOB_ID, isPublished: false, sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER })];
        h.submit.mockClear();
        await submitApplication(CANDIDATE, { ...SUBMIT_INPUT, job_id: SANDBOX_JOB_ID });
        // A non-reviewer cannot even reach a sandbox job: the visibility gate finds nothing.
        expect(h.submit).not.toHaveBeenCalled();
    });

    it('no answers given: an empty list, not undefined', async () => {
        h.submit.mockResolvedValue(SUBMITTED);
        await submitApplication(CANDIDATE, { job_id: JOB_ID, consent: true });
        expect(h.submit.mock.calls[0][0]).toMatchObject({ screeningAnswers: [], coverLetter: undefined });
    });

    it.each([
        ['This job does not accept platform applications', 'This employer takes applications on their own site, not through Easy Apply.'],
        ['This job is no longer active', JOB_GONE],
        ['This job has expired', JOB_GONE],
        ['Job not found', JOB_GONE],
        [
            'User profile not found',
            `Your ${brand.name} profile could not be found. Sign in on ${brand.domain} once, then try again.`,
        ],
        [
            'You must consent to sharing your data with the employer',
            'The candidate has to agree to share their profile, resume and cover letter with this employer first.',
        ],
        ['Please answer: "Preferred shift"', 'Please answer: "Preferred shift"'],
        ['Please answer the required screening questions', 'Please answer the required screening questions'],
    ])('the refusal %j answers %j', async (error, expected) => {
        h.submit.mockResolvedValue({ ok: false, status: 400, error });
        expect(await submitApplication(CANDIDATE, SUBMIT_INPUT)).toBe(expected);
    });

    it('a first submission: the result view with the routine appliedAt', async () => {
        h.submit.mockResolvedValue(SUBMITTED);
        const view = await submitApplication(CANDIDATE, SUBMIT_INPUT);
        if (typeof view === 'string') throw new Error(view);
        expect(view).toMatchObject({
            view: 'apply-result',
            applicationId: 'app-9',
            resubmitted: false,
            appliedAt: '2026-10-28T09:30:00.000Z',
            myApplicationsUrl: MY_APPLICATIONS,
            job: { id: JOB_ID, title: 'Family Nurse Practitioner', employer: 'Northside Clinic' },
        });
    });

    it('a resubmission: resubmitted, dated when it was updated', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-28T10:15:00.000Z'));
        h.submit.mockResolvedValue({ ...SUBMITTED, isNew: false, appliedAt: new Date('2026-09-01T00:00:00.000Z') });
        const view = await submitApplication(CANDIDATE, SUBMIT_INPUT);
        if (typeof view === 'string') throw new Error(view);
        expect(view.resubmitted).toBe(true);
        expect(view.appliedAt).toBe('2026-10-28T10:15:00.000Z');
    });

    it('never logs the cover letter or the answers', async () => {
        h.submit.mockResolvedValue(SUBMITTED);
        await submitApplication(CANDIDATE, SUBMIT_INPUT);
        const logged = JSON.stringify(Object.values(h.logger).map((fn) => fn.mock.calls));
        expect(logged).not.toContain('COVER-LETTER-TEXT');
        expect(logged).not.toContain('Days');
    });
});

// ── track_employer_site_application ─────────────────────────────────────────

describe('track_employer_site_application', () => {
    beforeEach(() => {
        jobs = [storedJob({ applyOnPlatform: false, sourceType: 'employer', applyLink: EMPLOYER_LINK })];
    });

    it('an Easy Apply job is refused: it goes through start and submit', async () => {
        jobs = [storedJob()];
        expect(await trackEmployerSiteApplication(CANDIDATE, JOB_ID)).toBe(
            'This job takes Easy Apply. Use start_application, then submit_application.',
        );
        expect(h.jobApplication.create).not.toHaveBeenCalled();
    });

    it('a job with no link is refused', async () => {
        jobs = [storedJob({ applyOnPlatform: false, applyLink: null })];
        expect(await trackEmployerSiteApplication(CANDIDATE, JOB_ID)).toBe('This job has no application link right now.');
        expect(h.jobApplication.create).not.toHaveBeenCalled();
    });

    it("creates the caller's tracker row with the safe link, never the Easy Apply marker", async () => {
        const result = await trackEmployerSiteApplication(CANDIDATE, `${SITE}/jobs/fnp-${JOB_ID}`);
        expect(result).toEqual({
            applicationId: 'app-new',
            jobId: JOB_ID,
            alreadyTracked: false,
            employerApplyUrl: EMPLOYER_LINK,
            myApplicationsUrl: MY_APPLICATIONS,
        });
        expect(h.jobApplication.create).toHaveBeenCalledWith({
            data: { userId: ME, jobId: JOB_ID, sourceUrl: EMPLOYER_LINK },
            select: { id: true },
        });
    });

    it('an unsafe stored link is neither returned nor stored', async () => {
        jobs = [storedJob({ applyOnPlatform: false, sourceType: 'employer', applyLink: 'javascript:alert(1)' })];
        const result = await trackEmployerSiteApplication(CANDIDATE, JOB_ID);
        expect(result).toMatchObject({ employerApplyUrl: null, alreadyTracked: false });
        expect(h.jobApplication.create.mock.calls[0][0]).toMatchObject({ data: { sourceUrl: null } });
    });

    it('already tracked (or applied): the existing row, never rewritten', async () => {
        applications = [storedApplication({ id: 'app-old' })];
        const result = await trackEmployerSiteApplication(CANDIDATE, JOB_ID);
        expect(result).toMatchObject({ applicationId: 'app-old', alreadyTracked: true });
        expect(h.jobApplication.create).not.toHaveBeenCalled();
        expect(h.jobApplication.update).not.toHaveBeenCalled();
    });

    it('P2002, a concurrent call created the row first: that row, already tracked', async () => {
        h.jobApplication.create.mockImplementationOnce(async () => {
            applications = [storedApplication({ id: 'app-raced' })];
            throw Object.assign(new Error('Unique constraint failed on the fields: (`user_id`,`job_id`)'), { code: 'P2002' });
        });
        const result = await trackEmployerSiteApplication(CANDIDATE, JOB_ID);
        expect(result).toMatchObject({ applicationId: 'app-raced', alreadyTracked: true });
    });

    it('P2002 with no row to read back, or any other error, still throws', async () => {
        const duplicate = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        h.jobApplication.create.mockRejectedValueOnce(duplicate);
        await expect(trackEmployerSiteApplication(CANDIDATE, JOB_ID)).rejects.toBe(duplicate);

        const other = Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' });
        h.jobApplication.create.mockRejectedValueOnce(other);
        h.jobApplication.findUnique.mockClear();
        await expect(trackEmployerSiteApplication(CANDIDATE, JOB_ID)).rejects.toBe(other);
        expect(h.jobApplication.findUnique).toHaveBeenCalledTimes(1);
    });

    it('a job the viewer may not see is gone', async () => {
        jobs = [];
        expect(await trackEmployerSiteApplication(CANDIDATE, JOB_ID)).toBe(JOB_GONE);
    });
});

// ── list_my_applications ────────────────────────────────────────────────────

describe('list_my_applications', () => {
    const PRIVATE_COLUMNS = ['notes', 'aiMatchScore', 'aiMatchReasons', 'aiMissingItems'];

    it('never selects the employer notes or the AI assessment, and none of it reaches the view', async () => {
        applications = [storedApplication()];
        const view = await listApplications(CANDIDATE, undefined);
        const select = (h.jobApplication.findMany.mock.calls[0][0] as { select: Row }).select;
        for (const column of PRIVATE_COLUMNS) {
            expect(deepKeys(select), column).not.toContain(column);
            expect(deepKeys(view), column).not.toContain(column);
        }
        // Nor the employer's contact email or raw apply link through the job relation.
        expect(deepKeys(select)).not.toContain('employerJobs');
        expect(deepKeys(select)).not.toContain('applyLink');
        expect(JSON.stringify(view)).not.toContain('EMPLOYER-PRIVATE');
    });

    it("lists only the caller's applications, newest first, 20 unless asked", async () => {
        applications = [storedApplication(), storedApplication({ id: 'app-other', userId: SOMEONE_ELSE })];
        const view = await listApplications(CANDIDATE, undefined);
        expect(view.applications.map((a) => a.id)).toEqual(['app-1']);
        expect(h.jobApplication.findMany.mock.calls[0][0]).toMatchObject({
            where: { userId: ME },
            orderBy: { appliedAt: 'desc' },
            take: 20,
        });
        expect(h.jobApplication.groupBy.mock.calls[0][0]).toMatchObject({ where: { userId: ME } });
        expect(view.total).toBe(1);

        h.jobApplication.findMany.mockClear();
        await listApplications(CANDIDATE, undefined, 5);
        expect(h.jobApplication.findMany.mock.calls[0][0]).toMatchObject({ take: 5 });
    });

    it('the withdrawn rule: withdrawnAt wins over the stored status, in the list and in the filters', async () => {
        applications = [
            storedApplication({ id: 'by-status', status: 'withdrawn' }),
            storedApplication({ id: 'by-date', jobId: JOB_ID_2, status: 'interview', withdrawnAt: new Date('2026-10-02T00:00:00.000Z') }),
            storedApplication({ id: 'active', jobId: JOB_ID_3, status: 'interview' }),
        ];
        const all = await listApplications(CANDIDATE, undefined);
        expect(all.applications.map((a) => [a.id, a.status, a.statusLabel, a.canWithdraw])).toEqual([
            ['by-status', 'withdrawn', 'Withdrawn', false],
            ['by-date', 'withdrawn', 'Withdrawn', false],
            ['active', 'interview', 'Interview', true],
        ]);

        const withdrawn = await listApplications(CANDIDATE, 'withdrawn');
        expect(withdrawn.applications.map((a) => a.id)).toEqual(['by-status', 'by-date']);

        const interviews = await listApplications(CANDIDATE, 'interview');
        expect(interviews.applications.map((a) => a.id)).toEqual(['active']);
    });

    it('labels every status the way My Applications does; an unknown status reads Applied', async () => {
        applications = [
            storedApplication({ id: 'a', status: 'rejected' }),
            storedApplication({ id: 'b', status: 'offered' }),
            storedApplication({ id: 'c', status: 'mystery' }),
        ];
        const view = await listApplications(CANDIDATE, undefined);
        expect(view.applications.map((a) => [a.status, a.statusLabel])).toEqual([
            ['rejected', 'Not Selected'],
            ['offered', 'Offered'],
            ['applied', 'Applied'],
        ]);
    });

    it("summary: counts per status in pipeline order, only those present, unknown statuses as applied", async () => {
        applications = [
            storedApplication({ id: 'w', status: 'withdrawn' }),
            storedApplication({ id: 'a1', status: 'applied' }),
            storedApplication({ id: 'a2', status: 'applied' }),
            storedApplication({ id: 'm', status: 'mystery' }),
            storedApplication({ id: 'i1', status: 'interview' }),
            storedApplication({ id: 'r', status: 'rejected' }),
            storedApplication({ id: 'other', userId: SOMEONE_ELSE, status: 'hired' }),
        ];
        const view = await listApplications(CANDIDATE, undefined);
        expect(view.summary).toEqual([
            { status: 'applied', label: 'Applied', count: 3 },
            { status: 'interview', label: 'Interview', count: 1 },
            { status: 'rejected', label: 'Not Selected', count: 1 },
            { status: 'withdrawn', label: 'Withdrawn', count: 1 },
        ]);
        expect(view.total).toBe(6);
        expect(view.myApplicationsUrl).toBe(MY_APPLICATIONS);
    });

    // Regression: the summary grouped by the stored `status` only, while the
    // list and the status filter treat a row with `withdrawnAt` set as
    // withdrawn whatever its status says. The employer applicants route can
    // set a status on an application the candidate already withdrew (it never
    // clears withdrawnAt), so the widget showed "Not Selected 1" over a card
    // that reads "Withdrawn". The summary now groups by withdrawnAt too.
    it('summary agrees with the list for a withdrawn application whose status an employer changed later', async () => {
        applications = [storedApplication({ id: 'w', status: 'rejected', withdrawnAt: new Date('2026-10-02T00:00:00.000Z') })];
        const view = await listApplications(CANDIDATE, undefined);
        expect(view.applications[0].status).toBe('withdrawn');
        expect(view.summary).toEqual([{ status: 'withdrawn', label: 'Withdrawn', count: 1 }]);
    });

    it("easyApply comes from sourceUrl 'platform' only", async () => {
        applications = [
            storedApplication({ id: 'easy', sourceUrl: 'platform' }),
            storedApplication({ id: 'tracked', jobId: JOB_ID_2, sourceUrl: EMPLOYER_LINK }),
            storedApplication({ id: 'bare', jobId: JOB_ID_3, sourceUrl: null }),
        ];
        const view = await listApplications(CANDIDATE, undefined);
        expect(view.applications.map((a) => [a.id, a.easyApply])).toEqual([
            ['easy', true],
            ['tracked', false],
            ['bare', false],
        ]);
    });

    it('a job that closed has no link; a sandbox job is open but has no site page', async () => {
        applications = [
            storedApplication({ id: 'open' }),
            storedApplication({ id: 'expired', jobId: JOB_ID_2 }, { id: JOB_ID_2, expiresAt: new Date('2020-01-01T00:00:00.000Z') }),
            storedApplication({ id: 'unpublished', jobId: JOB_ID_3 }, { id: JOB_ID_3, isPublished: false }),
            storedApplication(
                { id: 'sandbox', jobId: SANDBOX_JOB_ID },
                { id: SANDBOX_JOB_ID, isPublished: false, sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER },
            ),
        ];
        const view = await listApplications(CANDIDATE, undefined);
        expect(view.applications.map((a) => [a.id, a.jobOpen, a.jobUrl])).toEqual([
            ['open', true, `${SITE}/jobs/family-nurse-practitioner-austin-tx-${JOB_ID}`],
            ['expired', false, null],
            ['unpublished', false, null],
            ['sandbox', true, null],
        ]);
    });
});

// ── withdraw_application ────────────────────────────────────────────────────

describe('withdraw_application', () => {
    beforeEach(() => {
        applications = [storedApplication({ id: 'mine' }), storedApplication({ id: 'theirs', userId: SOMEONE_ELSE })];
    });

    it("another candidate's application answers exactly like a missing one, and nothing is written", async () => {
        const theirs = await withdrawApplication(CANDIDATE, 'theirs');
        const missing = await withdrawApplication(CANDIDATE, 'no-such-application');
        expect(theirs).toBe('No application of yours has that id.');
        expect(missing).toBe(theirs);
        expect(h.jobApplication.update).not.toHaveBeenCalled();
        expect(h.logger.info).not.toHaveBeenCalled();
    });

    it('scrubs the cover letter, the resume and the employer notes, and keeps the row as withdrawn', async () => {
        const result = await withdrawApplication(CANDIDATE, 'mine');
        expect(h.jobApplication.update).toHaveBeenCalledTimes(1);
        expect(h.jobApplication.update).toHaveBeenCalledWith({
            where: { id: 'mine' },
            data: { coverLetter: null, resumeUrl: null, status: 'withdrawn', withdrawnAt: expect.any(Date), notes: null },
        });
        expect(result).toEqual({
            applicationId: 'mine',
            status: 'withdrawn',
            jobTitle: 'Family Nurse Practitioner',
            employer: 'Northside Clinic',
        });
    });
});

// ── save_job, unsave_job, list_saved_jobs ───────────────────────────────────

describe('save_job and unsave_job', () => {
    it("saves a visible job for the caller, once", async () => {
        expect(await saveJob(CANDIDATE, `${SITE}/jobs/fnp-${JOB_ID}`)).toEqual({ jobId: JOB_ID, saved: true });
        expect(h.savedJob.upsert).toHaveBeenCalledWith({
            where: { userId_jobId: { userId: ME, jobId: JOB_ID } },
            create: { userId: ME, jobId: JOB_ID },
            update: {},
        });
        expect(jobQueryWhere()).toMatchObject({ id: JOB_ID, isPublished: true });
    });

    it('a job the viewer may not see cannot be saved', async () => {
        jobs = [];
        expect(await saveJob(CANDIDATE, JOB_ID)).toBe(JOB_GONE);
        expect(await saveJob(CANDIDATE, 'nothing')).toBe(JOB_GONE);
        expect(h.savedJob.upsert).not.toHaveBeenCalled();
    });

    it("unsave removes only the caller's row, and works for a job that has since closed", async () => {
        jobs = [];
        expect(await unsaveJob(CANDIDATE, JOB_ID)).toEqual({ jobId: JOB_ID, saved: false });
        expect(h.savedJob.deleteMany).toHaveBeenCalledWith({ where: { userId: ME, jobId: JOB_ID } });
        expect(h.job.findFirst).not.toHaveBeenCalled();
    });

    it('unsave of an argument that names no job deletes nothing', async () => {
        expect(await unsaveJob(CANDIDATE, 'nothing')).toBe(JOB_GONE);
        expect(h.savedJob.deleteMany).not.toHaveBeenCalled();
    });
});

describe('list_saved_jobs', () => {
    beforeEach(() => {
        jobs = [jobRow({ id: JOB_ID }), jobRow({ id: JOB_ID_2, title: 'Pediatric Nurse Practitioner' })];
        savedRows = [
            { userId: ME, jobId: JOB_ID, savedAt: new Date('2026-10-01T00:00:00.000Z') },
            { userId: ME, jobId: JOB_ID_3, savedAt: new Date('2026-10-02T00:00:00.000Z') },
            { userId: ME, jobId: JOB_ID_2, savedAt: new Date('2026-10-03T00:00:00.000Z') },
            { userId: SOMEONE_ELSE, jobId: JOB_ID_2, savedAt: new Date('2026-10-04T00:00:00.000Z') },
        ];
    });

    it('newest saved first, a job that closed since dropped, every job marked saved', async () => {
        const view = await listSavedJobs(CANDIDATE);
        expect(view.jobs.map((job) => [job.id, job.saved])).toEqual([
            [JOB_ID_2, true],
            [JOB_ID, true],
        ]);
        expect(view).toMatchObject({
            view: 'job-list',
            heading: 'Saved jobs',
            filters: [],
            total: 2,
            page: 1,
            totalPages: 1,
            nextPageArgs: null,
            browseUrl: `${SITE}/saved`,
            signedIn: true,
        });
        expect(h.savedJob.findMany.mock.calls[0][0]).toMatchObject({
            where: { userId: ME },
            orderBy: { savedAt: 'desc' },
            take: 20,
        });
    });

    it('reads the jobs through the site listing rule (a sandbox job only for a reviewer)', async () => {
        await listSavedJobs(CANDIDATE);
        const [ids, visible] = (h.job.findMany.mock.calls[0][0] as { where: { AND: Row[] } }).where.AND;
        expect(ids).toEqual({ id: { in: [JOB_ID_2, JOB_ID_3, JOB_ID] } });
        expect(visible).toMatchObject({ isPublished: true });
        expect(JSON.stringify(visible)).not.toContain(REVIEW_SANDBOX_SOURCE_PROVIDER);

        h.job.findMany.mockClear();
        await listSavedJobs(REVIEWER);
        const reviewerVisible = (h.job.findMany.mock.calls[0][0] as { where: { AND: Row[] } }).where.AND[1];
        expect(JSON.stringify(reviewerVisible)).toContain(REVIEW_SANDBOX_SOURCE_PROVIDER);
    });

    it('nothing saved: no job query, an empty list', async () => {
        savedRows = [];
        const view = await listSavedJobs(CANDIDATE, 5);
        expect(view.jobs).toEqual([]);
        expect(view.total).toBe(0);
        expect(h.job.findMany).not.toHaveBeenCalled();
        expect(h.savedJob.findMany.mock.calls[0][0]).toMatchObject({ take: 5 });
    });
});

// ── get_my_profile_status ───────────────────────────────────────────────────

describe('get_my_profile_status', () => {
    const OUTPUT_KEYS = [
        'completeness', 'firstName', 'headline', 'licenseStates', 'missing', 'profileUrl', 'resume', 'specialties', 'yearsExperience',
    ];

    it('never returns the NPI or DEA number, nor any key beyond the contract', async () => {
        const status = await profileStatus(CANDIDATE);
        if (typeof status === 'string') throw new Error(status);
        expect(Object.keys(status).sort()).toEqual(OUTPUT_KEYS);
        expect(deepKeys(status)).not.toContain('npiNumber');
        expect(deepKeys(status)).not.toContain('deaNumber');
        expect(JSON.stringify(status)).not.toContain('1234567893');
        expect(JSON.stringify(status)).not.toContain('AB1234563');
        expect(h.userProfile.findUnique.mock.calls[0][0]).toMatchObject({ where: { supabaseId: ME } });
    });

    it('a profile missing only the NPI and DEA numbers lists nothing missing, though the score counts them', async () => {
        profile = storedProfile({ npiNumber: null, deaNumber: null });
        const status = await profileStatus(CANDIDATE);
        if (typeof status === 'string') throw new Error(status);
        expect(status.missing).toEqual([]);
        expect(status.completeness).toBe(calculateCompleteness(profile as ProfileDataV2).percentage);
        expect(status.completeness).toBe(93);
    });

    it('a sparse profile lists at most five missing items, heaviest first, none naming NPI or DEA', async () => {
        profile = {
            supabaseId: ME,
            firstName: 'Jane',
            npiNumber: null,
            deaNumber: null,
            resumeUrl: null,
            _count: {},
        };
        const status = await profileStatus(CANDIDATE);
        if (typeof status === 'string') throw new Error(status);
        expect(status.missing).toHaveLength(5);
        expect(status.missing.slice(0, 2)).toEqual(['Add education entry', 'Add work experience']);
        for (const label of status.missing) expect(label).not.toMatch(/\b(NPI|DEA)\b/i);
    });

    it('the rest of the status: resume ownership, lists split, the settings link', async () => {
        profile = storedProfile({ resumeUrl: FOREIGN_RESUME });
        const status = await profileStatus(CANDIDATE);
        if (typeof status === 'string') throw new Error(status);
        expect(status).toMatchObject({
            firstName: 'Jane',
            headline: 'Family NP, six years in primary care',
            yearsExperience: 6,
            specialties: ['Family Practice', 'Pediatrics'],
            licenseStates: ['TX', 'CA'],
            resume: { onFile: false, fileName: null },
            profileUrl: `${SITE}/settings`,
        });

        profile = storedProfile();
        const own = await profileStatus(CANDIDATE);
        if (typeof own === 'string') throw new Error(own);
        expect(own.resume).toEqual({ onFile: true, fileName: 'Jane-Doe-CV.pdf' });
    });

    it('no profile row: a plain sentence', async () => {
        profile = null;
        expect(await profileStatus(CANDIDATE)).toBe(`Your ${brand.name} profile could not be found.`);
    });
});
