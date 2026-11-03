/**
 * Shared fixtures for the MCP layer tests (tests/mcp/*.test.ts): job rows the
 * way Prisma returns them, a projection of a stored row through a `select`
 * (so a widened select fails a test instead of passing on a canned row), and
 * the checks behind the directory and copy rules.
 *
 * Plain data and pure helpers only. Every test file mocks Prisma and the
 * network itself: the only database this project has is production.
 */
import { brand } from '@/config/brand';
import { REVIEW_SANDBOX_SOURCE_PROVIDER } from '@/lib/mcp/sandbox';

/** The site origin every MCP URL derives from (no MCP_BASE_URL in tests). */
export const SITE = new URL(brand.baseUrl).origin;

/** A signed-in candidate whose ids pass the upload-folder rule (lib/supabase-storage.ts). */
export const ME = 'aaaaaaaa-1111-2222-3333-444444444444';
export const SOMEONE_ELSE = 'bbbbbbbb-5555-6666-7777-888888888888';

export const JOB_ID = '3f2b8c1d-9a4e-4b7f-8c2d-1e5f6a7b8c9d';
export const JOB_ID_2 = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const JOB_ID_3 = '9c8b7a6d-5e4f-4d3c-8b2a-1f0e9d8c7b6a';
export const SANDBOX_JOB_ID = '5a5a5a5a-0000-4000-8000-000000000001';

export type Row = Record<string, unknown>;

/** A job row as `select: JOB_SUMMARY_SELECT` returns it. */
export function jobRow(overrides: Row = {}): Row {
    const id = typeof overrides.id === 'string' ? overrides.id : JOB_ID;
    return {
        id,
        title: 'Family Nurse Practitioner',
        slug: `family-nurse-practitioner-austin-tx-${id}`,
        employer: 'Northside Clinic',
        location: 'Austin, TX',
        city: 'Austin',
        state: 'Texas',
        stateCode: 'TX',
        isRemote: false,
        isHybrid: false,
        jobType: 'Full-Time',
        displaySalary: '$120k - $140k/yr',
        normalizedMinSalary: 120000,
        normalizedMaxSalary: 140000,
        salaryPeriod: 'annual',
        salaryIsEstimated: false,
        experienceLabel: '2+ years',
        newGradFriendly: false,
        originalPostedAt: new Date('2026-10-20T12:00:00.000Z'),
        createdAt: new Date('2026-10-21T12:00:00.000Z'),
        applyOnPlatform: true,
        isPublished: true,
        sourceProvider: null,
        ...overrides,
    };
}

/** A review sandbox job: unpublished and marked with the sandbox provider. */
export function sandboxJobRow(overrides: Row = {}): Row {
    return jobRow({
        id: SANDBOX_JOB_ID,
        title: 'Review Sandbox Nurse Practitioner',
        slug: null,
        employer: 'NP Hiring Review',
        isPublished: false,
        sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER,
        ...overrides,
    });
}

/** The extra columns get_job reads (JOB_DETAIL_SELECT in lib/mcp/jobs.ts). */
export function jobDetailRow(overrides: Row = {}): Row {
    return {
        ...jobRow(),
        description: '<p>Join our <strong>primary care</strong> team.</p><ul><li>Four day week</li><li>CME budget</li></ul>',
        descriptionSummary: 'Outpatient primary care role.',
        setting: 'Outpatient',
        population: 'Adults',
        benefits: ['Health insurance', 'CME allowance'],
        experienceQualifier: 'New grads with a residency welcome',
        applyLink: 'https://careers.northside.example/apply/123',
        sourceType: 'employer',
        contentChangedAt: new Date('2026-10-22T08:00:00.000Z'),
        updatedAt: new Date('2026-10-23T08:00:00.000Z'),
        _count: { screeningQuestions: 2 },
        ...overrides,
    };
}

/**
 * What Prisma returns for `row` under a `select`: the selected keys only,
 * recursing into relation selects (`{ select: {...} }`, arrays included).
 */
export function projectRow(row: Row, select: Row): Row {
    const out: Row = {};
    for (const [key, spec] of Object.entries(select)) {
        if (!spec) continue;
        const value = row[key];
        const nested = spec === true ? undefined : (spec as { select?: Row }).select;
        if (!nested || value === null || value === undefined) {
            out[key] = value;
        } else if (Array.isArray(value)) {
            out[key] = value.map((item) => projectRow(item as Row, nested));
        } else {
            out[key] = projectRow(value as Row, nested);
        }
    }
    return out;
}

/** Every object key anywhere inside a value (arrays and nested objects included, Dates skipped). */
export function deepKeys(value: unknown): string[] {
    const keys: string[] = [];
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (node !== null && typeof node === 'object' && !(node instanceof Date) && !(node instanceof URL)) {
            for (const [key, child] of Object.entries(node)) {
                keys.push(key);
                walk(child);
            }
        }
    };
    walk(value);
    return keys;
}

/**
 * The owner's copy rule for user-visible text: no em dash, no en dash and no
 * spaced hyphen used as a dash. Hyphenated compounds ("Full-Time") are fine.
 */
export const DASH_AS_PUNCTUATION = /[–—]| - /;

export function dashFindings(texts: Readonly<Record<string, string>>): string[] {
    return Object.entries(texts)
        .filter(([, text]) => DASH_AS_PUNCTUATION.test(text))
        .map(([where, text]) => `${where}: ${text}`);
}
