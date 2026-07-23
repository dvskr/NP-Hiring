import { brand } from '@/config/brand';
import { Metadata } from 'next';

// B32: the page itself is a client component ('use client') and cannot
// export metadata, so title/description/canonical live in this layout.
// Without it, /do-not-sell shipped the generic root-layout title and no
// canonical — a duplicate-title cluster with every other bare page.
export const metadata: Metadata = {
    title: `Do Not Sell or Share My Personal Information | ${brand.name}`,
    description: `Opt out of the sale or sharing of your personal information under the CCPA/CPRA. One click disables analytics and marketing cookies on ${brand.name} for this device.`,
    alternates: {
        canonical: `${brand.baseUrl}/do-not-sell`,
    },
};

export default function DoNotSellLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
