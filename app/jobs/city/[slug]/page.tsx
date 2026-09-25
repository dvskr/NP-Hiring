import type { Metadata } from 'next';
import type { Prisma } from '@prisma/client';
import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import { Bell, CalendarClock, Layers, MapPin, Tags, Wallet } from 'lucide-react';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { PUBLISHED_LISTING_WHERE } from '@/lib/pseo/listing-where';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { JOB_LISTING_OMIT } from '@/lib/pseo/job-listing-omit';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import { formatCount, pluralize } from '@/lib/display-text';
import { selectEligibleCities } from '@/lib/pseo/related-cities';
// P3 #9: the round-trip guard for THIS route's own builder/parser pair. A
// related city whose name does not survive parseCitySlug must not be linked.
import {
    buildStateCityDirectory,
    cityLinkResolves,
    shouldRenderStateCityDirectory,
} from '@/app/jobs/locations/[state]/directory';
import JobCard from '@/components/JobCard';
import { JobListViewTracker } from '@/components/analytics/ViewTrackers';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import CategoryHero, { crumbsFromSchema } from '@/components/CategoryHero';
import CategoryFAQ from '@/components/CategoryFAQ';
import ImmersiveImage from '@/components/ImmersiveImage';
import { Job } from '@/lib/types';
import { getMetroCity, getMetrosInState } from '@/lib/metro-data';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { getCityBySlug, getCityByNameState } from '@/lib/pseo/city-data/cities';
import type { CityData } from '@/lib/pseo/city-data/types';
import { buildCityFacts, buildCityNarrative } from '@/lib/pseo/city-narrative';
import { getListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import {
    buildCityCategoriesIntro,
    buildCityDescription,
    buildCityFaqs,
    buildCityPayParagraph,
    buildCityTitle,
    buildFreshnessSentence,
    buildListingJobTypesSentence,
    buildListingSettingsSentence,
    buildListingWorkModeSentence,
    formatK,
} from '@/lib/pseo/listing-narrative';
import { getPracticeEnvironment, isLicenseGuideLive } from '@/lib/pseo/practice-environment';
import {
    MIN_JOBS_FOR_LINK_LIST_ROW,
    pseoStatsFreshnessThreshold,
    shouldIndexLocalListingPage,
} from '@/lib/pseo/render-gate';
import { CATEGORY_AXIS_LABELS, getCategoryAxis, type CategoryAxis } from '@/lib/pseo/category-axis-guide';
import { ALL_CATEGORY_CONFIGS, formatStatsBadge } from '@/lib/pseo/category-city-template';
import { NAV_ICONS, SHARED_ART } from '@/lib/pseo/category-asset-registry';
import {
    CLAY_BODY,
    CLAY_INK,
    ClayCard,
    ClayStyles,
    EmployerRoster,
    ExploreGrid,
    PracticeCard,
    clayCard,
    clayLink,
    clayList,
    clayMeta,
    clayRow,
    clayTile,
    cx,
    employerSentence,
    type ExploreCard,
} from '@/components/seo/pseo';

// force-dynamic removed: it overrides revalidate and defeats ISR caching
export const revalidate = 3600; // Revalidate every hour

// P7 runtime fix D3: without a generateStaticParams export, `revalidate`
// is a silent no-op: Next renders the dynamic segment fully dynamically
// on every request (runtime-verified `private, no-cache, no-store` on
// /jobs/city/austin-tx). Returning [] enables on-demand static
// generation without build-time DB fan-out over 4,135 city records. Full
// rationale in app/jobs/[slug]/page.tsx; guarded by
// tests/regressions/p7-runtime-isr-static-params.test.ts.
export function generateStaticParams(): Array<{ slug: string }> {
    return [];
}

const NP = brand.niche.short;

/**
 * GA4 item_list_name for the listings on every city hub. The view_item_list
 * impression and each card's select_item read this one constant, because
 * GA4 joins a click to its impression on the name alone. One name for every
 * city rather than one per city, so the item-list reports keep a single row
 * for this surface instead of splitting it across thousands of cities.
 */
const CITY_HUB_LIST_NAME = 'City Hub Jobs';

/* State mappings (mirrored by lib/pseo/listing-gates-edge.ts for the middleware ruling) */

const STATE_CODES: Record<string, string> = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
    'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

const CODE_TO_STATE: Record<string, string> = Object.entries(STATE_CODES)
    .reduce((acc, [state, code]) => ({ ...acc, [code]: state }), {} as Record<string, string>);

/* Slug utilities */

interface ParsedCitySlug {
    cityName: string;
    stateName: string;
    stateCode: string;
}

/**
 * Parse a city slug like "new-york-ny" into { cityName, stateName, stateCode }.
 * The last segment (after the final hyphen) is the 2-letter state code.
 */
function parseCitySlug(slug: string): ParsedCitySlug | null {
    const normalized = slug.toLowerCase().trim();

    // Extract the last 2-char segment as the state code
    const match = normalized.match(/^(.+)-([a-z]{2})$/);
    if (!match) return null;

    const [, citySlugPart, stateCodeRaw] = match;
    const stateCode = stateCodeRaw.toUpperCase();
    const stateName = CODE_TO_STATE[stateCode];

    if (!stateName) return null;

    // Convert city slug back to a name (e.g. "new-york" becomes "New York")
    const cityName = citySlugPart
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    return { cityName, stateName, stateCode };
}

/**
 * Build a city slug from city name and state code
 */
function buildCitySlug(cityName: string, stateCode: string): string {
    const sanitizedCity = cityName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!sanitizedCity) return '';
    return `${sanitizedCity}-${stateCode.toLowerCase()}`;
}

