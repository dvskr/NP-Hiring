import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { Metadata } from 'next';

// Title is bare ("Post a Job") because the root layout's title.template
// (`%s | ${brand.name}`) already appends the brand suffix. Including the
// suffix here would render "Post a Job | PMHNP Hiring | PMHNP Hiring".
//
// Live-review item 7-vi: this description used to advertise a three-tier
// pricing ladder that has never existed on this board (a ghost inherited
// from the donor board's copy — /for-employers explicitly says 'No tiers').
// The real model is the launch promo (every post free through
// config.promoEndsLabel) followed by the per-post ladder + Employer plan;
// every number and date derives from lib/config so the metadata cannot
// drift from the checkout again. The promo sentence is dated on purpose:
// static metadata cannot flip on January 1, and "free through <date>" stays
// a true statement after that date where "first post free" would not.
// (The regression test bans the old tier names from this file, so they are
// deliberately not quoted here.)
export const metadata: Metadata = {
    title: 'Post a Job',
    description: `Post your ${brand.niche.short} job opening for free through ${config.promoEndsLabel}, with every feature included. From ${config.ladderStartsLabel}: $${config.introPrice} for your first post, $${config.postingPrice} for every post after that, or $${config.planPrice}/month for ${config.planSlots} active jobs. Every listing includes email alerts to subscribed candidates.`,
    alternates: {
        canonical: `${brand.baseUrl}/post-job`,
    },
};

export default function PostJobLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
