import { brand } from '@/config/brand';
import { Metadata } from 'next';

/**
 * P6 #11: /jobs/edit/[token] is a client component ('use client') and
 * cannot export metadata, so the employer edit-link landing showed the
 * generic root-layout title in the tab. Same remediation shape as
 * app/unsubscribe/layout.tsx.
 *
 * noindex, no canonical: token-bearing PATH — middleware already sets
 * X-Robots-Tag (noindex, nofollow) for /jobs/edit/; the per-page robots
 * below is the belt-and-suspenders guard the sibling auth surfaces use.
 */
export const metadata: Metadata = {
    title: `Edit Your Job Posting | ${brand.name}`,
    description: `Update your ${brand.niche.short} job posting on ${brand.name} — details, salary, and application settings.`,
    robots: { index: false, follow: false },
};

export default function JobEditLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
