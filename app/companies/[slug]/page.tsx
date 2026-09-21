import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import type { Metadata } from 'next';
import type { Prisma } from '@prisma/client';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import CategoryFAQAccordion from '@/components/CategoryFAQAccordion';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { categorySlugLabel } from '@/lib/pseo/category-landing-template';
import { STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { RECRUITMENT_TYPE_LABELS } from '@/lib/filters';
import { BENCHMARK_MIN_POSTINGS } from '@/components/tools/benchmark-model';
import { shouldIndexCompanyProfile } from '@/lib/pseo/render-gate';
import { getPracticeEnvironment } from '@/lib/pseo/practice-environment';
import { DESCRIPTION_MAX } from '@/lib/pseo/category-metadata';
import {
    buildCompanyProfileFacts,
    resolveRowStateName,
    type CompanyProfileFacts,
} from '@/lib/company-profile-facts';
import {
    COMPANY_CLAIM_CTA,
    buildCompanyDescription,
    buildCompanyFaqs,
    buildCompanyFootprintSentence,
    buildCompanyPaySentence,
    buildCompanyStatePracticeLine,
    buildCompanyTitle,
    buildListingJobTypesSentence,
    buildListingWorkModeSentence,
    buildNewGradSentence,
    type FaqEntry,
} from '@/lib/pseo/listing-narrative';
import ClaimProfileCta from './ClaimProfileCta';
import { normalizeDisplaySalary } from '@/lib/salary-display';
// Company names, job titles and locations are employer-authored and often
// carry dashes as separators. They stay raw in the DB lookups and in both
// JSON-LD blocks; visible render points go through lib/display-text.ts.
import { displayText, normalizeDisplayText, truncateOnWord } from '@/lib/display-text';

// GSC Fix: ISR caching prevents DB pool exhaustion when Googlebot crawls company pages.
// Previously defaulted to dynamic (no cache) → every crawl hit the DB.
export const revalidate = 3600;

// P7 runtime fix D3: without a generateStaticParams export, `revalidate`
// is a silent no-op — Next renders the dynamic segment fully dynamically
// on every request (runtime-verified: /companies/life-stance took 5.1 s
// of uncached DB work per hit). Returning [] enables on-demand static
// generation. Full rationale in app/jobs/[slug]/page.tsx; guarded by
// tests/regressions/p7-runtime-isr-static-params.test.ts.
export function generateStaticParams(): Array<{ slug: string }> {
    return [];
}

interface Props {
    params: Promise<{ slug: string }>;
}

/**
 * Resolve a /companies/{slug} URL to a Company.normalizedName value present
 * in the DB. The normalizer was changed to emit kebab-case ("life-stance"),
 * but rows inserted before that change still hold the legacy space-form
 * ("life stance"). Prefer the kebab match; fall through to the legacy form
 * so old rows still resolve via clean URLs during the transition window.
 * Returns the matched normalizedName, or null if neither form exists.
 */
async function resolveCompanyNormalizedName(slug: string): Promise<string | null> {
    const exists = await prisma.company.findUnique({
        where: { normalizedName: slug },
        select: { normalizedName: true },
    });
    if (exists) return exists.normalizedName;
    if (!slug.includes('-')) return null;
    const legacy = slug.replace(/-/g, ' ');
    const legacyMatch = await prisma.company.findUnique({
        where: { normalizedName: legacy },
        select: { normalizedName: true },
    });
    return legacyMatch?.normalizedName ?? null;
}

// ─── P1 #12 enrichment helpers ──────────────────────────────────────────────
// Everything below derives from the company's OWN active job rows (live DB
// data). Each module renders nothing when its underlying data is absent —
// never a fabricated placeholder (TRUTH RULE).

const VALID_CATEGORY_SLUGS = new Set(ALL_CATEGORY_SLUGS);

/**
 * Minimum active postings with a disclosed pay range before the salary
 * snapshot publishes figures.
 *
 * CO-B6 (thin plan, spec 4 defect B6): this was 2, which published a
 * "median" from a two-row sample on a named real employer while every
 * other salary surface on the site waits for `BENCHMARK_MIN_POSTINGS`.
 * One floor, one rule. The distinct-employer half of the benchmark gate
 * deliberately does NOT apply here: a company profile has exactly one
 * employer by construction, and the copy already says the figures are
 * employer posted rather than a market median.
 *
 * Below the floor the block still renders, as the count sentence from
 * `buildCompanyPaySentence` (CO-C2) — never a figure.
 */
const SALARY_SNAPSHOT_MIN_SAMPLE = BENCHMARK_MIN_POSTINGS;

/** Max chips per breakdown row and max similar-employer cards. */
const MAX_BREAKDOWN_CHIPS = 8;
const MAX_SIMILAR_EMPLOYERS = 6;

/** Work arrangement (CO-C4) renders from this many active postings up. */
const MIN_JOBS_FOR_WORK_ARRANGEMENT = 2;

/** FAQPage rich results need more than one question (components/CategoryFAQ.tsx). */
const MIN_FAQ_ENTRIES_FOR_SCHEMA = 2;

/**
 * Over-fetch factor for the similar-employer query. Prisma cannot order by a
 * FILTERED relation count (`_count` with a `where` is selectable but not
 * orderable), so the DB sorts by Company.jobCount — an increment-only
 * LIFETIME counter that never decrements when a posting expires. Ordering by
 * it while the card prints the ACTIVE count renders visibly out-of-order
 * cards ("1 open position" above "12 open positions"). Fetch a wider
 * candidate window on that cheap indexed proxy, then re-rank in memory on the
 * active count that is actually displayed.
 */
const SIMILAR_EMPLOYER_CANDIDATE_POOL = MAX_SIMILAR_EMPLOYERS * 5;

/**
 * Absolute, timezone-pinned date for the claim-approval line.
 *
 * `formatDate` (lib/utils) returns a RELATIVE string ("3 days ago"), which is
 * wrong twice over here: this page is ISR-cached for an hour, so a relative
 * label bakes in and drifts, and an approval date is a provenance fact that
 * should read the same to every visitor. UTC is pinned explicitly so the
 * build server's locale can never shift the rendered day.
 */
function formatApprovalDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
    });
}

