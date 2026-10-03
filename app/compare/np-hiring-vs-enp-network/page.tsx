/**
 * /compare/np-hiring-vs-enp-network — thin route over the shared comparison
 * renderer. All content lives in lib/compare-data.ts (single source, one
 * review date); see app/compare/comparison-shared.tsx.
 */
import type { Metadata } from 'next';
import { getCompetitorProfile, type CompetitorSlug } from '@/lib/compare-data';
import ComparisonPageBody, { buildCompareMetadata } from '../comparison-shared';

// Typed, so a folder name that is not a configured slug fails the type check
// (tests/regressions/p5-comparison-pages-routes.test.ts checks the reverse).
const SLUG: CompetitorSlug = 'np-hiring-vs-enp-network';

// Our price statements follow the launch-promo clock (lib/compare-data.ts),
// so the profile is read per render and the page re-renders hourly: it
// states the paid ladder once the promo ends, without a deploy.
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
    return buildCompareMetadata(getCompetitorProfile(SLUG, new Date()));
}

export default function NpHiringVsEnpNetworkPage() {
    return <ComparisonPageBody profile={getCompetitorProfile(SLUG, new Date())} />;
}
