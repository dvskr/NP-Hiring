/**
 * Indexing audit L-01 / CQ-16 (company slugs) and L-05 (links that redirect).
 *
 * Company profile URLs used to be the ingest dedup key with spaces turned
 * into hyphens, which reads badly and sometimes names the wrong employer:
 * /companies/one (One Medical), /companies/da-vita (DaVita),
 * /companies/university-of-south-carolina (Medical University of South
 * Carolina). The public slug now derives from the display name, every link
 * builder goes through lib/company-slug.ts, and the profile route answers
 * every old slug with a permanent redirect.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        company: { findMany: vi.fn(), findUnique: vi.fn() },
        job: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    },
}));

import { prisma } from '@/lib/prisma';
import {
    companyProfilePath,
    companyProfileSlug,
    companySlugFor,
    isCompanyProfileSlugShape,
    legacyCompanySlug,
    pickCompanyForSlug,
} from '@/lib/company-slug';
import { localJobsPath } from '@/lib/city-link-path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

type Mock = ReturnType<typeof vi.fn>;
const m = (fn: unknown) => fn as Mock;

// Page modules pull in the whole pSEO narrative layer on first import.
const COLD_IMPORT_TIMEOUT_MS = 120_000;

describe('companyProfileSlug: readable, correctly tokenised slugs from the display name', () => {
    it.each([
        ['One Medical', 'one-medical'],
        ['LifeStance Health', 'lifestance-health'],
        ['DaVita', 'davita'],
        ['MedElite', 'medelite'],
        ['Next Health', 'next-health'],
        ['Denver Health', 'denver-health'],
        ['OU Health', 'ou-health'],
        ['Sol Mental Health', 'sol-mental-health'],
        ['MultiCare Health', 'multicare-health'],
        ['Medical University of South Carolina', 'medical-university-of-south-carolina'],
        ['University of Mississippi Medical Center', 'university-of-mississippi-medical-center'],
        ["Saint Luke's Health System", 'saint-lukes-health-system'],
        ['Washington University in St. Louis', 'washington-university-in-st-louis'],
        ['NY Psychotherapy & Counseling', 'ny-psychotherapy-and-counseling'],
        ['Texas A&M Health', 'texas-am-health'],
        ['Elevance Health (Anthem)', 'elevance-health-anthem'],
        ['NewYork-Presbyterian Hospital', 'newyork-presbyterian-hospital'],
        ['Clínica Sierra Vista, Inc.', 'clinica-sierra-vista'],
        ['Acme Health, LLC', 'acme-health'],
    ])('%s -> %s', (name, slug) => {
        expect(companyProfileSlug(name)).toBe(slug);
        expect(isCompanyProfileSlugShape(slug)).toBe(true);
    });

    it('keeps PA and PC, which are also a state code and a clinician title', () => {
        expect(companyProfileSlug('Smith Family Practice, P.A.')).toBe('smith-family-practice-pa');
    });

    it('never strips a name down to nothing because it looks like a legal form', () => {
        expect(companyProfileSlug('LLC')).toBe('llc');
    });

    it('falls back to the legacy key when the name has no Latin letters or digits', () => {
        expect(companyProfileSlug('***')).toBe('');
        expect(companySlugFor({ name: '***', normalizedName: 'acme clinic' })).toBe('acme-clinic');
    });

    it('builds the profile path, and the legacy slug is the old kebab form', () => {
        expect(companyProfilePath({ name: 'One Medical', normalizedName: 'one' })).toBe('/companies/one-medical');
        expect(legacyCompanySlug('life stance')).toBe('life-stance');
        expect(legacyCompanySlug('life-stance')).toBe('life-stance');
    });

    it('tells a well-formed slug from encoded or cased input', () => {
        expect(isCompanyProfileSlugShape('one-medical')).toBe(true);
        expect(isCompanyProfileSlugShape('life%20stance')).toBe(false);
        expect(isCompanyProfileSlugShape('Life-Stance')).toBe(false);
        expect(isCompanyProfileSlugShape('-one')).toBe(false);
    });
});

describe('pickCompanyForSlug: one winner when two spellings share a slug', () => {
    const multiCare = { name: 'MultiCare Health', normalizedName: 'multi-care', activeJobs: 4 };
    const multicare = { name: 'Multicare Health', normalizedName: 'multicare', activeJobs: 9 };

    it('matches on the display-name slug, not the dedup key', () => {
        expect(pickCompanyForSlug('multicare-health', [multiCare])).toBe(multiCare);
        expect(pickCompanyForSlug('multi-care', [multiCare])).toBeNull();
    });

    it('prefers the row with more live jobs, then the name that sorts first by code unit', () => {
        expect(pickCompanyForSlug('multicare-health', [multiCare, multicare])).toBe(multicare);
        // "MultiCare" < "Multicare": uppercase C sorts before lowercase c, in
        // every locale, whichever order the rows arrive in.
        const tie = { ...multicare, activeJobs: 4 };
        expect(pickCompanyForSlug('multicare-health', [tie, multiCare])).toBe(multiCare);
        expect(pickCompanyForSlug('multicare-health', [multiCare, tie])).toBe(multiCare);
    });
});

describe('localJobsPath: link the metro guide, not the /jobs/city twin that 308s to it', () => {
    it('routes curated metros to /jobs/metro and every other city to /jobs/city', () => {
        expect(localJobsPath('chicago-il')).toBe('/jobs/metro/chicago-il');
        expect(localJobsPath('boston-ma')).toBe('/jobs/metro/boston-ma');
        expect(localJobsPath('tulsa-ok')).toBe('/jobs/city/tulsa-ok');
    });
});

/* ── The profile route ─────────────────────────────────────────────────── */