interface SalarySnapshot {
    min: number;
    median: number;
    max: number;
    sampleSize: number;
}

interface SalaryRow {
    normalizedMinSalary: number | null;
    normalizedMaxSalary: number | null;
    salaryIsEstimated: boolean;
}

/**
 * Aggregate the company's active postings that disclose an annualized pay
 * range (normalizedMin/MaxSalary are annual USD — lib/salary-normalizer.ts).
 * min = lowest posted minimum, max = highest posted maximum, median = the
 * median of each posting's range midpoint. Returns null (figures hidden)
 * below the sample threshold.
 *
 * TRUTH RULE — salaryIsEstimated rows are EXCLUDED. normalizedMin/MaxSalary
 * is NOT a "what the employer posted" column: three production codepaths
 * write derived numbers into it and flag the row instead of nulling it.
 *   1. app/api/cron/enrich-jobs/route.ts:224-242 — when a posting discloses
 *      no structured pay, the LLM infers salary_min/max and writes it with
 *      salaryIsEstimated=true, salaryConfidence=0.7.
 *   2. lib/ingestion-service.ts:146-160 — the inline-rescue path does the
 *      same merge ("if either codepath changes, update the other").
 *   3. lib/salary-normalizer.ts:244-248 — source ranges self-labelled
 *      "estimated"/"predicted" keep their values and set the flag; and
 *      normalizeSingleSalary (:163-203) CLAMPS out-of-band annuals to the
 *      config floor/ceiling rather than dropping them (config/niche/salary.ts
 *      warns this "silently FABRICATES wrong salaries").
 * Aggregating those rows would publish an invented pay spread attributed to
 * a named real employer, and would falsify BOTH visible claims below: the
 * "disclose a pay range" count and "employer-posted, not {brand} estimates".
 * If the attribution copy is ever dropped, this filter can be revisited —
 * not before. (Contrast lib/pseo/category-landing-template.tsx:499, which
 * aggregates the same columns but labels them neutrally, "Average salary",
 * with no employer attribution.)
 */
function computeSalarySnapshot(jobs: readonly SalaryRow[]): SalarySnapshot | null {
    const salaried = jobs.filter(
        (job) =>
            !job.salaryIsEstimated &&
            (job.normalizedMinSalary ?? 0) > 0 &&
            (job.normalizedMaxSalary ?? 0) > 0,
    );
    if (salaried.length < SALARY_SNAPSHOT_MIN_SAMPLE) return null;

    const midpoints = salaried
        .map((job) => (job.normalizedMinSalary! + job.normalizedMaxSalary!) / 2)
        .sort((a, b) => a - b);
    const mid = Math.floor(midpoints.length / 2);
    const median = midpoints.length % 2 === 0
        ? (midpoints[mid - 1] + midpoints[mid]) / 2
        : midpoints[mid];

    return {
        min: Math.min(...salaried.map((job) => job.normalizedMinSalary!)),
        median,
        max: Math.max(...salaried.map((job) => job.normalizedMaxSalary!)),
        sampleSize: salaried.length,
    };
}

/** "$132k" display for annual USD values (matches lib/utils formatSalary's
 *  annual style). */
function formatAnnualUsd(value: number): string {
    return `$${Math.round(value / 1000)}k`;
}

interface TallyEntry {
    value: string;
    count: number;
}

/** Count occurrences and return the top `limit` entries, most frequent
 *  first (ties broken alphabetically for stable ISR output). */
function tallyTop(values: readonly string[], limit: number): TallyEntry[] {
    const counts = new Map<string, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, limit);
}

/**
 * The profile's own rows, loaded once per request.
 *
 * generateMetadata and the page body both need the full row set now that
 * the title, the description and the robots verdict all derive from it
 * (CO-meta, thin-spec-4 section 5.5). React cache() dedupes on the slug, so
 * the two callers share ONE company query instead of the previous
 * resolve + count in metadata plus resolve + include in the body. Sharing
 * the array is also what makes the robots verdict and the 404 gate
 * structurally incapable of disagreeing: there is one count, not two.
 *
 * A QUERY FAILURE PROPAGATES (PLAN C.3). "Not found" is `null`; a database
 * error throws, so Next answers 5xx. The previous `catch { notFound() }`
 * turned a transient pool exhaustion into a 404 that this route then CACHED
 * for an hour on a company whose profile was perfectly alive, which is the
 * same "Submitted URL returns 404" class the middleware gate above exists
 * to remove. Crawlers retry a 5xx and de-index on a 404.
 */
