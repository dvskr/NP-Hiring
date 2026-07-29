import { brand } from '@/config/brand';
import { Metadata } from 'next';

/**
 * P3 #13: /reset-password is a client component, so it could not export
 * metadata — the tab fell back to the root layout template and read as the
 * generic site title while the user was mid password-reset. Same shape as
 * app/forgot-password/layout.tsx.
 *
 * noindex: this is a token-bearing URL (robots.ts FULL_DISALLOW +
 * middleware X-Robots-Tag already block it; the metadata makes the intent
 * explicit for anything that renders the page directly).
 */
export const metadata: Metadata = {
    title: `Set a New Password | ${brand.name}`,
    description: `Choose a new password for your ${brand.name} account.`,
    robots: { index: false, follow: false },
};

export default function ResetPasswordLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
