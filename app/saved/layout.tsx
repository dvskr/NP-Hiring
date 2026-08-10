import { brand } from '@/config/brand';
import { Metadata } from 'next';

/**
 * P6 #11: /saved is a client component ('use client') and cannot export
 * metadata, so it shipped the generic root-layout title. Same remediation
 * shape as app/data-request/layout.tsx / app/settings/layout.tsx.
 *
 * noindex: user-private surface — already carried middleware's
 * X-Robots-Tag (noindex, nofollow); the per-page robots below is the
 * belt-and-suspenders guard the sibling auth surfaces use.
 */
export const metadata: Metadata = {
    title: `Saved Jobs | ${brand.name}`,
    description: `Your saved and applied ${brand.niche.short} jobs on ${brand.name} — review, sort, and pick up where you left off.`,
    alternates: {
        canonical: `${brand.baseUrl}/saved`,
    },
    robots: { index: false, follow: false },
};

export default function SavedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
