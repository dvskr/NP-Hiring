/**
 * GET /api/dashboard: the Recent Applications card reads only the candidate's
 * side of each row (the same class as APP-1 in GET /api/applications).
 *
 * The five newest applications were loaded with `include` and no `select`,
 * which returns every JobApplication column, so the dashboard payload handed
 * the candidate what the employer privately wrote about them (`notes`, which
 * also carries the auto-reject reason) and the employer-side AI assessment
 * (aiMatchScore, aiMatchReasons, aiMissingItems).
 *
 * Pinned:
 *   - the payload carries no employer notes and no AI assessment. The Prisma
 *     fake projects a fully populated row through the query args the way
 *     Prisma does, so a whole-row `include` fails here instead of passing on
 *     a canned row;
 *   - the query is an explicit select of exactly id, appliedAt, status and
 *     the job card fields, scoped to the caller, newest five first;
 *   - every field components/dashboard/DashboardContent.tsx reads from an
 *     application, and from its job in CompactJobCard, is still returned.
 *
 * Fully mocked: the only database is production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    applicationCount: vi.fn(),
    applicationFindMany: vi.fn(),
    alertCount: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/ai/feature-flags', () => ({ isAiFeatureEnabled: vi.fn(async () => false) }));

import { GET as dashboard } from '@/app/api/dashboard/route';

// The global prisma fake has neither a jobApplication model nor jobAlert.count.
Object.assign(prisma, { jobApplication: { count: h.applicationCount, findMany: h.applicationFindMany } });
Object.assign(prisma.jobAlert, { count: h.alertCount });

type Row = Record<string, unknown>;
interface QueryArgs {
    select?: Record<string, unknown>;
    include?: Record<string, unknown>;
}

const USER_ID = 'supabase-candidate';
const JOB_ID = '11111111-1111-4111-8111-111111111111';

/** A JobApplication as stored: every column set, plus its two relations. */
const STORED_ROW: Row = {
    id: 'app-1',
    userId: USER_ID,
    jobId: JOB_ID,
    sourceUrl: 'https://employer.example.com/apply',
    coverLetter: 'Dear hiring team',
    coverLetterUrl: 'https://test.supabase.co/storage/v1/object/cover-letters/u/c.pdf',
    resumeUrl: 'https://test.supabase.co/storage/v1/object/resumes/u/r.pdf',
    appliedAt: new Date('2026-10-01T12:00:00.000Z'),
    status: 'screening',
    notes: 'PRIVATE employer note',
    statusUpdatedAt: new Date('2026-10-02T12:00:00.000Z'),
    consentGiven: true,
    consentGivenAt: new Date('2026-10-01T12:00:00.000Z'),
    withdrawnAt: null,
    aiMatchScore: 42,
    aiMatchReasons: ['PRIVATE match reason'],
    aiMissingItems: ['PRIVATE missing item'],
    screeningAnswers: [{ questionId: 'q1', questionText: 'Licensed in Texas?', answer: 'yes' }],
    job: {
        id: JOB_ID,
        title: 'Family Nurse Practitioner',
        slug: 'family-nurse-practitioner-1111',
        employer: 'Example Clinic',
        location: 'Austin, TX',
        jobType: 'Full-time',
        mode: 'In-person',
        displaySalary: '$120,000 to $140,000/yr',
        isPublished: true,
        description: 'Full job description',
        contactEmail: 'PRIVATE-hiring@employer.example.com',
    },
    user: { supabaseId: USER_ID, email: 'np@example.com' },
};
const RELATIONS = new Set(['job', 'user']);

/** What Prisma returns for `row` under `args`: the selected keys, or every scalar plus the included relations. */
function project(row: Row, args: QueryArgs): Row {
    const pick = (key: string, spec: unknown): unknown =>
        spec !== null && typeof spec === 'object' ? project(row[key] as Row, spec as QueryArgs) : row[key];
    if (args.select) {
        return Object.fromEntries(
            Object.entries(args.select).filter(([, spec]) => spec).map(([key, spec]) => [key, pick(key, spec)]),
        );
    }
    const scalars = Object.entries(row).filter(([key]) => !RELATIONS.has(key));
    const included = Object.entries(args.include ?? {}).filter(([, spec]) => spec).map(([key, spec]) => [key, pick(key, spec)]);
    return Object.fromEntries([...scalars, ...included]);
}