const loadCompanyProfile = cache(async (slug: string) => {
    const now = new Date();
    const resolvedName = await resolveCompanyNormalizedName(slug);
    if (!resolvedName) return null;
    return prisma.company.findUnique({
        where: { normalizedName: resolvedName },
        include: {
            jobs: {
                // Shared single source of truth (lib/active-job-filter.ts).
                // The hand-rolled `expiresAt: { gt: now }` this replaces
                // treated expiresAt=NULL as EXPIRED, while BOTH upstream
                // gates treat NULL as ACTIVE:
                //   app/sitemap.ts:342-358 selects company URLs with this
                //     same helper, so those pages ARE submitted; and
                //   middleware.ts passes them with the same predicate.
                // A company whose active jobs all had null expiry was
                // therefore emitted in sitemap.xml, served 200 by
                // middleware, and then 404'd right here — the exact
                // "Submitted URL returns 404/410" class that
                // tests/regressions/shell-company-410-null-expiry.test.ts
                // was written to stop. Reusing the helper also drops
                // known-dead apply links (healthConsecutiveMissing) so the
                // page and the sitemap now agree row-for-row.
                where: activeIndexableJobWhere(now),
                orderBy: [
                    { isFeatured: 'desc' },
                    { createdAt: 'desc' },
                ],
                select: {
                    id: true,
                    title: true,
                    slug: true,
                    location: true,
                    jobType: true,
                    mode: true,
                    displaySalary: true,
                    isFeatured: true,
                    isRemote: true,
                    // CO-C4 needs the third work-mode branch, CO-C1 the
                    // employer-stated first-posted date, and the CO-C6
                    // new-graduate question its own column.
                    isHybrid: true,
                    originalPostedAt: true,
                    newGradFriendly: true,
                    createdAt: true,
                    city: true,
                    state: true,
                    stateCode: true,
                    normalizedMinSalary: true,
                    normalizedMaxSalary: true,
                    // Required by computeSalarySnapshot to exclude
                    // LLM-inferred / clamped pay from a module whose copy
                    // asserts the figures are employer-posted.
                    salaryIsEstimated: true,
                    categoryTags: true,
                },
            },
        },
    });
});

// Generate dynamic metadata
export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;

    try {
        const company = await loadCompanyProfile(slug);
        if (!company) return { title: 'Company Not Found' };
        const companyName = displayText(company.name);

        // The robots decision reads the SAME rows as the render path's 404
        // gate, so a company can never be noindexed while its page renders
        // (and vice versa).
        const activeJobCount = company.jobs.length;
        const facts = buildCompanyProfileFacts(company.jobs);

        // P1 #12: edge-generated OG card via /api/og (pattern:
        // app/companies/page.tsx COMPANIES_OG_IMAGE) — company pages
        // previously shipped no social image at all.
        const title = buildCompanyTitle({
            company: companyName,
            states: facts.states,
            allRemote: facts.allRemote,
        });
        const ogImage = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${companyName} ${brand.niche.short} Jobs`)}&type=page&subtitle=${encodeURIComponent(`${activeJobCount} open ${brand.niche.descriptor} position${activeJobCount === 1 ? '' : 's'}: salary data, locations, direct apply`)}`;

        // CO-meta: the blurb still leads when the employer wrote one, but the
        // cut lands on a word boundary and the whole string stays inside the
        // SERP budget instead of running past it with an ellipsis.
        const blurb = normalizeDisplayText(company.description);
        const description = blurb
            ? truncateOnWord(`${blurb} View open ${brand.niche.short} roles at ${companyName}.`, DESCRIPTION_MAX)
            : buildCompanyDescription({
                company: companyName,
                total: activeJobCount,
                states: facts.states,
                topSpecialty: facts.topSpecialties[0] ?? null,
                disclosed: facts.disclosedPay,
            });

        return {
            title,
            description,
            openGraph: {
                title,
                // Expanded from a 30-char default so social cards (LinkedIn,
                // Facebook) have enough copy to render a usable preview.
                description,
                url: `${brand.baseUrl}/companies/${slug}`,
                type: 'website',
                siteName: brand.name,
                images: [{
                    url: ogImage,
                    width: 1200,
                    height: 630,
                    alt: `${companyName}: open ${brand.niche.short} positions`,
                }],
            },
            twitter: {
                card: 'summary_large_image',
                title,
                description: `Browse ${activeJobCount} open ${brand.niche.descriptor} position${activeJobCount === 1 ? '' : 's'} at ${companyName}.`,
                images: [ogImage],
            },
            alternates: {
                canonical: `${brand.baseUrl}/companies/${slug}`,
            },
            // Index gate C-IDX (PLAN C.2): 5 or more active jobs. Below it the
            // page still renders and stays linked, it just does not compete in
            // search with the job detail pages it mostly repeats. 0 active
            // jobs never reaches here (410 in middleware, 404 below).
            robots: {
                index: shouldIndexCompanyProfile(activeJobCount),
                follow: true,
            },
        };
    } catch (error) {
        console.error(`[companies] Failed to generate metadata for ${slug}:`, error);
        return { title: 'Company' };
    }
}

interface SimilarEmployer {
    name: string;
    normalizedName: string;
    logoUrl: string | null;
    _count: { jobs: number };
}

/** Shared section chrome: the profile's own white card on the page ground. */
const sectionCard: React.CSSProperties = {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
};

/** Recessed row used by the practice-rules and cities lists. */
const innerTile: React.CSSProperties = {
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
};

