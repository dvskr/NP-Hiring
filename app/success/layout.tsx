import { brand } from '@/config/brand';
import { Metadata } from 'next';

/**
 * P6 #11: /success is a client component ('use client') and cannot export
 * metadata, so it shipped the generic root-layout title. Same remediation
 * shape as app/unsubscribe/layout.tsx.
 *
 * noindex, no canonical: checkout-funnel confirmation reached with a
 * ?session_id= token (or ?free=true) — already in middleware's
 * X-Robots-Tag list; the per-page robots below is the belt-and-suspenders
 * guard the sibling auth surfaces use.
 */
export const metadata: Metadata = {
    title: `Job Posting Confirmation | ${brand.name}`,
    description: `Confirmation for your ${brand.niche.short} job posting on ${brand.name}.`,
    robots: { index: false, follow: false },
};

export default function SuccessLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
