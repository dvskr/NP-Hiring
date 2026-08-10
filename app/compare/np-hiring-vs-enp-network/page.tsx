/**
 * /compare/np-hiring-vs-enp-network — thin route over the shared comparison
 * renderer. All content lives in lib/compare-data.ts (single source, one
 * review date); see app/compare/comparison-shared.tsx.
 */
import { getCompetitorProfile, type CompetitorProfile } from '@/lib/compare-data';
import ComparisonPageBody, { buildCompareMetadata } from '../comparison-shared';

const SLUG = 'np-hiring-vs-enp-network';

const maybeProfile = getCompetitorProfile(SLUG);
if (!maybeProfile) {
    // Build-time invariant: the folder name must match a configured profile
    // slug (tests/regressions/p5-comparison-pages-routes.test.ts enforces
    // the reverse direction too).
    throw new Error(`No competitor profile configured for slug "${SLUG}"`);
}
// Re-typed const: module-level narrowing does not flow into the component
// closure, so hand the component an already-narrowed binding.
const profile: CompetitorProfile = maybeProfile;

export const metadata = buildCompareMetadata(profile);

export default function NpHiringVsEnpNetworkPage() {
    return <ComparisonPageBody profile={profile} />;
}
