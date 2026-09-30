import { prisma } from '@/lib/prisma';
import { getSiteStats } from '@/lib/site-stats';
import ClayDoughStrip, { type EmployerChip } from '@/components/ClayDoughStrip';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { companyProfilePath, type CompanySlugSource } from '@/lib/company-slug';
import { displayText } from '@/lib/display-text';
import { shouldIndexCompanyProfile } from '@/lib/pseo/render-gate';
// FALLBACK_EMPLOYERS pads the strip with fabricated chips whenever the DB
// has <10 employers — see the FORK WARNING on its export before shipping.
import { FALLBACK_EMPLOYERS } from '@/config/niche/stats';

/** Chips the strip renders. */
const STRIP_SIZE = 25;

/**
 * Companies fetched per render. Wider than the strip so the rows the chip
 * rules drop (over-long names, two spellings of one employer sharing a
 * profile URL) never shrink the visible set.
 */
const CANDIDATE_POOL = 40;

/** Longest display name a chip carries before the tape layout breaks. */
const MAX_CHIP_NAME_LENGTH = 40;

/** Below this many real employers the (policy-empty) fallback list pads the strip. */
const MIN_REAL_EMPLOYERS = 10;
const MAX_WITH_FALLBACK = 18;

/** One company's live job count, as grouped from the canonical job pool. */
export interface CompanyJobCount {
    companyId: string;
    activeJobs: number;
}

/** The Company columns a chip needs. */
export interface ChipCompany extends CompanySlugSource {
    id: string;
}

/** Keyword search for an employer (the fallback link target; noindex, follow). */
function employerSearchHref(name: string): string {
    return `/jobs?q=${encodeURIComponent(name)}`;
}

/**
 * Employer chips for the homepage strip (indexing audit H-04 and L-03).
 *
 * - The count is the company's canonical live job count, the same pool its
 *   profile page counts, so a chip can no longer say "LifeStance Health 138"
 *   over a profile that says 105 open roles.
 * - A chip links the company profile whenever that profile passes its index
 *   gate (shouldIndexCompanyProfile), and a keyword search only otherwise.
 *   Every search URL is noindex with a canonical to /jobs; the profiles are
 *   the indexable pages that should rank for "{employer} NP jobs".
 * - Order follows `counts` (most live jobs first). Two rows that share one
 *   profile URL (the same employer spelled two ways) collapse to the first.
 */
export function buildEmployerChips(
    counts: readonly CompanyJobCount[],
    companies: readonly ChipCompany[],
    limit: number = STRIP_SIZE,
): EmployerChip[] {
    const byId = new Map(companies.map((company) => [company.id, company]));
    const seenHrefs = new Set<string>();
    const chips: EmployerChip[] = [];
    for (const { companyId, activeJobs } of counts) {
        if (chips.length >= limit) break;
        const company = byId.get(companyId);
        if (!company || activeJobs <= 0) continue;
        const name = displayText(company.name).trim();
        if (name.length === 0 || name.length > MAX_CHIP_NAME_LENGTH) continue;
        const href = shouldIndexCompanyProfile(activeJobs)
            ? companyProfilePath(company)
            : employerSearchHref(company.name);
        if (seenHrefs.has(href)) continue;
        seenHrefs.add(href);
        chips.push({ name, count: activeJobs, href });
    }
    return chips;
}

/**
 * EmployerTrustSection (Server Component)
 *
 * Fetches the employers with the most live jobs and renders the clay dough
 * strip. Grouped by Company row (not by the raw employer string), because the
 * profile a chip links to is a Company row.
 */
export default async function EmployerTrustSection() {
    let employers: EmployerChip[] = [];

    try {
        const now = new Date();
        const grouped = await prisma.job.groupBy({
            by: ['companyId'],
            where: canonicalBucketWhere({ companyId: { not: null } }, now),
            _count: { companyId: true },
            orderBy: { _count: { companyId: 'desc' } },
            take: CANDIDATE_POOL,
        });
        const counts: CompanyJobCount[] = grouped.flatMap((row) =>
            row.companyId ? [{ companyId: row.companyId, activeJobs: row._count.companyId }] : [],
        );
        const companies = counts.length === 0
            ? []
            : await prisma.company.findMany({
                where: { id: { in: counts.map((row) => row.companyId) } },
                select: { id: true, name: true, normalizedName: true },
            });
        employers = buildEmployerChips(counts, companies);
    } catch (error) {
        console.error('Error fetching employer data:', error);
    }

    // Use fallbacks if insufficient data
    if (employers.length < MIN_REAL_EMPLOYERS) {
        const existing = new Set(employers.map((e) => e.name.toLowerCase()));
        for (const fallback of FALLBACK_EMPLOYERS) {
            if (!existing.has(fallback.name.toLowerCase())) {
                employers.push({ ...fallback, href: employerSearchHref(fallback.name) });
            }
            if (employers.length >= MAX_WITH_FALLBACK) break;
        }
    }

    // Fresh board: FALLBACK_EMPLOYERS is empty by policy (no fabricated
    // chips), so with zero real DB employers there is nothing to show —
    // skip the strip entirely instead of rendering an empty marquee band.
    if (employers.length === 0) return null;

    // Live total for the strip's eyebrow line — cached snapshot, no COUNT.
    const { totalJobs } = await getSiteStats();
    const jobCountDisplay = totalJobs > 1000
        ? `${Math.floor(totalJobs / 100) * 100}+`
        : totalJobs.toLocaleString();

    return <ClayDoughStrip employers={employers} jobCountDisplay={jobCountDisplay} />;
}
