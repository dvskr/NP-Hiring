'use client';

import dynamic from 'next/dynamic';
import { useMirroredConsent } from '@/components/consent/useMirroredConsent';

// Kept dynamic() (code-split) exactly as the root layout previously
// imported it — the banner is non-critical UI.
const CookieConsent = dynamic(() => import('@/components/CookieConsent'));

/**
 * Client boundary that feeds the cookie-consent banner its initial state
 * from the middleware-mirrored consent cookie instead of a server-side
 * `cookies()` read in the root layout (ISR fix F5).
 *
 * Waits for the mirror read (one effect tick) before mounting the banner
 * so CookieConsent's decision tree runs with the real prior choice —
 * mounting it early with `null` would wrongly re-prompt users who
 * already consented.
 */
export default function CookieConsentBoundary() {
    const consent = useMirroredConsent();
    if (consent === undefined) return null;

    return <CookieConsent initialConsent={consent} />;
}
