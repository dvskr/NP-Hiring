/**
 * Server-side inputs for the homepage's internal links (indexing audit H-04).
 *
 * The homepage is the strongest page on the domain, so the links it spends
 * should land on pages Google is allowed to index. Category landings carry
 * their index verdict in the 'category-landing' PseoStats row that
 * app/api/cron/aggregate-pseo writes from the canonical job pool (the same
 * rows app/sitemap.ts reads for the landing URLs it submits). Reading the
 * stored verdict, rather than re-deriving it here, keeps the homepage on
 * whatever gate the cron applies without a second copy of the rule.
 */
import { prisma } from '@/lib/prisma';
import { pseoStatsFreshnessThreshold } from '@/lib/pseo/render-gate';

/** PseoStats row type and location key for the one-per-slug landing rows. */
const LANDING_ROW_TYPE = 'category-landing';
const LANDING_LOCATION_SLUG = 'all';

/**
 * Category slugs whose /jobs/{slug} landing is indexable right now.
 *
 * Same freshness window as the sitemap: a row the cron has not refreshed
 * within PSEO_STATS_MAX_AGE_HOURS says nothing current, so it counts as not
 * indexable. A failed read returns [] (the homepage then links only its
 * ungated pages) rather than failing the render of the most visited page.
 */
export async function getIndexableLandingSlugs(): Promise<string[]> {
    try {
        const rows = await prisma.pseoStats.findMany({
            where: {
                type: LANDING_ROW_TYPE,
                locationSlug: LANDING_LOCATION_SLUG,
                indexable: true,
                updatedAt: { gte: pseoStatsFreshnessThreshold() },
            },
            select: { categorySlug: true },
        });
        return Array.isArray(rows) ? rows.map((row) => row.categorySlug) : [];
    } catch (error) {
        console.error('[homepage] category-landing index verdicts unavailable:', error);
        return [];
    }
}
