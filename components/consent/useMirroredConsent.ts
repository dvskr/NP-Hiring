'use client';

import { useEffect, useState } from 'react';
import { getMirroredConsent, type ConsentCategories } from '@/lib/consent';

/**
 * Client-side replacement for the root layout's former server-side
 * `cookies()` read of the HttpOnly consent cookie (ISR fix F5: any
 * Dynamic API in the root layout opts EVERY route out of ISR).
 *
 * Middleware mirrors the HttpOnly consent cookie (CONSENT_COOKIE) into
 * the non-HttpOnly mirror (CONSENT_MIRROR_COOKIE) on each non-crawler
 * request; this hook reads the mirror from document.cookie after mount.
 *
 * Returns:
 *   - `undefined` while unresolved (SSR + first client render) — callers
 *     must render nothing yet so server and client markup match;
 *   - `ConsentCategories` when a prior choice exists;
 *   - `null` when no valid prior choice is recorded.
 */
export function useMirroredConsent(): ConsentCategories | null | undefined {
    const [consent, setConsent] = useState<ConsentCategories | null | undefined>(undefined);

    useEffect(() => {
        // Deferred a tick: the mirror cookie is stable for the life of the
        // page load, so resolving one macrotask after mount avoids a
        // cascading synchronous re-render while keeping the SSR/first-render
        // markup (undefined → render nothing) hydration-safe.
        const resolve = setTimeout(() => setConsent(getMirroredConsent()), 0);
        return () => clearTimeout(resolve);
    }, []);

    return consent;
}