/**
 * When a slug has no state code suffix (e.g. "virginia-beach" instead of "virginia-beach-va"),
 * look up the DB for any city that matches and return the canonical slug.
 * This is the redirect resolver the middleware mirrors (published rows with a
 * state code), not a count, so it keeps the published predicate.
 */
async function resolveAmbiguousSlug(slug: string): Promise<string | null> {
    const normalized = slug.toLowerCase().trim();
    const cityName = normalized
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const match = await prisma.job.findFirst({
        where: {
            ...PUBLISHED_LISTING_WHERE,
            city: { equals: cityName, mode: 'insensitive' },
            stateCode: { not: null },
        },
        select: { city: true, stateCode: true },
        orderBy: { createdAt: 'desc' },
    });

    if (match?.city && match?.stateCode) {
        return buildCitySlug(match.city, match.stateCode);
    }

    return null;
}

/* Scope: one bucket, one facts loader, shared by generateMetadata and the page */

/** The city bucket; getListingFacts and the listings compose the canonical predicate on top. */
function cityBucket(city: ParsedCitySlug): Prisma.JobWhereInput {
    return {
        city: { equals: city.cityName, mode: 'insensitive' },
        OR: [{ state: city.stateName }, { stateCode: city.stateCode }],
    };
}

function getCityFacts(city: ParsedCitySlug): Promise<ListingFacts> {
    return getListingFacts(`city:${city.stateCode}:${city.cityName}`.toLowerCase(), cityBucket(city));
}

/** P5: the dataset row by route slug, else by the parsed (name, state) pair ("oklahoma-city-ok" finds "oklahoma-ok"). */
function resolveCityData(slug: string, city: ParsedCitySlug): CityData | undefined {
    return getCityBySlug(slug) ?? getCityByNameState(city.cityName, city.stateCode);
}

/** T0-8: the dataset spelling ("McHenry"), else the spelling on the listings, else the title-cased slug. */
function resolveDisplayName(cityData: CityData | undefined, facts: ListingFacts, parsedName: string): string {
    return cityData?.name ?? facts.cities[0]?.name ?? parsedName;
}

function stateSlugOf(stateName: string): string {
    return stateName.toLowerCase().replace(/\s+/g, '-');
}

/* Data fetching */

async function getCityJobs(city: ParsedCitySlug) {
    return prisma.job.findMany({
        where: canonicalBucketWhere(cityBucket(city)),
        omit: JOB_LISTING_OMIT, // Perf1: cards don't use the full description body
        orderBy: BEST_SORT_ORDER_BY,
        take: 10,
    });
}

interface RelatedCity {
    name: string;
    count: number;
    slug: string;
}

interface StateCityLinks {
    /** Other cities in the state whose own page renders (CITY-C7). */
    related: RelatedCity[];
    /** Whether /jobs/locations/{state} renders, by the directory's own gate. */
    directoryRenders: boolean;
}

/**
 * Other cities in the same state for the nearby-markets block, plus the
 * directory verdict from the same rows.
 */
