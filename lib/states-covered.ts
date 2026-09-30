/**
 * How many US states the board lists live jobs in: the one definition behind
 * every "States Covered" figure (/about, /for-programs).
 *
 * WHY THIS EXISTS (indexing audit M-08). /about and the default share card
 * said "50 States Covered" as a hardcoded literal while /for-programs, which
 * measured it, showed 44. A coverage figure is an inventory count, so it is
 * measured here under the canonical predicate the job counts use
 * (lib/canonical-counts.ts), and a surface that cannot measure it omits the
 * figure rather than printing one.
 *
 * Only the 50 states count. The District of Columbia has state pages on this
 * site but is not a state, and a stray non-US code in an old row must never
 * inflate the figure.
 */
import { prisma } from '@/lib/prisma';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { STATE_CODES } from '@/lib/pseo/setting-state-config';

/** Postal codes of the 50 states (STATE_CODES minus the District of Columbia). */
export const US_STATE_ONLY_CODES: readonly string[] = Object.values(STATE_CODES).filter(
    (code) => code !== 'DC',
);

/**
 * The number of states with at least one live job, or null when the count
 * could not be read. Callers omit the figure on null; they never print a
 * fallback number.
 */
export async function getStatesCovered(now: Date = new Date()): Promise<number | null> {
    try {
        const rows = await prisma.job.groupBy({
            by: ['stateCode'],
            where: canonicalBucketWhere({ stateCode: { in: [...US_STATE_ONLY_CODES] } }, now),
        });
        return rows.length;
    } catch (error) {
        console.error('[states-covered] state count failed:', error instanceof Error ? error.message : error);
        return null;
    }
}
