import { brand } from '@/config/brand';
import { Metadata } from 'next';

/**
 * P6 #11: /my-applications is a client component ('use client') and cannot
 * export metadata, so it shipped the generic root-layout title. Same
 * remediation shape as app/data-request/layout.tsx /
 * app/settings/layout.tsx.
 *
 * noindex: user-private surface — already carried middleware's
 * X-Robots-Tag (noindex, nofollow); the per-page robots below is the
 * belt-and-suspenders guard the sibling auth surfaces use.
 */
export const metadata: Metadata = {
    title: `My Applications | ${brand.name}`,
    description: `Track the ${brand.niche.short} jobs you have applied to on ${brand.name} — application status, dates, and next steps.`,
    alternates: {
        canonical: `${brand.baseUrl}/my-applications`,
    },
    robots: { index: false, follow: false },
};

export default function MyApplicationsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