async function getStateCityLinks(city: ParsedCitySlug): Promise<StateCityLinks> {
    const rows = await prisma.job.groupBy({
        by: ['city'],
        where: canonicalBucketWhere({
            city: { not: null },
            OR: [{ state: city.stateName }, { stateCode: city.stateCode }],
        }),
        _count: { city: true },
        orderBy: { _count: { city: 'desc' } },
        take: 12,
    });
    const named = rows.flatMap((row) => (row.city ? [{ city: row.city, count: row._count.city }] : []));

    // #4: only surface cities at/above the page's MIN_JOBS render gate so the
    // block never links to a city page that will notFound() (soft-404 trap).
    //
    // P3 #9: clearing the count gate is necessary but not sufficient. buildCitySlug
    // is lossy and parseCitySlug (above) is its inverse, so a stored name with a
    // period, apostrophe or hyphen ("St. Louis" becomes st-louis-mo, then
    // "St Louis") rebuilds into a DIFFERENT string, matches zero rows and
    // hard-404s on the same MIN_JOBS gate. cityLinkResolves runs that exact
    // round-trip (and exempts curated metros, which resolve by slug).
    const related = selectEligibleCities(
        named.filter((row) => cityLinkResolves(row.city, city.stateCode)),
        city.cityName,
        8,
    ).map((row) => ({
        name: row.city,
        count: row.count,
        slug: buildCitySlug(row.city, city.stateCode),
    }));

    // The directory gate needs one linkable city and three tracked cities; the
    // top-12 slice answers both exactly (a state with three or more cities
    // carrying jobs always fills three rows).
    const directory = buildStateCityDirectory(named, {
        canLink: (row) => cityLinkResolves(row.city, city.stateCode),
    });
    return { related, directoryRenders: shouldRenderStateCityDirectory(directory) };
}

interface CategoryRow {
    slug: string;
    label: string;
    count: number;
    /** The category x city page, linked only when it renders. */
    href: string | null;
}

interface CategoryGroup {
    axis: CategoryAxis;
    label: string;
    rows: CategoryRow[];
}

/** CITY-C2 reads as specialty, setting, job type first. */
const AXIS_ORDER: readonly CategoryAxis[] = [
    'specialty', 'setting', 'jobType', 'aprn', 'experience', 'employerType', 'population',
];

/** CITY-C2 renders at two or more categories. */
const MIN_CATEGORY_ROWS = 2;

/**
 * CITY-C2: fresh category x city stats for this city, grouped by taxonomy
 * axis. Rows link their page only at the shared link-list floor; a failed
 * query omits the section.
 */
async function getCityCategoryGroups(cityData: CityData | undefined): Promise<CategoryGroup[]> {
    if (!cityData) return [];
    let rows: Array<{ categorySlug: string; totalJobs: number }>;
    try {
        rows = await prisma.pseoStats.findMany({
            where: {
                type: 'category-city',
                locationSlug: cityData.slug,
                totalJobs: { gte: 1 },
                updatedAt: { gte: pseoStatsFreshnessThreshold() },
            },
            select: { categorySlug: true, totalJobs: true },
            orderBy: { totalJobs: 'desc' },
        });
    } catch (error) {
        console.error(`[city] category stats query failed for ${cityData.slug}:`, error);
        return [];
    }
    const byAxis = new Map<CategoryAxis, CategoryRow[]>();
    for (const row of rows) {
        const config = ALL_CATEGORY_CONFIGS[row.categorySlug];
        const axis = getCategoryAxis(row.categorySlug);
        if (!config || !axis) continue;
        const entry: CategoryRow = {
            slug: row.categorySlug,
            label: config.label,
            count: row.totalJobs,
            href: row.totalJobs >= MIN_JOBS_FOR_LINK_LIST_ROW
                ? `/jobs/${row.categorySlug}/city/${cityData.slug}`
                : null,
        };
        byAxis.set(axis, [...(byAxis.get(axis) ?? []), entry]);
    }
    const groups = AXIS_ORDER.flatMap((axis) => {
        const axisRows = byAxis.get(axis);
        return axisRows ? [{ axis, label: CATEGORY_AXIS_LABELS[axis], rows: axisRows }] : [];
    });
    const total = groups.reduce((n, group) => n + group.rows.length, 0);
    return total >= MIN_CATEGORY_ROWS ? groups : [];
}

/**
 * P3.4: prefer the approved LLM-generated DB override; fall back to the
 * deterministic narrative built from structured city facts. Keyed by the
 * dataset slug, which is what the snippet generator and the slug-repair
 * script write.
 */
async function getCityNarrative(cityData: CityData | undefined, totalJobs: number): Promise<string | null> {
    if (!cityData) return null;
    const dbOverride = await prisma.citySnippet.findUnique({
        where: { citySlug: cityData.slug },
        select: { body: true, approvedAt: true },
    });
    if (dbOverride?.approvedAt) return dbOverride.body;
    return buildCityNarrative(buildCityFacts(cityData), totalJobs);
}

/* Props and metadata */