export default async function CompanyPage({ params }: Props) {
    const { slug } = await params;
    const now = new Date();

    const company = await loadCompanyProfile(slug);

    if (!company) {
        notFound();
    }

    const activeJobCount = company.jobs.length;
    // Visible-text form of the name. BreadcrumbSchema, both JSON-LD blocks and
    // the avatar initial keep reading the raw company.name.
    const companyName = displayText(company.name);

    // GSC Fix: Companies with 0 active jobs → proper 404 instead of 200 + "No open positions".
    // Google flags these as soft 404 because the page renders but has no meaningful content.
    // A clean 404 stops crawl budget waste on empty company profiles.
    if (activeJobCount === 0) {
        notFound();
    }

    // ─── P1 #12: aggregates from the company's own active rows ─────────
    const salarySnapshot = computeSalarySnapshot(company.jobs);
    // CO-C1 to CO-C6 read one pure tally over the same rows the list below
    // renders, so no sentence can disagree with the listings under it.
    const facts: CompanyProfileFacts = buildCompanyProfileFacts(company.jobs, now);
    // Dedupe per job so each chip's badge counts POSTINGS, not tag entries —
    // the visible copy says "active postings in each area", and categoryTags
    // is a stored array column (a repeated tag on one row would otherwise
    // count that posting twice). lib/pseo/category-tagger.ts classifyJobTags
    // builds from a Set, so this is a cheap guard on column hygiene, not a
    // fix for a known-dirty writer.
    const categoryTally = tallyTop(
        company.jobs.flatMap((job) => [
            ...new Set(job.categoryTags.filter((tag) => VALID_CATEGORY_SLUGS.has(tag))),
        ]),
        MAX_BREAKDOWN_CHIPS,
    );
    // Same resolver the facts tally uses, so the chips and the footprint
    // sentence can never disagree about which states this employer hires in.
    const stateTally = tallyTop(
        company.jobs
            .map(resolveRowStateName)
            .filter((stateName): stateName is string => stateName !== null),
        MAX_BREAKDOWN_CHIPS,
    );

    // CO-C1 hiring footprint.
    const footprint = buildCompanyFootprintSentence({
        company: companyName,
        total: activeJobCount,
        states: facts.states,
        topSpecialties: facts.topSpecialties,
        newestPostedAt: facts.recency?.newestPostedAt ?? null,
    });

    // CO-C2 below the figure floor: the count sentence, never a number the
    // sample cannot carry.
    const payCountSentence = buildCompanyPaySentence({
        company: companyName,
        total: activeJobCount,
        disclosed: facts.disclosedPay,
    });

    // CO-C3 practice rules in the states this employer actually hires in.
    // A state with no dataset row drops out rather than printing a blank.
    const practiceStates = facts.topStates.flatMap((state) => {
        const env = getPracticeEnvironment(state.name);
        return env ? [{ state, env }] : [];
    });

    // CO-C4 work arrangement and experience.
    const workModeSentence = activeJobCount >= MIN_JOBS_FOR_WORK_ARRANGEMENT
        ? buildListingWorkModeSentence({
            mix: facts.workMode,
            subject: `open ${brand.niche.short} roles at ${companyName}`,
            min: MIN_JOBS_FOR_WORK_ARRANGEMENT,
        })
        : null;
    const jobTypeSentence = activeJobCount >= MIN_JOBS_FOR_WORK_ARRANGEMENT && facts.jobTypes
        ? buildListingJobTypesSentence(facts.jobTypes, MIN_JOBS_FOR_WORK_ARRANGEMENT)
        : null;
    const newGradSentence = activeJobCount >= MIN_JOBS_FOR_WORK_ARRANGEMENT
        ? buildNewGradSentence(facts.newGradFriendly)
        : null;
    const arrangementLines = [workModeSentence, jobTypeSentence, newGradSentence]
        .filter((line): line is string => line !== null);

    // CO-C6: one array feeds the visible accordion and the FAQPage schema, so
    // a question that fails its render condition leaves both together.
    const faqs: FaqEntry[] = buildCompanyFaqs({
        company: companyName,
        total: activeJobCount,
        states: facts.states,
        disclosed: facts.disclosedPay,
        workMode: facts.workMode,
        newGradFriendly: facts.newGradFriendly,
    });

    // Similar employers: other companies with an active job matching this
    // company's dominant category and/or dominant state. Skipped entirely
    // (module hidden) when neither dominant signal exists.
    //
    // CO-B9: the dominant category comes from the specialty and APRN axes
    // first (lib/company-profile-facts.ts), never from the employment-type
    // tags where "Full Time" used to win on nearly every profile and made
    // the same three large employers "similar" to everyone.
    const dominantCategory = facts.dominantCategory;
    const dominantState = stateTally[0]?.value ?? null;
    const similarityOr: Prisma.JobWhereInput[] = [
        ...(dominantCategory ? [{ categoryTags: { has: dominantCategory } }] : []),
        ...(dominantState
            ? [{ state: dominantState }, { stateCode: STATE_CODES[dominantState] }]
            : []),
    ];

    let similarEmployers: SimilarEmployer[] = [];
    if (similarityOr.length > 0) {
        try {
            similarEmployers = await prisma.company.findMany({
                where: {
                    id: { not: company.id },
                    jobs: {
                        // AND, not a spread: activeIndexableJobWhere() already
                        // owns the `OR` key for its null-expiry branch, so
                        // `{ ...activeIndexableJobWhere(now), OR: similarityOr }`
                        // would silently DROP the expiry predicate and match
                        // expired jobs.
                        some: {
                            AND: [activeIndexableJobWhere(now), { OR: similarityOr }],
                        },
                    },
                },
                select: {
                    name: true,
                    normalizedName: true,
                    logoUrl: true,
                    _count: {
                        select: {
                            // Same predicate as the profile's own 404 gate, so
                            // a card never advertises "N open positions" for a
                            // profile that then 404s.
                            jobs: { where: activeIndexableJobWhere(now) },
                        },
                    },
                },
                // Lifetime-jobCount ordering is only a candidate-window
                // heuristic here; the displayed ranking is the in-memory
                // re-sort below. See SIMILAR_EMPLOYER_CANDIDATE_POOL.
                orderBy: { jobCount: 'desc' },
                take: SIMILAR_EMPLOYER_CANDIDATE_POOL,
            });
            // Re-rank on the count the card actually shows (ties broken by
            // name so ISR output is stable across rebuilds).
            similarEmployers = [...similarEmployers]
                .sort((a, b) => b._count.jobs - a._count.jobs || a.name.localeCompare(b.name))
                .slice(0, MAX_SIMILAR_EMPLOYERS);
        } catch (error) {
            // Non-fatal: the profile renders without the similar-employers
            // module rather than failing the whole page.
            console.error(`[companies] Failed to fetch similar employers for ${slug}:`, error);
        }
    }

    const similarityParts = [
        ...(dominantCategory ? [categorySlugLabel(dominantCategory)] : []),
        ...(dominantState ? [dominantState] : []),
    ];

    // FAQPage rich results need more than one question; a single question is
    // a paragraph with a heading, not a FAQ page.
    const faqSchema = faqs.length >= MIN_FAQ_ENTRIES_FOR_SCHEMA
        ? JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqs.map((entry) => ({
                '@type': 'Question',
                name: entry.question,
                acceptedAnswer: { '@type': 'Answer', text: entry.answer },
            })),
        }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
        : null;

    return (
        <>
            <BreadcrumbSchema items={[
                { name: 'Home', url: brand.baseUrl },
                { name: 'Companies', url: `${brand.baseUrl}/companies` },
                { name: company.name, url: `${brand.baseUrl}/companies/${slug}` },
            ]} />

            <div className="min-h-screen py-8 px-4 sm:px-6 lg:px-8" style={{ backgroundColor: 'var(--bg-primary)' }}>
                <div className="max-w-5xl mx-auto">

                    {/* Company Header */}
                    <div
                        className="rounded-2xl p-8 mb-8"
                        style={{
                            ...sectionCard,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                        }}
                    >
                        <div className="flex flex-col sm:flex-row items-start gap-6">
                            {/* Logo */}
                            <div
                                className="flex-shrink-0 w-20 h-20 rounded-xl flex items-center justify-center text-3xl font-bold"
                                style={{
                                    background: company.logoUrl
                                        ? `url(${company.logoUrl}) center/cover no-repeat`
                                        : 'linear-gradient(135deg, #F472B6, #BE185D)',
                                    color: '#fff',
                                }}
                            >
                                {!company.logoUrl && company.name.charAt(0).toUpperCase()}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 mb-2 flex-wrap">
                                    <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                                        {companyName}
                                    </h1>
                                    {company.isVerified && (
                                        <span
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700"
                                            title="Directory signal: this employer's name matched our known-employer list when the listing was imported. It is not an employer-confirmed claim."
                                        >
                                            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                            Verified
                                        </span>
                                    )}
                                </div>

                                {/* Employer claim (brief #7). DELIBERATELY NOT the
                                    `isVerified` badge above and deliberately not
                                    adjacent to it: `isVerified` is an ingest-pipeline
                                    signal written at row creation by
                                    lib/company-normalizer.ts ("the scraped name matched
                                    the known-employer map"), while `claimVerifiedAt` is
                                    an admin approving a specific employer's request to
                                    own this profile. Two claims, two columns, two
                                    labels, two colours, and its own row with its own
                                    sentence — if they sat side by side as matching
                                    pills the schema-level separation would just be
                                    re-conflated in the UI. */}
                                {/* Employer type (teardown A6) — the THIRD member
                                    of the Company-trust family, and like its two
                                    siblings it gets its own row, own label, and
                                    own sentence rather than a matching pill next
                                    to them: `isVerified` = the scraper recognised
                                    the name, `claimVerifiedAt` = an employer
                                    claimed the profile, `recruitmentType` = a
                                    human on our team classified WHAT KIND of
                                    hiring organization this is. Renders nothing
                                    for the unclassified majority (null), and the
                                    copy stays deliberately neutral — a staffing
                                    agency is a fact, not a warning. */}
                                {company.recruitmentType && (
                                    <div className="mb-3">
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-200 text-slate-700">
                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                                            </svg>
                                            {RECRUITMENT_TYPE_LABELS[company.recruitmentType]}
                                        </span>
                                        <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                                            {company.recruitmentType === 'direct_hire'
                                                ? `Our team classified ${companyName} as a direct employer: it hires clinicians onto its own staff rather than recruiting for client organizations.`
                                                : `Our team classified ${companyName} as a staffing agency: it recruits and places clinicians with client organizations. That is a fact about how it hires, not a quality judgment; agencies and direct employers both post legitimate roles.`}
                                        </p>
                                    </div>
                                )}

                                {company.claimVerifiedAt && (
                                    <div className="mb-3">
                                        <span
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-800"
                                        >
                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" strokeWidth={2.2} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                                            </svg>
                                            Claimed by employer
                                        </span>
                                        <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                                            Someone at {companyName} asked to be recognized as this profile&apos;s
                                            owner, and our team approved the request on{' '}
                                            {formatApprovalDate(company.claimVerifiedAt)}. Claiming does not let an
                                            employer edit the listings or pay figures below; those remain
                                            derived from its live postings.
                                        </p>
                                    </div>
                                )}

                                {/* Meta row */}
                                <div className="flex flex-wrap items-center gap-4 text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                                    {company.website && (
                                        <a
                                            href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1 hover:text-pink-700 transition-colors"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                                            </svg>
                                            Website
                                        </a>
                                    )}
                                    <span className="flex items-center gap-1">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
                                        </svg>
                                        {activeJobCount} active {activeJobCount === 1 ? 'position' : 'positions'}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                                        </svg>
                                        {company.jobCount} total jobs posted
                                    </span>
                                </div>

                                {/* Description */}
                                {company.description && (
                                    <p className="text-base leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                        {company.description}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* CO-C1 — hiring footprint, built from this company's own
                        active rows. Absolute UTC date: the page is ISR-cached,
                        so a relative label would bake in and drift. */}
                    {footprint && (
                        <section
                            aria-labelledby="hiring-footprint-heading"
                            className="rounded-2xl p-6 mb-8"
                            style={sectionCard}
                        >
                            <h2 id="hiring-footprint-heading" className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                Hiring Footprint
                            </h2>
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                {footprint}
                            </p>
                        </section>
                    )}

                    {/* P1 #12 — Posted pay. Aggregated live from this company's
                        active postings that disclose an annualized pay range.
                        CO-C2: below the sample floor the block keeps the count
                        sentence and drops every figure. */}
                    <section
                        aria-labelledby="salary-snapshot-heading"
                        className="rounded-2xl p-6 mb-8"
                        style={sectionCard}
                    >
                        <h2 id="salary-snapshot-heading" className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                            Posted Pay at {companyName}
                        </h2>
                        {salarySnapshot && (
                            <>
                                <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
                                    Annualized from the {salarySnapshot.sampleSize === activeJobCount
                                        ? `${activeJobCount} active postings`
                                        : `${salarySnapshot.sampleSize} of ${activeJobCount} active postings`} that
                                    disclose a pay range. Figures are employer-posted, not {brand.name} estimates.
                                </p>
                                {/* 3-up collapses to a single column under 640px —
                                    three "$132k" tiles + their labels wrap to 3-4
                                    lines each inside a ~100px column on a 360px
                                    phone. */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    {[
                                        { label: 'Lowest posted minimum', value: salarySnapshot.min },
                                        { label: 'Median (range midpoint)', value: salarySnapshot.median },
                                        { label: 'Highest posted maximum', value: salarySnapshot.max },
                                    ].map((stat) => (
                                        <div
                                            key={stat.label}
                                            className="rounded-xl p-4 text-center"
                                            style={innerTile}
                                        >
                                            <div className="text-2xl font-bold" style={{ color: '#BE185D' }}>
                                                {formatAnnualUsd(stat.value)}
                                            </div>
                                            <div className="text-xs mt-1 font-medium" style={{ color: 'var(--text-tertiary)' }}>
                                                {stat.label}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                        {!salarySnapshot && (
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                {payCountSentence}{' '}
                                {facts.disclosedPay >= 1
                                    ? `Each posted range is on its own listing below. ${brand.name} publishes a median for one employer only at ${SALARY_SNAPSHOT_MIN_SAMPLE} or more postings with disclosed pay.`
                                    : (
                                        <>
                                            How often employers state pay is tracked in our{' '}
                                            <Link href="/reports/pay-transparency" style={{ color: '#BE185D' }}>
                                                pay transparency report
                                            </Link>
                                            .
                                        </>
                                    )}
                            </p>
                        )}
                    </section>

                    {/* CO-C4 — how the roles are set up. Renders from two active
                        postings up; each clause omits itself when its count is
                        zero rather than printing "0 hybrid". */}
                    {arrangementLines.length > 0 && (
                        <section
                            aria-labelledby="work-arrangement-heading"
                            className="rounded-2xl p-6 mb-8"
                            style={sectionCard}
                        >
                            <h2 id="work-arrangement-heading" className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                Work Arrangement and Experience
                            </h2>
                            <div className="text-sm leading-relaxed space-y-1.5" style={{ color: 'var(--text-secondary)' }}>
                                {arrangementLines.map((line) => (
                                    <p key={line}>{line}</p>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* P1 #12 — Category / state breakdown chips, linking into
                        the matching taxonomy and state hub pages. Hidden when
                        no active job carries a registry tag / resolvable state.
                        */}
                    {(categoryTally.length > 0 || stateTally.length > 0) && (
                        <section
                            aria-labelledby="hiring-focus-heading"
                            className="rounded-2xl p-6 mb-8"
                            style={sectionCard}
                        >
                            <h2 id="hiring-focus-heading" className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                                Where {companyName} Is Hiring
                            </h2>
                            {/* The badge is a count of THIS employer's active
                                postings, not of the page each chip links to.
                                Those pages apply their own filters — 23 of the
                                45 category slugs gate on title keywords rather
                                than the categoryTags column tallied here
                                (lib/filters.ts CATEGORY_FILTERS via
                                lib/pseo/category-landing-template.tsx
                                categoryWhere), so the destination total can
                                legitimately differ. Say what the number counts
                                instead of letting adjacency imply otherwise. */}
                            <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
                                Counts are {companyName}&apos;s active postings in each area. Follow a link
                                to browse every employer hiring for it.
                            </p>
                            {categoryTally.length > 0 && (
                                <div className="mb-4">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                        Specialties &amp; settings
                                    </h3>
                                    <div className="flex flex-wrap gap-2">
                                        {categoryTally.map(({ value, count }) => (
                                            <Link
                                                key={value}
                                                href={`/jobs/${value}`}
                                                className="ce-chip inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
                                                style={{
                                                    backgroundColor: 'var(--bg-primary)',
                                                    border: '1px solid var(--border-color)',
                                                    textDecoration: 'none',
                                                }}
                                            >
                                                {categorySlugLabel(value)}
                                                <span className="text-xs font-semibold" style={{ color: '#BE185D' }}>{count}</span>
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {stateTally.length > 0 && (
                                <div>
                                    <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                        By state
                                    </h3>
                                    <div className="flex flex-wrap gap-2">
                                        {stateTally.map(({ value, count }) => (
                                            <Link
                                                key={value}
                                                href={`/jobs/state/${stateToSlug(value)}`}
                                                className="ce-chip inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
                                                style={{
                                                    backgroundColor: 'var(--bg-primary)',
                                                    border: '1px solid var(--border-color)',
                                                    textDecoration: 'none',
                                                }}
                                            >
                                                {value}
                                                <span className="text-xs font-semibold" style={{ color: '#BE185D' }}>{count}</span>
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    {/* CO-C5 — the cities this employer posts in. A city is a
                        link only when the lossy slug round-trips back to the
                        same name AND this company alone already has enough
                        roles there to clear the city page's own render floor,
                        which is a lower bound on that page's total. Smaller
                        markets are named, never linked. */}
                    {facts.cities.length > 0 && (
                        <section
                            aria-labelledby="hiring-cities-heading"
                            className="rounded-2xl p-6 mb-8"
                            style={sectionCard}
                        >
                            <h2 id="hiring-cities-heading" className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                                Cities With Open Roles
                            </h2>
                            <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
                                A city links to its own job page once that page carries enough roles to
                                render. Smaller markets are named here and their roles are in the list below.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {facts.cities.map((city) => {
                                    const label = city.stateCode ? `${city.name}, ${city.stateCode}` : city.name;
                                    const badge = (
                                        <span className="text-xs font-semibold" style={{ color: '#BE185D' }}>{city.count}</span>
                                    );
                                    const key = `${city.name}|${city.stateCode ?? ''}`;
                                    return city.slug ? (
                                        <Link
                                            key={key}
                                            href={`/jobs/city/${city.slug}`}
                                            className="ce-chip inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
                                            style={{
                                                backgroundColor: 'var(--bg-primary)',
                                                border: '1px solid var(--border-color)',
                                                textDecoration: 'none',
                                            }}
                                        >
                                            {label}
                                            {badge}
                                        </Link>
                                    ) : (
                                        <span
                                            key={key}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
                                            style={{
                                                backgroundColor: 'var(--bg-primary)',
                                                border: '1px solid var(--border-color)',
                                                color: 'var(--text-secondary)',
                                            }}
                                        >
                                            {label}
                                            {badge}
                                        </span>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {/* CO-C3 — the regulatory picture a candidate needs before
                        applying out of state. Every line is the AANP authority
                        row plus the NCSBN compact status for that state
                        (lib/state-practice-authority.ts, lib/blog-license-guides.ts
                        through lib/pseo/practice-environment.ts). */}
                    {practiceStates.length > 0 && (
                        <section
                            aria-labelledby="practice-rules-heading"
                            className="rounded-2xl p-6 mb-8"
                            style={sectionCard}
                        >
                            <h2 id="practice-rules-heading" className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                                Practice Rules Where {companyName} Hires
                            </h2>
                            <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
                                Practice authority is the AANP classification for each state; compact status is
                                verified against the NCSBN roster.
                            </p>
                            <div className="space-y-3">
                                {practiceStates.map(({ state, env }) => (
                                    <div key={env.stateName} className="rounded-xl p-4" style={innerTile}>
                                        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                            {buildCompanyStatePracticeLine(env)}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs font-medium">
                                            <Link href={`/blog/${env.licenseGuideSlug}`} style={{ color: '#BE185D' }}>
                                                {env.stateName} license guide
                                            </Link>
                                            <Link href={`/jobs/state/${stateToSlug(env.stateName)}`} style={{ color: '#BE185D' }}>
                                                All {env.stateName} roles ({state.count} here)
                                            </Link>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Active Positions */}
                    <div className="mb-4">
                        <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            Open Positions ({activeJobCount})
                        </h2>
                    </div>

                    <div className="space-y-3">
                        {company.jobs.map((job) => (
                            <Link
                                key={job.id}
                                href={job.slug ? `/jobs/${job.slug}` : `/jobs/${job.id}`}
                                className="block rounded-lg p-5 transition-all hover:shadow-md group"
                                style={{
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: job.isFeatured ? '1.5px solid rgba(244,114,182,0.4)' : '1px solid var(--border-color)',
                                    textDecoration: 'none',
                                }}
                            >
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <h3 className="ce-hover-title font-semibold text-base transition-colors">
                                                {normalizeDisplayText(job.title)}
                                            </h3>
                                            {job.isFeatured && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-900">
                                                    Featured
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                                            <span>{normalizeDisplayText(job.location)}</span>
                                            {job.jobType && <span>· {job.jobType}</span>}
                                            {job.isRemote && <span className="text-pink-700 font-medium">Remote</span>}
                                            {job.displaySalary && <span>· {normalizeDisplaySalary(job.displaySalary)}</span>}
                                        </div>
                                    </div>
                                    <div className="text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                                        Posted {formatDate(job.createdAt.toISOString())}
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>

                    {/* P1 #12 — Similar employers, matched on this company's
                        dominant category/state. Hidden when no match exists. */}
                    {similarEmployers.length > 0 && (
                        <section aria-labelledby="similar-employers-heading" className="mt-10">
                            <h2 id="similar-employers-heading" className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                                Similar Employers
                            </h2>
                            <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
                                Other employers with active {brand.niche.short} openings in {similarityParts.join(' or ')}.
                            </p>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {similarEmployers.map((employer) => (
                                    <Link
                                        key={employer.normalizedName}
                                        // B30 inverse (app/sitemap.ts): legacy rows store space-form
                                        // normalizedName ("life stance"); the resolver never decodes
                                        // %20 and only falls back kebab→space, so emit canonical
                                        // kebab form or the link 404s.
                                        href={`/companies/${employer.normalizedName.replace(/ /g, '-')}`}
                                        className="flex items-center gap-3 rounded-lg p-4 transition-all hover:shadow-md group"
                                        style={{
                                            backgroundColor: 'var(--bg-secondary)',
                                            border: '1px solid var(--border-color)',
                                            textDecoration: 'none',
                                        }}
                                    >
                                        <div
                                            className="flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-lg font-bold"
                                            style={{
                                                background: employer.logoUrl
                                                    ? `url(${employer.logoUrl}) center/cover no-repeat`
                                                    : 'linear-gradient(135deg, #F472B6, #BE185D)',
                                                color: '#fff',
                                            }}
                                        >
                                            {!employer.logoUrl && employer.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="ce-hover-title font-semibold text-sm truncate transition-colors">
                                                {normalizeDisplayText(employer.name)}
                                            </div>
                                            <div className="text-xs font-medium" style={{ color: '#BE185D' }}>
                                                {employer._count.jobs} open {employer._count.jobs === 1 ? 'position' : 'positions'}
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* CO-C6 — the visible FAQ. Server-rendered <details>, so
                        every answer is in the HTML that backs the FAQPage
                        schema below; an entry that fails its render condition
                        leaves the accordion and the schema together. */}
                    {faqs.length > 0 && (
                        <section aria-labelledby="company-faq-heading" className="mt-10">
                            <h2 id="company-faq-heading" className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                                {companyName} Hiring Questions
                            </h2>
                            <CategoryFAQAccordion faqs={faqs} />
                        </section>
                    )}

                    {/* Claim step (brief #7). Rendered only while the profile is
                        unclaimed — once claimVerifiedAt is set the header badge
                        above is the surface, and re-offering "claim this" under
                        it would read as though the badge meant nothing.

                        The component is a client island on purpose: this route
                        is ISR-cached (`revalidate` at the top of this file) and
                        that cache is shared with Googlebot, so the viewer's
                        session is resolved in the browser rather than baked into
                        the HTML. It posts the resolved company.id — not the URL
                        slug — so a claim can never bind to the wrong row through
                        the kebab-vs-legacy-space fallback in
                        resolveCompanyNormalizedName above. */}
                    {!company.claimVerifiedAt && (
                        <div className="mt-10">
                            <ClaimProfileCta
                                companyId={company.id}
                                companyName={companyName}
                                intro={COMPANY_CLAIM_CTA}
                                profilePath={`/companies/${slug}`}
                            />
                        </div>
                    )}

                    {/* Back Link */}
                    <div className="mt-8 text-center">
                        <Link
                            href="/jobs"
                            className="text-pink-700 hover:text-pink-900 font-medium text-sm hover:underline"
                        >
                            Browse all {brand.niche.short} jobs
                        </Link>
                    </div>
                </div>
            </div>

            {/* Hover/idle colors live here, NOT in inline `style`. An inline
                style attribute outranks every class selector (Tailwind v4 emits
                no `!important` — tailwind.config.ts sets no `important` flag),
                so the previous `hover:text-pink-700` / `group-hover:text-pink-700`
                classes sat next to an inline `color` and never applied: the
                chips and card titles had NO hover feedback at all. Plain <style>
                matches the sibling hub (app/companies/page.tsx) and carries no
                `${}` interpolation, which deadlocks Turbopack in styled-jsx. */}
            <style>{`
                .ce-chip { color: var(--text-secondary); }
                .ce-chip:hover, .ce-chip:focus-visible { color: #BE185D; }
                .ce-hover-title { color: var(--text-primary); }
                .group:hover .ce-hover-title,
                .group:focus-visible .ce-hover-title { color: #BE185D; }
            `}</style>

            {/* JSON-LD Organization Structured Data.
                P0 #14: escape < / > so a scraped company description
                containing "</script>" can't break out of the script tag
                (XSS / broken schema). Same pattern as app/jobs/page.tsx. */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        '@context': 'https://schema.org',
                        '@type': 'Organization',
                        name: company.name,
                        url: company.website || `${brand.baseUrl}/companies/${slug}`,
                        ...(company.logoUrl && { logo: company.logoUrl }),
                        ...(company.description && { description: company.description }),
                    }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
                }}
            />

            {/* P1 #12 — ItemList JSON-LD for the open-positions list. Derived
                from the SAME company.jobs rows as the visible list (top 10,
                repo-wide ItemList convention — e.g. app/jobs/va/page.tsx),
                escaped with the same \u003c chain as the Organization schema
                because job titles are aggregator-sourced. */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        '@context': 'https://schema.org',
                        '@type': 'ItemList',
                        name: `Open ${brand.niche.short} positions at ${company.name}`,
                        numberOfItems: activeJobCount,
                        itemListElement: company.jobs.slice(0, 10).map((job, idx) => ({
                            '@type': 'ListItem',
                            position: idx + 1,
                            name: job.title,
                            url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
                        })),
                    }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
                }}
            />

            {/* CO-C6 — FAQPage from the SAME array the accordion renders, so
                the schema can never carry a question whose answer is absent
                from the server HTML. */}
            {faqSchema && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: faqSchema }}
                />
            )}
        </>
    );
}