/** The application keys the dashboard is entitled to, sorted. */
const APPLICATION_FIELDS = ['appliedAt', 'id', 'job', 'status'];
const JOB_FIELDS = ['displaySalary', 'employer', 'id', 'isPublished', 'jobType', 'location', 'mode', 'slug', 'title'];
const EMPLOYER_PRIVATE_FIELDS = ['notes', 'aiMatchScore', 'aiMatchReasons', 'aiMissingItems'];

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
/** Distinct `<name>.<field>` reads in a piece of source. */
const fieldReads = (src: string, name: string): string[] =>
    [...new Set([...src.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, 'g'))].map((m) => m[1]))];

/** The Recent Applications query: the one jobApplication.findMany that takes five rows. */
function recentApplicationsQuery(): QueryArgs & Row {
    const calls = h.applicationFindMany.mock.calls.map(([args]) => args as QueryArgs & Row).filter((args) => args.take === 5);
    expect(calls).toHaveLength(1);
    return calls[0];
}

async function load(): Promise<{ status: number; applications: Row[] }> {
    const res = await dashboard(new Request('http://localhost:3000/api/dashboard'));
    const body = await res.json();
    return { status: res.status, applications: body.applications };
}

beforeEach(() => {
    vi.clearAllMocks();
    h.getUser.mockResolvedValue({ data: { user: { id: USER_ID, email: 'np@example.com' } }, error: null });
    h.applicationCount.mockResolvedValue(1);
    h.applicationFindMany.mockImplementation(async (args: QueryArgs) => [project(STORED_ROW, args)]);
    h.alertCount.mockResolvedValue(0);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'profile-candidate', firstName: 'Ada' } as never);
    vi.mocked(prisma.employerMessage.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.profileView.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue(null as never);
});

describe('GET /api/dashboard: recent applications carry only the candidate side of the row', () => {
    it('never returns the employer notes or the AI assessment', async () => {
        const { status, applications } = await load();
        expect(status).toBe(200);
        expect(applications).toHaveLength(1);
        for (const key of EMPLOYER_PRIVATE_FIELDS) expect(applications[0], key).not.toHaveProperty(key);
        expect(JSON.stringify(applications)).not.toContain('PRIVATE');
    });

    it('returns exactly the dashboard allowlist, and only the listed job fields', async () => {
        const { applications } = await load();
        expect(Object.keys(applications[0]).sort()).toEqual(APPLICATION_FIELDS);
        expect(Object.keys(applications[0].job as Row).sort()).toEqual(JOB_FIELDS);
    });

    it('queries an explicit select, scoped to the caller, newest five first', async () => {
        await load();
        const args = recentApplicationsQuery();
        expect(args).not.toHaveProperty('include');
        expect(args).toMatchObject({ where: { userId: USER_ID }, orderBy: { appliedAt: 'desc' }, take: 5 });
        expect(Object.keys(args.select ?? {}).sort()).toEqual(APPLICATION_FIELDS);
        const job = args.select?.job as QueryArgs | undefined;
        expect(Object.keys(job?.select ?? {}).sort()).toEqual(JOB_FIELDS);
    });
});

describe('GET /api/dashboard: every field the Recent Applications card reads is still returned', () => {
    const page = read('components/dashboard/DashboardContent.tsx');

    it('the Application payload type and the app.* reads in DashboardContent', async () => {
        const start = page.indexOf('interface Application {');
        expect(start).toBeGreaterThan(-1);
        const block = page.slice(start, page.indexOf('}', start));
        const typed = [...block.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]);
        const used = fieldReads(page, 'app');
        expect(typed).toEqual(expect.arrayContaining(['id', 'appliedAt', 'status', 'job']));
        expect(used).toEqual(expect.arrayContaining(['id', 'appliedAt', 'status', 'job']));
        const { applications } = await load();
        for (const field of [...typed, ...used]) expect(applications[0], field).toHaveProperty(field);
    });

    it('the job fields CompactJobCard reads', async () => {
        const start = page.indexOf('function CompactJobCard');
        expect(start).toBeGreaterThan(-1);
        const card = page.slice(start, page.indexOf('\nfunction ', start + 1));
        const fields = fieldReads(card, 'job');
        expect(fields).toEqual(expect.arrayContaining(['id', 'slug', 'title', 'employer', 'location', 'displaySalary', 'isPublished']));
        const { applications } = await load();
        for (const field of fields) expect(applications[0].job as Row, `job.${field}`).toHaveProperty(field);
    });
});
