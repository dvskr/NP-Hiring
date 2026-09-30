import { prisma } from '@/lib/prisma';
import TopStatesList from '@/components/TopStatesList';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { resolveStateSlug, stateToSlug } from '@/lib/pseo/setting-state-config';

/** States the homepage grid shows. */
const TOP_STATES = 12;

/**
 * Distinct Job.state values fetched. Wider than the grid because one state can
 * be stored both as a name and as a code ("California", "CA"), and values that
 * are not a US state (a foreign country, a stray "Remote") are dropped.
 */
const STATE_VALUE_POOL = 80;

function toSlug(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/** One stored Job.state value and its live job count. */
export interface StateValueCount {
    state: string | null;
    jobs: number;
}

/** A state tile: canonical name, live job count, canonical /jobs/state slug. */
export interface TopState {
    name: string;
    count: number;
    slug: string;
}

/**
 * Fold stored state values into canonical US states (indexing audit H-04).
 * A name and its code merge into one tile, the slug is the exact form the
 * state page serves without a redirect (it 308s any other form), and values
 * that resolve to no US state are dropped instead of linked.
 */
export function mergeStateCounts(rows: readonly StateValueCount[], limit: number = TOP_STATES): TopState[] {
    const totals = new Map<string, number>();
    for (const row of rows) {
        const raw = row.state?.trim();
        if (!raw) continue;
        const name = resolveStateSlug(toSlug(raw));
        if (!name) continue;
        totals.set(name, (totals.get(name) ?? 0) + row.jobs);
    }
    return [...totals.entries()]
        .map(([name, jobs]) => ({ name, count: jobs, slug: stateToSlug(name) }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, limit);
}

/**
 * TopStatesSection (Server Component)
 * Fetches the states with the most live jobs, counted with the canonical
 * predicate the state pages themselves count with.
 */
export default async function TopStatesSection() {
    let states: TopState[] = [];

    try {
        const topStates = await prisma.job.groupBy({
            by: ['state'],
            where: canonicalBucketWhere({ state: { not: null } }),
            _count: { state: true },
            orderBy: { _count: { state: 'desc' } },
            take: STATE_VALUE_POOL,
        });

        states = mergeStateCounts(
            topStates.map((s) => ({ state: s.state, jobs: s._count.state })),
        );
    } catch (error) {
        console.error('Error fetching state data:', error);
    }

    // P0 #24: omit, never fabricate. The previous hardcoded fallback list
    // rendered invented per-state job counts whenever live data was thin.
    // Mirroring the homepage-FAQ omit-not-fabricate pattern: with no live
    // data, TopStatesList renders nothing at all (it returns null for an
    // empty list); with partial data we show only the real counts we
    // actually have.
    return <TopStatesList states={states} />;
}
