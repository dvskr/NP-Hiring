/**
 * scripts/mcp-review-sandbox.ts: the review sandbox jobs for the Claude and
 * ChatGPT directory reviewers (owner decision 2026-10-28, lib/mcp/sandbox.ts).
 *
 * WHAT IT WRITES
 * ──────────────
 * Three Easy Apply jobs owned by NP Hiring itself, each with
 *   is_published = false and is_manually_unpublished = true, so the website,
 *   the sitemaps, job alerts, ingestion renewals and every listing query
 *   skip them as they skip any unpublished job;
 *   source_provider = 'nphiring-review-sandbox' and external_id
 *   'review-sandbox-1' to 'review-sandbox-3', the keys this script updates by;
 *   no employer_jobs row, so an application to one emails no employer.
 * The first two carry screening questions so reviewers see that part of the
 * Easy Apply review. Only accounts listed in MCP_REVIEWER_USER_IDS see the
 * jobs, and only through the MCP endpoints.
 *
 * WHAT IT NEVER DOES
 * ──────────────────
 *   • Touch any other job, or publish anything.
 *   • Create the reviewer account: the owner signs it up on the site with an
 *     email and password (no magic link, no MFA), adds a resume, and puts its
 *     Supabase user id in MCP_REVIEWER_USER_IDS (docs/ai-apps/submission.md).
 *
 * RUN (a human runs this, dry run first; production writes need the owner's OK)
 * ─────────────────────────────────────────────────────────────────────────────
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/mcp-review-sandbox.ts --env=prod
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/mcp-review-sandbox.ts --env=prod --apply
 *
 * Dry run by default. Re-running after --apply updates the same three rows
 * and replaces their screening questions, so it is safe to repeat.
 */
import { config as dotenvConfig } from 'dotenv';

type EnvKind = 'dev' | 'prod';

function parseEnvFlag(): EnvKind {
    const flag = process.argv.find((a) => a.startsWith('--env='))?.split('=')[1];
    if (flag === 'dev' || flag === 'prod') return flag;
    return 'prod';
}

const ENV: EnvKind = parseEnvFlag();
if (ENV === 'prod') {
    dotenvConfig({ path: '.env.prod' });
    if (process.env.PROD_DATABASE_URL && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
    }
    if (process.env.PROD_DIRECT_URL && !process.env.DIRECT_URL) {
        process.env.DIRECT_URL = process.env.PROD_DIRECT_URL;
    }
} else {
    dotenvConfig({ path: '.env' });
}

// Required AFTER the env is selected: the Prisma client reads DATABASE_URL at
// construction time, so a top-level import would bind the wrong database.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('@/lib/prisma') as typeof import('@/lib/prisma');
import { REVIEW_SANDBOX_SOURCE_PROVIDER } from '@/lib/mcp/sandbox';

const APPLY = process.argv.includes('--apply');

interface SandboxQuestion {
    questionText: string;
    questionType: 'boolean' | 'text' | 'select' | 'number';
    options: string[];
    isRequired: boolean;
}

interface SandboxJob {
    externalId: string;
    title: string;
    location: string;
    city: string | null;
    state: string | null;
    stateCode: string | null;
    isRemote: boolean;
    jobType: string;
    minSalary: number;
    maxSalary: number;
    salaryPeriod: 'annual' | 'hourly';
    displaySalary: string;
    setting: string;
    population: string;
    benefits: string[];
    categoryTags: string[];
    minYearsExperience: number;
    newGradFriendly: boolean;
    experienceLabel: string;
    questions: SandboxQuestion[];
}

const EMPLOYER = 'NP Hiring Review Sandbox';

const NOTICE =
    '<p>This listing exists so reviewers of the NP Hiring app in Claude and ChatGPT can try Easy Apply end to end. ' +
    'It is not a real job: it never appears on nphiring.com, and an application to it reaches no employer.</p>';