interface CityPageProps {
    params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CityPageProps): Promise<Metadata> {
    try {
        const { slug } = await params;

        // Metro pages have their own metadata; skip if a metro exists.
        // Audit 19 M-4 priority rule (now documented): when a slug resolves
        // to BOTH a metro and a city (e.g. "new-york-ny" matches the
        // New York metro AND the city "New York, NY") the metro page
        // wins. Metros aggregate multiple cities under one geographic
        // brand and have richer editorial content than per-city pages. The
        // 308 from the city route to the metro route lives in the page
        // component below (priority resolution path).
        const metroMatch = getMetroCity(slug);
        if (metroMatch) return { title: `${NP} Jobs in ${metroMatch.city}` };

        let parsed = parseCitySlug(slug);

        if (!parsed) {
            // Try resolving slug without state code
            const canonical = await resolveAmbiguousSlug(slug);
            if (canonical) parsed = parseCitySlug(canonical);
            if (!parsed) return { title: 'City Not Found' };
        }

        const { stateName, stateCode } = parsed;
        const facts = await getCityFacts(parsed);
        const displayName = resolveDisplayName(resolveCityData(slug, parsed), facts, parsed.cityName);

        // CITY-C9: count first at the display floor, then the first suffix
        // that keeps the title inside the SERP budget; the description drops
        // clauses from the end until it fits 155 characters.
        const title = buildCityTitle({
            displayName,
            stateCode,
            total: facts.total,
            distinctEmployers: facts.distinctEmployers,
            benchmark: facts.benchmark,
        });
        const description = buildCityDescription({ displayName, stateName, facts });

        // /api/og/city is the generator built for this page (shared chrome
        // since P3 #8). Only params it reads are passed:
        //   city     headline second line ("in {city}").
        //   jobs     "Open Positions" tile.
        //   salary   "Salary Range" tile; omitted entirely below the
        //            benchmark gate, so the card drops the tile instead of
        //            showing a fabricated band (same omit-or-cite rule the
        //            page body follows). The band is the gated middle half.
        //   category deliberately NOT passed: this is the all-specialty hub.
        //   shortage deliberately NOT passed: the only data behind that badge
        //            is the donor behavioral-health shortage flag, gated to
        //            the one category that designation describes.
        const ogSalary = facts.benchmark
            ? `${formatK(facts.benchmark.p25)} to ${formatK(facts.benchmark.p75)}`
            : '';
        const ogParams = new URLSearchParams({
            city: `${displayName}, ${stateCode}`,
            jobs: String(facts.total),
            ...(ogSalary && { salary: ogSalary }),
        });
        const ogImageUrl = `/api/og/city?${ogParams.toString()}`;

        // PLAN C.2: the same predicate app/sitemap.ts reads. A rendered page
        // below the gate answers noindex, follow and keeps its self canonical.
        const indexable = shouldIndexLocalListingPage({
            activeJobs: facts.total,
            distinctEmployers: facts.distinctEmployers,
        });

        return {
            title,
            description,
            openGraph: {
                title,
                description,
                type: 'website',
                images: [{
                    url: ogImageUrl,
                    width: 1200,
                    height: 630,
                    alt: `${NP} Jobs in ${displayName}, ${stateCode}`,
                }],
            },
            twitter: {
                card: 'summary_large_image',
                title,
                description,
                images: [ogImageUrl],
            },
            alternates: {
                canonical: `${brand.baseUrl}/jobs/city/${slug}`,
            },
            ...(!indexable && {
                robots: {
                    index: false,
                    follow: true,
                },
            }),
        };
    } catch (error) {
        console.error('Error generating city metadata:', error);
        return {
            title: `${NP} Jobs by City`,
            description: `Find ${brand.niche.descriptor} jobs by city.`,
        };
    }
}

/* Presentation helpers (clay, the page's own vocabulary) */

const BLS = STAT_SOURCES.averageSalary;

/** The paragraph with its BLS cite (printed verbatim by the narrative) linked to the source page. */
function withBlsLink(text: string) {
    const at = text.indexOf(BLS.source);
    if (at < 0) return text;
    return (
        <>
            {text.slice(0, at)}
            <a href={BLS.sourceUrl} target="_blank" rel="noopener noreferrer" style={clayLink}>{BLS.source}</a>
            {text.slice(at + BLS.source.length)}
        </>
    );
}

/** A picture in its own clay frame: padding 0, the art edge to edge, the card clips the corners. */
function PictureFrame({ src, alt }: { src: string; alt: string }) {
    return (
        <div className="pseo-clay-card" style={{ ...clayCard, padding: 0, overflow: 'hidden', display: 'grid' }}>
            <ImmersiveImage src={src} alt={alt} minHeight={240} />
        </div>
    );
}

const eyebrowStyle = (color: string) => ({
    fontSize: '13px',
    fontWeight: 600,
    color,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.15em',
    textAlign: 'center' as const,
    marginBottom: '8px',
});

const bandHeadingStyle = {
    fontSize: 'clamp(24px, 3.2vw, 34px)',
    fontWeight: 700,
    color: '#1A2E35',
    textAlign: 'center' as const,
    marginBottom: '8px',
};

/**
 * CITY-C5: one paragraph, two branches, the national reference in both;
 * the gated middle half as a divided list, and the two pay resources.
 */
