'use client';

import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback } from 'react';
import {
  initConsentDefaults,
  initGaBase,
  trackPageView,
  setUserId,
  setUserProperties,
  type UserProperties,
} from '@/lib/analytics';
import type { ConsentCategories } from '@/lib/consent';

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

// ── Route Change Tracker ────────────────────────────────────────
// Next.js SPA — client-side nav doesn't reload the page.
// We fire page_view on every pathname/searchParams change.
function RouteChangeTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;
    const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : '');
    // Small delay so document.title has updated
    const t = setTimeout(() => trackPageView(url), 100);
    return () => clearTimeout(t);
  }, [pathname, searchParams]);

  return null;
}

// ── User Identity Sync ──────────────────────────────────────────
// Reads the Supabase session and sets user_id + user_properties
function UserIdentitySync() {
  const syncUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) { setUserId(null); return; }
      const data = await res.json();
      if (data?.id) {
        setUserId(data.id);
        const props: UserProperties = {};
        if (data.role) props.user_role = data.role;
        if (data.profileVisible !== undefined) props.has_resume = !!data.resumeUrl;
        setUserProperties(props);
      }
    } catch {
      // Silently fail — analytics should never break the app
    }
  }, []);

  useEffect(() => { syncUser(); }, [syncUser]);
  return null;
}

// ── Main Component ──────────────────────────────────────────────
interface GoogleAnalyticsProps {
  /**
   * Initial consent state, read client-side from the middleware-mirrored
   * consent cookie by AnalyticsConsentBoundary. Baked into the Consent
   * Mode v2 defaults before gtag.js loads — no localStorage probe needed.
   */
  initialConsent?: ConsentCategories | null;
}

/**
 * GA4 bootstrap WITHOUT inline <script> blocks (ISR fix F5).
 *
 * The previous version injected two inline scripts (consent defaults +
 * gtag config) which required a per-request CSP nonce — and reading that
 * nonce via headers() in the root layout silently opted every route out
 * of ISR. Consent defaults and the base config are now pushed onto the
 * dataLayer from bundled module code (lib/analytics), which CSP allows
 * via 'self'; only the external, host-allowlisted gtag.js loader remains
 * a <Script>. Ordering is guaranteed by gating the loader on
 * `bootstrapped`: everything queued in dataLayer before gtag.js loads is
 * replayed by GA in order, so the consent defaults always precede the
 * first hit.
 */
export default function GoogleAnalytics({ initialConsent = null }: GoogleAnalyticsProps) {
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (!GA_MEASUREMENT_ID || process.env.NODE_ENV !== 'production') return;
    // 1. Consent Mode v2 defaults — must be queued before gtag.js executes.
    initConsentDefaults(initialConsent);
    // 2. gtag('js') + base config (send_page_view: false — see M17 note
    //    in lib/analytics.initGaBase).
    initGaBase();
    // Deferred a tick: the dataLayer queue above is already populated
    // synchronously, so rendering the gtag.js <Script> one tick later
    // preserves ordering without a cascading sync re-render.
    const arm = setTimeout(() => setBootstrapped(true), 0);
    // initialConsent is fixed for the lifetime of this mount (the
    // boundary mounts us once, after the mirror cookie read); consent
    // CHANGES flow through gtag('consent','update') from the banner.
    return () => clearTimeout(arm);
  }, [initialConsent]);

  if (!GA_MEASUREMENT_ID || process.env.NODE_ENV !== 'production' || !bootstrapped) {
    return null;
  }

  return (
    <>
      {/* External loader only — host-allowlisted in the middleware CSP
          (script-src https://www.googletagmanager.com), so no nonce and
          no Dynamic API read anywhere in the layout tree. */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />

      {/* SPA Route Tracker */}
      <Suspense fallback={null}>
        <RouteChangeTracker />
      </Suspense>

      {/* User Identity Sync */}
      <UserIdentitySync />
    </>
  );
}