const JOBS: readonly SandboxJob[] = [
    {
        externalId: 'review-sandbox-1',
        title: 'Family Nurse Practitioner (Review Sandbox)',
        location: 'Austin, TX',
        city: 'Austin',
        state: 'Texas',
        stateCode: 'TX',
        isRemote: false,
        jobType: 'Full-Time',
        minSalary: 120_000,
        maxSalary: 145_000,
        salaryPeriod: 'annual',
        displaySalary: '$120k to $145k/yr',
        setting: 'Outpatient clinic',
        population: 'All ages',
        benefits: ['Health insurance', 'CME allowance', 'Paid time off'],
        categoryTags: ['family-practice', 'primary-care', 'outpatient', 'full-time'],
        minYearsExperience: 0,
        newGradFriendly: true,
        experienceLabel: 'New grad welcome',
        questions: [
            { questionText: 'Do you hold an active NP license in Texas?', questionType: 'boolean', options: [], isRequired: true },
            {
                questionText: 'When could you start?',
                questionType: 'select',
                options: ['Within 2 weeks', 'Within a month', 'In 2 to 3 months'],
                isRequired: true,
            },
        ],
    },
    {
        externalId: 'review-sandbox-2',
        title: 'Telehealth Nurse Practitioner (Review Sandbox)',
        location: 'Remote',
        city: null,
        state: null,
        stateCode: null,
        isRemote: true,
        jobType: 'Part-Time',
        minSalary: 70 * 2080,
        maxSalary: 85 * 2080,
        salaryPeriod: 'hourly',
        displaySalary: '$70 to $85/hr',
        setting: 'Telehealth',
        population: 'Adults',
        benefits: ['Flexible schedule'],
        categoryTags: ['telehealth', 'remote', 'part-time'],
        minYearsExperience: 2,
        newGradFriendly: false,
        experienceLabel: '2+ yrs',
        questions: [
            { questionText: 'How many years have you practiced as an NP?', questionType: 'number', options: [], isRequired: false },
        ],
    },
    {
        externalId: 'review-sandbox-3',
        title: 'Urgent Care Nurse Practitioner (Review Sandbox)',
        location: 'Miami, FL',
        city: 'Miami',
        state: 'Florida',
        stateCode: 'FL',
        isRemote: false,
        jobType: 'Per Diem',
        minSalary: 65 * 2080,
        maxSalary: 75 * 2080,
        salaryPeriod: 'hourly',
        displaySalary: '$65 to $75/hr',
        setting: 'Urgent care',
        population: 'All ages',
        benefits: [],
        categoryTags: ['urgent-care', 'per-diem'],
        minYearsExperience: 1,
        newGradFriendly: false,
        experienceLabel: '1+ yrs',
        questions: [],
    },
];

function description(job: SandboxJob): string {
    return `${NOTICE}<p>${job.title.replace(' (Review Sandbox)', '')} role in ${job.location}. ${job.setting}, ${job.population.toLowerCase()} patients.</p>`;
}

async function main(): Promise<void> {
    console.log(`[mcp-review-sandbox] env=${ENV} mode=${APPLY ? 'APPLY' : 'dry run'}`);
    const now = new Date();

    for (const job of JOBS) {
        const existing = await prisma.job.findFirst({
            where: { sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER, externalId: job.externalId },
            select: { id: true, isPublished: true },
        });
        if (existing?.isPublished) {
            throw new Error(`Sandbox job ${job.externalId} (${existing.id}) is published; unpublish it by hand before re-running.`);
        }
        console.log(`${existing ? 'update' : 'create'} ${job.externalId}: ${job.title}`);
        if (!APPLY) continue;

        const data = {
            title: job.title,
            employer: EMPLOYER,
            location: job.location,
            city: job.city,
            state: job.state,
            stateCode: job.stateCode,
            country: 'US',
            isRemote: job.isRemote,
            isHybrid: false,
            jobType: job.jobType,
            mode: job.isRemote ? 'Remote' : 'In-person',
            description: description(job),
            descriptionSummary: null,
            minSalary: job.minSalary,
            maxSalary: job.maxSalary,
            normalizedMinSalary: job.minSalary,
            normalizedMaxSalary: job.maxSalary,
            salaryPeriod: job.salaryPeriod,
            displaySalary: job.displaySalary,
            setting: job.setting,
            population: job.population,
            benefits: job.benefits,
            categoryTags: job.categoryTags,
            minYearsExperience: job.minYearsExperience,
            newGradFriendly: job.newGradFriendly,
            experienceLabel: job.experienceLabel,
            applyOnPlatform: true,
            applyLink: null,
            isPublished: false,
            isManuallyUnpublished: true,
            sourceType: 'employer',
            sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER,
            externalId: job.externalId,
            professionClass: 'np_eligible' as const,
            professionConfidence: 1,
            healthConsecutiveMissing: 0,
            expiresAt: null,
            contentChangedAt: now,
        };

        const saved = existing
            ? await prisma.job.update({ where: { id: existing.id }, data, select: { id: true } })
            : await prisma.job.create({ data: { ...data, originalPostedAt: now }, select: { id: true } });

        await prisma.jobScreeningQuestion.deleteMany({ where: { jobId: saved.id } });
        for (const [index, question] of job.questions.entries()) {
            await prisma.jobScreeningQuestion.create({
                data: { jobId: saved.id, ...question, isKnockout: false, knockoutAnswer: null, sortOrder: index },
            });
        }
        console.log(`  saved ${saved.id} with ${job.questions.length} screening question(s)`);
    }

    if (!APPLY) console.log('[mcp-review-sandbox] dry run: nothing written. Re-run with --apply to write.');
}

main()
    .catch((error: unknown) => {
        console.error('[mcp-review-sandbox] failed:', error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