function CityPayCard({ city, facts, stateName, stateSlug }: { city: string; facts: ListingFacts; stateName: string; stateSlug: string }) {
    const row = facts.benchmark;
    const percentiles = row
        ? [
            { label: '25th percentile', value: formatK(row.p25) },
            { label: 'Median', value: formatK(row.median) },
            { label: '75th percentile', value: formatK(row.p75) },
        ]
        : [];
    const resources = [
        { href: `/salary-guide/${stateSlug}`, label: `${stateName} salary guide` },
        { href: '/tools/salary-benchmark', label: 'Salary benchmark tool' },
    ];
    return (
        <ClayCard chip="Pay" index={3} icon={Wallet} title={`Pay in ${city}`} desc={withBlsLink(buildCityPayParagraph({ city, benchmark: row }))}>
            {percentiles.length > 0 && (
                <ul className="pseo-clay-list" style={clayList}>
                    {percentiles.map((p, i) => (
                        <li key={p.label} style={clayRow(i === percentiles.length - 1)}>
                            <span>{p.label}</span>
                            <span style={clayMeta}>{p.value}</span>
                        </li>
                    ))}
                </ul>
            )}
            <ul className="pseo-clay-list" style={clayList}>
                {resources.map((r, i) => (
                    <li key={r.href} style={clayRow(i === resources.length - 1)}>
                        <Link href={r.href} style={clayLink}>{r.label}</Link>
                    </li>
                ))}
            </ul>
        </ClayCard>
    );
}

/** CITY-C2: one line per axis, labels linked only where the category x city page renders. */
function CityCategoriesCard({ city, groups }: { city: string; groups: CategoryGroup[] }) {
    if (groups.length === 0) return null;
    return (
        <ClayCard chip="Categories" index={1} icon={Tags} title="Specialties and job types here" desc={buildCityCategoriesIntro(city)}>
            <ul className="pseo-clay-list" style={clayList}>
                {groups.map((group, i) => (
                    <li key={group.axis} style={{ ...clayRow(i === groups.length - 1), display: 'block' }}>
                        <span style={{ fontWeight: 700, color: CLAY_INK }}>{group.label}: </span>
                        {group.rows.map((row, j) => (
                            <span key={row.slug}>
                                {j > 0 ? ', ' : ''}
                                {row.href ? <Link href={row.href} style={clayLink}>{row.label}</Link> : row.label}
                                {` (${row.count})`}
                            </span>
                        ))}
                    </li>
                ))}
            </ul>
        </ClayCard>
    );
}

/** CITY-C3: work mode, settings and job type, each sentence under its own floor. */
function CitySnapshotCard({ sentences }: { sentences: string[] }) {
    if (sentences.length === 0) return null;
    return (
        <ClayCard chip="Snapshot" index={2} icon={Layers} title="Listing snapshot">
            {sentences.map((sentence, i) => (
                <p key={sentence} style={{ fontSize: '14px', color: CLAY_BODY, lineHeight: 1.65, margin: i === sentences.length - 1 ? 0 : '0 0 8px' }}>
                    {sentence}
                </p>
            ))}
        </ClayCard>
    );
}

/* Page component */

