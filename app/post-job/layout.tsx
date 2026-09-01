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
// The real model is first-post-free + a flat per-post price; both derive
// from lib/config so the metadata cannot drift from the checkout again.
// (The regression test bans the old tier names from this file, so they are
// deliberately not quoted here.)
export const metadata: Metadata = {
    title: 'Post a Job',
    description: `Post your ${brand.niche.short} job opening — your first post is free with every feature included, then a flat $${config.postingPrice} per post. Every listing includes email alerts to subscribed candidates.`,
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
