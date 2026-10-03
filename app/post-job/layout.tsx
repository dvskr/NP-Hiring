import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { LADDER_PRICES } from '@/lib/pricing-copy';
import { Metadata } from 'next';

// Title is bare ("Post a Job") because the root layout's title.template
// (`%s | ${brand.name}`) already appends the brand suffix. Including the
// suffix here would render "Post a Job | PMHNP Hiring | PMHNP Hiring".
//
// Live-review item 7-vi: this description used to advertise a three-tier
// pricing ladder that has never existed on this board (a ghost inherited
// from the donor board's copy: /for-employers explicitly says 'No tiers').
// The real model is the launch promo (every post free through
// config.promoEndsLabel) followed by the per-post ladder + Employer plan;
// every number and date derives from lib/config so the metadata cannot
// drift from the checkout again. (The regression test bans the old tier
// names from this file, so they are deliberately not quoted here.)
//
// Launch-promo clock (backlog 2.1): the description offers free posting and
// dates the ladder only while the promo runs; once config.promoEndsAt has
// passed it states the ladder as the current price. It was static metadata,
// which is evaluated once at build, so a dated "free through" line would
// have kept offering a free post that nobody could buy. generateMetadata
// builds it per render instead, and the layout re-renders hourly.
//
// pSEO index gate (PLAN C.2, thin-spec-4 O1): the form is a tool whose
// server HTML is an empty client shell, so it renders `noindex, follow`,
// keeps its self canonical, and app/sitemap.ts no longer lists it.
// /for-employers and /pricing carry the employer search intent.

// Applies to /post-job and its preview and checkout steps, which take their
// metadata from this layout. The description switches when the route next
// regenerates after the promo ends. The hour is not a hard bound:
// regeneration is stale-while-revalidate, so a render cached before the
// switch is served until its hour runs out and once more to the request that
// triggers the regeneration.
export const revalidate = 3600;

/** The description for `now`: the promo and the dated ladder, or the ladder. */
function postJobDescription(now: Date): string {
    if (config.isPromoActive(now)) {
        return `Post your ${brand.niche.short} job opening for free through ${config.promoEndsLabel}, with every feature included. From ${config.ladderStartsLabel}: $${config.introPrice} for your first post, $${config.postingPrice} for every post after that, or $${config.planPrice}/month for ${config.planSlots} active jobs. Every listing includes email alerts to subscribed candidates.`;
    }
    return `Post your ${brand.niche.short} job opening, with every feature included. ${LADDER_PRICES} Every listing includes email alerts to subscribed candidates.`;
}

export async function generateMetadata(): Promise<Metadata> {
    return {
        title: 'Post a Job',
        description: postJobDescription(new Date()),
        robots: { index: false, follow: true },
        alternates: {
            canonical: `${brand.baseUrl}/post-job`,
        },
    };
}

export default function PostJobLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