export default async function CityJobsPage({ params }: CityPageProps) {
    const { slug } = await params;

    // Metro redirect: curated metro pages take priority over generic city pages.
    // #5: permanentRedirect (308). This is a canonical consolidation, so it must
    // pass link equity to the metro page; a plain redirect() is a 307 (temporary).
    const metroMatch = getMetroCity(slug);
    if (metroMatch) permanentRedirect(`/jobs/metro/${slug}`);

    const parsed = parseCitySlug(slug);

    if (!parsed) {
        // Try resolving slug without state code, then 308 to the canonical URL.
        const canonical = await resolveAmbiguousSlug(slug);
        if (canonical) {
            permanentRedirect(`/jobs/city/${canonical}`);
        }
        notFound();
    }

    const { cityName, stateName, stateCode } = parsed;
    const cityData = resolveCityData(slug, parsed);

    // Fetch all data in parallel
    const [facts, jobs, links, categoryGroups] = await Promise.all([
        getCityFacts(parsed),
        getCityJobs(parsed),
        getStateCityLinks(parsed),
        getCityCategoryGroups(cityData),
    ]);

    // SEO Fix: 404 thin city pages.
    // Aligns with the sitemap gate and the category x city template's
    // MIN_JOBS_FOR_CATEGORY_CITY = 3: pages with 1 to 2 jobs were rendering
    // with stub content and getting flagged as soft 404 / thin content in
    // GSC. The threshold matches the saved pSEO policy (MIN_JOBS = 3, see
    // memory seo_threshold_decision.md).
    //
    // This literal is DELIBERATE and drift-guarded rather than imported:
    // tests/regressions/p2-mesh-directories-state-cities.test.ts reads it out
    // of this file and asserts it equals MIN_CITY_JOBS_FOR_LINK (and, through
    // that, MIN_JOBS_FOR_CATEGORY_CITY and MIN_RELATED_CITY_JOBS). Every
    // surface that links here gates on that shared constant, so a link can
    // never point at a page this gate will 404. Changing the number here
    // without changing MIN_CITY_JOBS_FOR_LINK fails that test.
    const MIN_JOBS = 3;
    if (facts.total < MIN_JOBS) {
        notFound();
    }

    const displayName = resolveDisplayName(cityData, facts, cityName);
    const stateSlug = stateSlugOf(stateName);
    const env = getPracticeEnvironment(stateName);
    const [narrative, licenseGuideLive] = await Promise.all([
        getCityNarrative(cityData, facts.total),
        env ? isLicenseGuideLive(env.stateSlug) : Promise.resolve(false),
    ]);

    // CITY-C3 sentences share their builders with the FAQ, so an answer can
    // only restate a card the page rendered.
    const snapshotSentences = [
        buildListingWorkModeSentence({ mix: facts.workMode, subject: `active ${NP} listings in ${displayName}` }),
        buildListingSettingsSentence(facts.settings),
        buildListingJobTypesSentence(facts.jobTypes),
    ].filter((s): s is string => s !== null);
    const freshness = buildFreshnessSentence(facts.recency);
    const categoryLabels = categoryGroups
        .flatMap((group) => group.rows)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((row) => row.label);
    const faqs = buildCityFaqs({ city: displayName, stateCode, facts, env, categoryLabels });
    const description = buildCityDescription({ displayName, stateName, facts });

    // CITY-C9 hero stats: positions; the gated median, else the employer
    // count at 2 or more; listings posted in the last 30 days. A tile whose
    // figure is missing is omitted, never padded.
    const heroStats = [
        { value: String(facts.total), label: pluralize(facts.total, 'position') },
        ...(facts.benchmark
            ? [{ value: formatK(facts.benchmark.median), label: 'median posted pay' }]
            : facts.distinctEmployers >= 2
                ? [{ value: String(facts.distinctEmployers), label: pluralize(facts.distinctEmployers, 'employer') }]
                : []),
        ...(facts.recency.last30 > 0
            ? [{ value: String(facts.recency.last30), label: 'posted in 30 days' }]
            : []),
    ];

    const schemaCrumbs = [
        { name: 'Home', url: brand.baseUrl },
        { name: 'Jobs', url: `${brand.baseUrl}/jobs` },
        { name: stateName, url: `${brand.baseUrl}/jobs/state/${stateSlug}` },
        { name: displayName, url: `${brand.baseUrl}/jobs/city/${slug}` },
    ];

    const alertHref = `/job-alerts?location=${encodeURIComponent(`${displayName}, ${stateCode}`)}`;

    // CITY-C7: the three former link modules as one block. Every card's
    // target renders: the state hub and salary guide render at 1 or more
    // state jobs (this city alone carries 3 or more), the directory by its
    // own gate, the remote landing always, metro guides for every curated slug.
    const exploreCards: ExploreCard[] = [
        { href: `/jobs/state/${stateSlug}`, label: `${stateName} ${NP} Jobs`, sub: `All ${stateCode} positions`, icon: NAV_ICONS.location, renders: true },
        { href: `/salary-guide/${stateSlug}`, label: `${stateName} Salary Guide`, sub: `${stateName} pay data`, icon: NAV_ICONS.salary, renders: true },
        { href: `/jobs/locations/${stateSlug}`, label: `${stateName} Cities`, sub: 'Cities with open roles', icon: NAV_ICONS.location, renders: links.directoryRenders },
        { href: '/jobs/remote', label: `Remote ${NP} Jobs`, sub: 'Roles the employer marks as remote', icon: NAV_ICONS.remote, renders: true },
        ...getMetrosInState(stateName).map((metro): ExploreCard => ({
            href: `/jobs/metro/${metro.slug}`,
            label: `${metro.city} Metro Guide`,
            sub: metro.metroArea,
            icon: NAV_ICONS.location,
            renders: true,
        })),
    ];

    // CITY-C1 to C3 share one grid sized to what rendered; each card's own
    // floor decides (the roster's through the same helper the component reads).
    const employerVariant = { kind: 'city', city: displayName } as const;
    const marketCards = [
        <EmployerRoster key="employers" variant={employerVariant} facts={facts} title="Employers hiring now" index={0} />,
        <CityCategoriesCard key="categories" city={displayName} groups={categoryGroups} />,
        <CitySnapshotCard key="snapshot" sentences={snapshotSentences} />,
    ];
    const marketCardCount = [
        employerSentence(employerVariant, facts) !== null,
        categoryGroups.length > 0,
        snapshotSentences.length > 0,
    ].filter(Boolean).length;

    const ledeParts = [
        formatCount(facts.total, 'open position'),
        facts.distinctEmployers >= 2 ? formatCount(facts.distinctEmployers, 'employer') : null,
        facts.benchmark ? `${formatK(facts.benchmark.median)} median posted pay` : null,
    ].filter((part): part is string => part !== null);

    return (
        <div className="min-h-screen" style={{ background: '#FDFBF7' }}>
            <ClayStyles />
            {/* Breadcrumb Schema */}
            <BreadcrumbSchema items={schemaCrumbs} />
            <JobListViewTracker
                jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))}
                listName={CITY_HUB_LIST_NAME}
            />

            {/* ItemList: recovers Google Jobs eligibility on the generic city
                surface. Mirrors the schema block in lib/pseo/category-city-template.tsx;
                numberOfItems is the canonical count. */}
            {jobs.length > 0 && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            '@context': 'https://schema.org',
                            '@type': 'ItemList',
                            name: `${NP} Jobs in ${displayName}, ${stateCode}`,
                            numberOfItems: facts.total,
                            itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({
                                '@type': 'ListItem',
                                position: idx + 1,
                                name: job.title,
                                url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
                            })),
                        }).replace(/</g, '\\u003c'),
                    }}
                />
            )}

            {/* Place schema: strengthens the geographic relevance signal. */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        '@context': 'https://schema.org',
                        '@type': 'Place',
                        name: `${displayName}, ${stateCode}`,
                        address: {
                            '@type': 'PostalAddress',
                            addressLocality: displayName,
                            addressRegion: stateCode,
                            addressCountry: 'US',
                        },
                    }),
                }}
            />

            {/* HERO (CITY-C9): H1 reads "{City} {niche} Jobs in {State}" */}
            <CategoryHero
                bgColor={SHARED_ART.usMapHero.bg}
                heroImage={SHARED_ART.usMapHero.src}
                heroAlt={`${NP} jobs in ${displayName}, ${stateCode}`}
                badgeText={formatStatsBadge(facts.total, facts.computedAt)}
                breadcrumbs={crumbsFromSchema(schemaCrumbs)}
                headlineLine1={displayName}
                headlineLine2={`${NP} Jobs`}
                headlineSub={`in ${stateName}`}
                stats={heroStats}
                description={description}
                ctaLabel={`View All ${displayName} Jobs`}
                ctaHref={`/jobs?location=${encodeURIComponent(displayName)}`}
            />

            {/* JOB LISTINGS */}
            <div id="jobs" style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
                <div className="grid lg:grid-cols-4 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-3">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>
                                {displayName} Positions ({facts.total})
                            </h2>
                            <Link href={`/jobs/state/${stateSlug}`} style={{ fontSize: '14px', fontWeight: 600, color: '#BE185D', textDecoration: 'none' }}>
                                All {stateName} Jobs →
                            </Link>
                        </div>
                        {jobs.length === 0 ? (
                            <div className="text-center py-12 rounded-xl" style={{ background: '#FFF', borderRadius: '18px', padding: '48px 24px', boxShadow: '6px 6px 20px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)' }}>
                                <MapPin className="h-12 w-12 mx-auto mb-4" style={{ color: '#A09080' }} />
                                <h3 className="text-lg font-semibold mb-2" style={{ color: '#1A2E35' }}>No positions at this time</h3>
                                <p className="mb-6" style={{ color: '#5A4A42' }}>Counts on this page refresh hourly from active postings. Browse the statewide feed in the meantime.</p>
                                <Link href={`/jobs/state/${stateSlug}`} style={{ padding: '12px 24px', borderRadius: '12px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>Browse {stateName} Jobs</Link>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                                    {/* One unpaginated slice, so the map index is the position. */}
                                    {jobs.map((job: Job, i: number) => (
                                        <JobCard key={job.id} job={job} listName={CITY_HUB_LIST_NAME} listIndex={i} />
                                    ))}
                                </div>

                                {/* Browse All CTA */}
                                {facts.total > jobs.length && (
                                    <div style={{ textAlign: 'center', marginTop: '32px' }}>
                                        <Link href={`/jobs?location=${encodeURIComponent(displayName)}`} className="pseo-clay-lift" style={{
                                            padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px',
                                            background: '#BE185D', color: '#fff', textDecoration: 'none',
                                            display: 'inline-flex', alignItems: 'center', gap: '8px',
                                            boxShadow: '4px 4px 12px rgba(190,24,93,0.2)',
                                        }}>
                                            View all {facts.total} jobs in {displayName}
                                        </Link>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Sidebar: the one alert CTA on this page, then the freshness card (CITY-C4) */}
                    <div className="lg:col-span-1" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div style={{ background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', borderRadius: '18px', padding: '24px', border: '2px solid rgba(190,24,93,0.15)', boxShadow: '6px 6px 20px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8)' }}>
                            <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
                            <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>Get {displayName} Alerts</h3>
                            <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>New {displayName} listings, delivered to your inbox.</p>
                            <Link href={alertHref} style={{ display: 'block', width: '100%', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#BE185D', color: '#fff', textDecoration: 'none' }}>Create Alert</Link>
                        </div>

                        {freshness && (
                            <ClayCard chip="Recency" index={2} icon={CalendarClock} title="How current the listings are" desc={freshness} />
                        )}
                    </div>
                </div>
            </div>

            {/* LOCAL MARKET: employers (C1), categories (C2), snapshot (C3), practice rules (C6), pay (C5).
                The pay card always renders, so the band does too. */}
            <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
                <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 40px' }}>
                    <p style={eyebrowStyle('#E86C2C')}>Local Market</p>
                    <h2 className="font-lora" style={bandHeadingStyle}>{displayName} {NP} Jobs at a Glance</h2>
                    <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '480px', margin: '0 auto 48px', lineHeight: 1.6 }}>
                        {ledeParts.join(' · ')}
                    </p>

                    {marketCardCount > 0 && (
                        <div
                            className={cx('pseo-clay-grid', marketCardCount > 1 ? `pseo-clay-cols-${marketCardCount}` : null)}
                            style={{ marginBottom: '14px' }}
                        >
                            {marketCards}
                        </div>
                    )}

                    <div className="pseo-clay-bento">
                        {env && (
                            <div className="pseo-clay-span-8 pseo-clay-split" style={{ gap: '14px', alignItems: 'stretch' }}>
                                <PracticeCard env={env} variant={{ kind: 'practicing' }} licenseGuideLive={licenseGuideLive} />
                                <PictureFrame src={SHARED_ART.statePractice} alt={`${stateName} practice environment illustration`} />
                            </div>
                        )}
                        <div
                            className={env ? 'pseo-clay-span-4' : 'pseo-clay-span-12 pseo-clay-split'}
                            style={env ? undefined : { gap: '14px', alignItems: 'stretch' }}
                        >
                            <CityPayCard city={displayName} facts={facts} stateName={stateName} stateSlug={stateSlug} />
                            {!env && <PictureFrame src={SHARED_ART.stateSalary} alt={`${displayName} posted pay illustration`} />}
                        </div>
                    </div>
                </section>
            </div>

            {/* NEARBY MARKETS (CITY-C7): the former sidebar, explore and mesh link modules as one block */}
            <div style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFF3E8 50%, #FFF8F0 100%)' }}>
                <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
                    <p style={eyebrowStyle('#BE185D')}>Nearby Markets</p>
                    <h2 className="font-lora" style={{ ...bandHeadingStyle, marginBottom: '40px' }}>{NP} Jobs Near {displayName}</h2>

                    {links.related.length > 0 && (
                        <div style={{ marginBottom: '40px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', marginBottom: '16px' }}>
                                More {stateName} cities
                            </h3>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                {links.related.map((city) => (
                                    <Link key={city.slug} href={`/jobs/city/${city.slug}`} className="pseo-clay-tile pseo-clay-lift" style={clayTile}>
                                        <span>{city.name}</span>
                                        <span style={clayMeta}>{formatCount(city.count, 'job')}</span>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    <ExploreGrid cards={exploreCards} />
                </section>
            </div>

            {/* MARKET CONTEXT: unique-per-city narrative (P3.4). Placed below
                jobs so candidates see listings first; crawlers index the HTML
                regardless of viewport position. */}
            {narrative && (
                <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '40px 24px 8px' }}>
                    <div
                        id="market-context"
                        data-speakable="true"
                        style={{
                            ...clayCard,
                            border: '1px solid rgba(0,0,0,0.06)',
                            padding: '24px 28px',
                        }}
                    >
                        <h2
                            className="font-lora"
                            style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', marginBottom: '10px' }}
                        >
                            {displayName}, {stateCode}: {NP} Market Context
                        </h2>
                        <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#5A4A42', margin: 0 }}>
                            {narrative}
                        </p>
                    </div>
                </section>
            )}

            {/* FAQ (CITY-C8): one array feeds the accordion and the FAQPage schema */}
            {faqs.length > 0 && (
                <CategoryFAQ
                    category="remote"
                    totalJobs={facts.total}
                    customFaqs={faqs}
                    heading={`${displayName} ${NP} Jobs FAQ`}
                />
            )}
        </div>
    );
}
