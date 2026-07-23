import { brand } from '@/config/brand';
import type { Metadata } from 'next';

// Messages page itself is 'use client' (heavy stateful inbox UI), so
// metadata has to live in a server-component layout. Auth-gated and
// noindexed — this just gives the browser tab a real title ("Messages |
// <brand>", via the root title template) instead of the generic default.
export const metadata: Metadata = {
    title: 'Messages',
    description: `Your ${brand.name} inbox — conversations between employers and candidates.`,
    robots: { index: false, follow: false },
};

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
