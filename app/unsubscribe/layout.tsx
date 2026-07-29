import { brand } from '@/config/brand';
import { Metadata } from 'next';

/**
 * P3 #13: /unsubscribe is a client component, so it could not export
 * metadata — an unsubscribe confirmation opened from an email showed the
 * generic site title in the tab. Same shape as
 * app/forgot-password/layout.tsx.
 *
 * noindex: token-bearing URL (already in robots.ts FULL_DISALLOW and
 * middleware's X-Robots-Tag list).
 */
export const metadata: Metadata = {
    title: `Unsubscribe | ${brand.name}`,
    description: `Manage whether you receive email from ${brand.name}.`,
    robots: { index: false, follow: false },
};

export default function UnsubscribeLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
