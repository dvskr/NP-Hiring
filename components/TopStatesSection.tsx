import { prisma } from '@/lib/prisma';
import TopStatesList from '@/components/TopStatesList';

function toSlug(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * TopStatesSection (Server Component)
 * Fetches top 12 states by job count.
 */
export default async function TopStatesSection() {
    let states: { name: string; count: number; slug: string }[] = [];

    try {
        const topStates = await prisma.job.groupBy({
            by: ['state'],
            where: {
                isPublished: true,
                state: { not: null },
            },
            _count: { state: true },
            orderBy: { _count: { state: 'desc' } },
            take: 12,
        });

        states = topStates
            .filter((s) => s.state && s.state.length > 0)
            .map((s) => ({
                name: s.state!,
                count: s._count.state,
                slug: toSlug(s.state!),
            }));
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
