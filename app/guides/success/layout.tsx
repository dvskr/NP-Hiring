import type { Metadata } from 'next';

/**
 * /guides/success is a client page and cannot export metadata. It is reached
 * from Stripe Checkout with a ?session_id= that the page moves out of the
 * address on load, so it is never indexed and sends no referrer.
 */
export const metadata: Metadata = {
    title: 'Your Guides Are Ready',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
};

export default function GuidesSuccessLayout({ children }: { children: React.ReactNode }) {
    return children;
}
