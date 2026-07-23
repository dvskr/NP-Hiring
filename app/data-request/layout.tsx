import { brand } from '@/config/brand';
import { Metadata } from 'next';

// B32: the page itself is a client component ('use client') and cannot
// export metadata, so title/description/canonical live in this layout.
// Without it, /data-request shipped the generic root-layout title and no
// canonical — a duplicate-title cluster with every other bare page.
export const metadata: Metadata = {
    title: `Data Request — Exercise Your Privacy Rights | ${brand.name}`,
    description: `Submit a GDPR, CCPA/CPRA, LGPD, or PIPEDA privacy request to ${brand.name}: access, delete, correct, export, or restrict the personal data we hold about you.`,
    alternates: {
        canonical: `${brand.baseUrl}/data-request`,
    },
};

export default function DataRequestLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