const JOB_ROW = {
    id: 'job-1',
    title: 'Family Nurse Practitioner',
    slug: 'family-nurse-practitioner-job-1',
    location: 'Boston, MA',
    jobType: 'Full Time',
    mode: 'In-Person',
    displaySalary: null,
    isFeatured: false,
    isRemote: false,
    isHybrid: false,
    originalPostedAt: null,
    newGradFriendly: false,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    city: 'Boston',
    state: 'Massachusetts',
    stateCode: 'MA',
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    salaryIsEstimated: false,
    categoryTags: [],
};

const ONE_MEDICAL_LIVE = { name: 'One Medical', normalizedName: 'one', _count: { jobs: 12 } };

interface LiveRow { name: string; normalizedName: string; _count: { jobs: number } }

/**
 * A company table in miniature: `live` are the rows with live jobs (what the
 * resolver's findMany returns), `rows` every row by normalizedName. The
 * loader's include query returns each row's live jobs, so a row outside
 * `live` loads with none, exactly as activeIndexableJobWhere would leave it.
 */
function mockDirectory(live: LiveRow[], rows: Record<string, { name: string; normalizedName: string }>) {
    m(prisma.company.findMany).mockResolvedValue(live);
    m(prisma.company.findUnique).mockImplementation(async (args: { where: { normalizedName: string }; include?: unknown }) => {
        const row = rows[args.where.normalizedName];
        if (!row) return null;
        if (!args.include) return row;
        const liveJobs = live.find((entry) => entry.normalizedName === row.normalizedName)?._count.jobs ?? 0;
        return {
            id: 'company-1',
            ...row,
            logoUrl: null,
            website: null,
            description: null,
            isVerified: false,
            claimVerifiedAt: null,
            recruitmentType: null,
            jobs: Array.from({ length: liveJobs }, (_, i) => ({ ...JOB_ROW, id: `job-${i}` })),
        };
    });
}

function digestOf(error: unknown): string {
    const digest = (error as { digest?: unknown } | null)?.digest;
    return typeof digest === 'string' ? digest : '';
}

function redirectTarget(error: unknown): string | null {
    const digest = digestOf(error);
    if (!digest.startsWith('NEXT_REDIRECT;')) return null;
    const [, , url, status] = digest.split(';');
    return `${status} ${url}`;
}

type CompanyPageModule = typeof import('@/app/companies/[slug]/page');

