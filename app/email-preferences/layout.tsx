import { brand } from '@/config/brand';
import { Metadata } from 'next';

/**
 * P6 #11: /email-preferences is a client component ('use client') and
 * cannot export metadata, so an email-opened preferences page showed the
 * generic root-layout title in the tab. Same remediation shape as
 * app/unsubscribe/layout.tsx.
 *
 * noindex, no canonical: token-bearing URL (?token=) — already in
 * middleware's X-Robots-Tag list; the per-page robots below is the
 * belt-and-suspenders guard the sibling auth surfaces use.
 */
export const metadata: Metadata = {
    title: `Email Preferences | ${brand.name}`,
    description: `Choose which emails you receive from ${brand.name} — job alerts, reminders, and the newsletter.`,
    robots: { index: false, follow: false },
};

export default function EmailPreferencesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
