'use client';

import GoogleAnalytics from '@/components/GoogleAnalytics';
import ConsentGatedTelemetry from '@/components/ConsentGatedTelemetry';
import { useMirroredConsent } from '@/components/consent/useMirroredConsent';

/**
 * Client boundary that initializes analytics (GA4 + Speed Insights) from
 * the middleware-mirrored consent cookie instead of a server-side
 * `cookies()` read in the root layout (ISR fix F5).
 *
 * Renders nothing until the mirror has been read on the client — both
 * children are runtime-only (afterInteractive scripts / SpeedInsights),
 * so deferring their mount by one effect tick changes no user-visible
 * behavior and keeps SSR markup consent-independent (cacheable).
 */
export default function AnalyticsConsentBoundary() {
    const consent = useMirroredConsent();
    if (consent === undefined) return null;

    return (
        <>
            <GoogleAnalytics initialConsent={consent} />
            <ConsentGatedTelemetry initialConsent={consent} />
        </>
    );
}