describe('/companies/[slug]: display-name slug is canonical, every old slug 308s to it', () => {
    let page: CompanyPageModule;

    beforeAll(async () => {
        page = await import('@/app/companies/[slug]/page');
    }, COLD_IMPORT_TIMEOUT_MS);

    beforeEach(() => {
        vi.clearAllMocks();
        mockDirectory([ONE_MEDICAL_LIVE], { one: { name: 'One Medical', normalizedName: 'one' } });
    });

    async function renderError(slug: string): Promise<unknown> {
        try {
            await page.default({ params: Promise.resolve({ slug }) });
        } catch (error) {
            return error;
        }
        return null;
    }

    it('answers the old normalizedName slug with a permanent redirect', async () => {
        expect(redirectTarget(await renderError('one'))).toBe('308 /companies/one-medical');
    });

    it('also redirects the legacy space form reached through its kebab spelling', async () => {
        mockDirectory(
            [{ name: 'LifeStance Health', normalizedName: 'life stance', _count: { jobs: 105 } }],
            { 'life stance': { name: 'LifeStance Health', normalizedName: 'life stance' } },
        );
        expect(redirectTarget(await renderError('life-stance'))).toBe('308 /companies/lifestance-health');
    });

    it('serves the display-name slug itself, self-canonical and indexable at 5+ jobs', async () => {
        const metadata = await page.generateMetadata({ params: Promise.resolve({ slug: 'one-medical' }) });
        expect(metadata.alternates?.canonical).toMatch(/\/companies\/one-medical$/);
        expect(metadata.robots).toMatchObject({ index: true, follow: true });
    });

    it("points an old slug's metadata canonical at the new URL too", async () => {
        const metadata = await page.generateMetadata({ params: Promise.resolve({ slug: 'one' }) });
        expect(metadata.alternates?.canonical).toMatch(/\/companies\/one-medical$/);
    });

    it('does not redirect a company with no live jobs: its profile 404s either way', async () => {
        mockDirectory([], { one: { name: 'One Medical', normalizedName: 'one' } });
        const error = await renderError('one');
        expect(redirectTarget(error)).toBeNull();
        expect(digestOf(error)).toContain('404');
    });

    it('404s a slug that matches no company in either form', async () => {
        mockDirectory([ONE_MEDICAL_LIVE], {});
        const metadata = await page.generateMetadata({ params: Promise.resolve({ slug: 'no-such-employer' }) });
        expect(metadata.title).toBe('Company Not Found');
        expect(digestOf(await renderError('no-such-employer'))).toContain('404');
    });
});

describe('every company link builder in this package uses the shared slug', () => {
    it('the /companies hub and the similar-employer cards link the display-name slug', () => {
        expect(read('app/companies/page.tsx')).toContain('href: companyProfilePath(company)');
        expect(read('app/companies/[slug]/page.tsx')).toContain('href={companyProfilePath(employer)}');
    });

    it('the profile city chips resolve metro twins before linking', () => {
        const page = read('app/companies/[slug]/page.tsx');
        expect(page).toContain('href={localJobsPath(city.slug)}');
        expect(page).not.toContain('href={`/jobs/city/${city.slug}`}');
    });

    it('the profile route redirects with permanentRedirect (308), not redirect (307)', () => {
        const page = read('app/companies/[slug]/page.tsx');
        expect(page).toContain('permanentRedirect(`/companies/${loaded.slug}`)');
        expect(page).not.toMatch(/\bredirect\(`\/companies/);
    });
});

/**
 * Company path builders outside this package. Each has a handoff filed to its
 * owner and ships in the same deploy as the display-name slugs; these pins
 * fail until it lands, because until then the sitemap lists URLs that 308,
 * the metro and city guides link them, claim approvals refresh a URL nobody
 * is served, and the middleware answers 410 on every display-name slug.
 */
describe('company paths outside this package follow the shared slug', () => {
    it('the middleware company gate leaves display-name slugs to the page', () => {
        // Behaviour: tests/regressions/middleware-company-display-slug.test.ts.
        const mw = read('middleware.ts');
        expect(mw).toContain("import { isCompanyProfileSlugShape } from '@/lib/company-slug';");
        expect(mw).toMatch(/!isCompanyProfileSlugShape\(decodedSlug\)/);
        expect(mw).not.toContain('resolveCompanyNormalizedName');
    });

    it.each([
        // The sitemap must list the URL the page serves, not one that 308s.
        'app/sitemap.ts',
        // Employer links on metro and city guides.
        'lib/pseo/listing-facts.ts',
        // Claim approvals must refresh the profile URL that is actually served.
        'app/api/admin/_lib/public-revalidation.ts',
    ])('%s builds company paths with the shared slug', (rel) => {
        const src = read(rel);
        expect(src).toMatch(/import \{[^}]*\bcompanyProfilePath\b[^}]*\} from '@\/lib\/company-slug'/);
        expect(src).not.toMatch(/\/companies\/\$\{[^}]*normalizedName\.replace\(/);
        expect(src).not.toMatch(/normalizedName\.replace\(\/ \/g, '-'\)/);
    });
});
