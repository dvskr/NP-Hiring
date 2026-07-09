import { prisma } from '@/lib/prisma';
import { getSiteStats } from '@/lib/site-stats';
import ClayDoughStrip from '@/components/ClayDoughStrip';
import { findCanonicalName, normalizeCompanyName } from '@/lib/company-normalizer';
// FALLBACK_EMPLOYERS pads the strip with fabricated chips whenever the DB
// has <10 employers — see the FORK WARNING on its export before shipping.
import { FALLBACK_EMPLOYERS } from '@/config/niche/stats';

/**
 * EmployerTrustSection (Server Component)
 *
 * Fetches top employers with job counts from the database
 * and renders the clay dough strip.
 */
export default async function EmployerTrustSection() {
    let employers: { name: string; count: number }[] = [];

    try {
        // Pull more rows than we render so we can collapse variants
        // ("Lifestance" + "LifeStance Health") into one chip without
        // shrinking the final visible set.
        const topEmployers = await prisma.job.groupBy({
            by: ['employer'],
            where: { isPublished: true },
            _count: { employer: true },
            orderBy: { _count: { employer: 'desc' } },
            take: 80,
        });

        // Collapse by canonical name. Falls back to normalizedName when
        // the company isn't in the KNOWN_COMPANIES table so unknown
        // variants ("Acme Health" vs "Acme Health LLC") still merge.
        const buckets = new Map<string, { name: string; count: number; rawCount: number }>();
        for (const e of topEmployers) {
            if (!e.employer || e.employer.length === 0 || e.employer.length > 40) continue;
            const canonical = findCanonicalName(e.employer);
            const key = canonical ?? normalizeCompanyName(e.employer);
            if (!key) continue;
            const display = canonical ?? e.employer;
            const existing = buckets.get(key);
            if (existing) {
                existing.count += e._count.employer;
                // Prefer the longer display string when no canonical is
                // known — "Acme Health" reads better than "Acme".
                if (!canonical && e.employer.length > existing.name.length) {
                    existing.name = e.employer;
                }
            } else {
                buckets.set(key, { name: display, count: e._count.employer, rawCount: e._count.employer });
            }
        }

        employers = Array.from(buckets.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 25)
            .map(({ name, count }) => ({ name, count }));
    } catch (error) {
        console.error('Error fetching employer data:', error);
    }

    // Use fallbacks if insufficient data
    if (employers.length < 10) {
        const existing = new Set(employers.map((e) => e.name.toLowerCase()));
        for (const fallback of FALLBACK_EMPLOYERS) {
            if (!existing.has(fallback.name.toLowerCase())) {
                employers.push(fallback);
            }
            if (employers.length >= 18) break;
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
