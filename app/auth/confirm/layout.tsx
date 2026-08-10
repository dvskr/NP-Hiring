import { brand } from '@/config/brand';
import { Metadata } from 'next';

/**
 * P6 #11: /auth/confirm is a client component ('use client') and cannot
 * export metadata, so a magic-link / password-reset landing showed the
 * generic root-layout title in the tab. Same remediation shape as
 * app/unsubscribe/layout.tsx.
 *
 * noindex, no canonical: token-bearing URL (Supabase hash fragment) —
 * already covered by middleware's /auth X-Robots-Tag prefix; the per-page
 * robots below is the belt-and-suspenders guard the sibling auth surfaces
 * use.
 */
export const metadata: Metadata = {
    title: `Confirm Your Account | ${brand.name}`,
    description: `Confirming your ${brand.name} sign-in link.`,
    robots: { index: false, follow: false },
};

export default function AuthConfirmLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
