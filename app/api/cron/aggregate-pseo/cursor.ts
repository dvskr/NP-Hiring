/**
 * Rotating city cursor for the aggregate-pseo cron (F7 fix).
 *
 * The cron is batched (BATCH_SIZE cities per invocation) but nothing ever
 * called it with ?offset>0, so every scheduled run restarted at offset 0 and
 * ~95% of the 4,135 cities never got fresh PseoStats rows. The cursor is
 * persisted in a sentinel PseoStats row (type 'meta', offset stored in
 * totalJobs) so each run resumes where the previous one stopped — including
 * partial batches aborted by the time budget — and wraps to 0 after the
 * last city.
 *
 * The sentinel row is invisible to every downstream consumer: the city
 * sitemaps, sitemap index, index-pseo cron, and pSEO templates all filter
 * on type 'category-city' or 'setting-state'.
 */
import { prisma } from '@/lib/prisma'

/** Sentinel key for the cursor row. */
export const CURSOR_TYPE = 'meta'
export const CURSOR_CATEGORY = 'aggregate-pseo'
export const CURSOR_LOCATION = 'city-cursor'

/**
 * Pure cursor math: advance by however many cities actually completed and
 * wrap to 0 once the end of the list is reached. A batch aborted by the
 * time budget advances by its completed count only, so the interrupted
 * city is re-processed by the next run instead of being skipped.
 */
export function computeNextOffset(
    startOffset: number,
    citiesCompleted: number,
    totalCities: number,
): number {
    if (totalCities <= 0) return 0
    const advanced = startOffset + citiesCompleted
    return advanced >= totalCities ? 0 : advanced
}

/**
 * Clamp a stored or user-supplied offset into [0, totalCities). Anything
 * non-integer or out of range (e.g. the city list shrank since the cursor
 * was written) restarts the rotation at 0.
 */
export function clampOffset(offset: number, totalCities: number): number {
    if (!Number.isFinite(offset) || !Number.isInteger(offset)) return 0
    if (offset < 0 || offset >= totalCities) return 0
    return offset
}

/**
 * Read the persisted cursor. A missing row (first run) or any read failure
 * falls back to 0 — the cron must keep aggregating even when the cursor is
 * unavailable.
 */
export async function readCityCursor(totalCities: number): Promise<number> {
    try {
        const row = await prisma.pseoStats.findUnique({
            where: {
                type_categorySlug_locationSlug: {
                    type: CURSOR_TYPE,
                    categorySlug: CURSOR_CATEGORY,
                    locationSlug: CURSOR_LOCATION,
                },
            },
            select: { totalJobs: true },
        })
        if (!row) return 0
        return clampOffset(row.totalJobs, totalCities)
    } catch (error) {
        console.error('[pseo-agg] Failed to read city cursor — falling back to offset 0:', error)
        return 0
    }
}

/**
 * Persist the next offset in the sentinel row. Returns false on failure so
 * the caller can surface it in metrics — a failed persist degrades to the
 * pre-fix restart behaviour for one run but must not fail the whole cron.
 */
export async function persistCityCursor(nextOffset: number): Promise<boolean> {
    try {
        await prisma.pseoStats.upsert({
            where: {
                type_categorySlug_locationSlug: {
                    type: CURSOR_TYPE,
                    categorySlug: CURSOR_CATEGORY,
                    locationSlug: CURSOR_LOCATION,
                },
            },
            update: { totalJobs: nextOffset },
            create: {
                type: CURSOR_TYPE,
                categorySlug: CURSOR_CATEGORY,
                locationSlug: CURSOR_LOCATION,
                totalJobs: nextOffset,
                rawAvgSalary: 0,
                colAdjustedSalary: 0,
            },
        })
        return true
    } catch (error) {
        console.error(`[pseo-agg] Failed to persist city cursor at ${nextOffset}:`, error)
        return false
    }
}
