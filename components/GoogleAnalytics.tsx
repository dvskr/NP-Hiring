'use client';

import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback, useRef } from 'react';
import {
  appendPageView,
  initConsentDefaults,
  initGaBase,
  isProductionAnalyticsEnv,
  trackPageView,
  setUserId,
  setUserProperties,
  type PendingPageView,
  type UserProperties,
} from '@/lib/analytics';
import { CONSENT_EVENT, type ConsentCategories } from '@/lib/consent';

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

/** Breathing room so document.title has settled on the new route. */
const TITLE_SETTLE_MS = 100;

/**
 * How long the first page view of a session waits for consent to settle.
 *
 * The automatic consent paths (GPC/DNT deny-all, implied-region
 * analytics-only) run from a lazily loaded chunk, so on a slow connection
 * they can land after the first hit. Matches BANNER_REVEAL_DELAY_MS in
 * components/CookieConsent.tsx: by the time the banner is revealed, the
 * decision tree has definitely run. Past that point no automatic grant is
 * coming, only a human click, and waiting for one would cost the page
 * view of every visitor who leaves without answering.
 */
const CONSENT_SETTLE_CEILING_MS = 1500;

// ── Route Change Tracker ────────────────────────────────────────
// Next.js SPA: client-side navigation does not reload the page, so a
// page_view fires on every pathname/searchParams change. The base config
// sets send_page_view:false (see initGaBase), which makes this the ONLY
// page-view mechanism: exactly one per document load and one per
// client-side navigation. A hit can be DELAYED while Consent Mode
// resolves, but it is queued rather than dropped, so the count holds.
function RouteChangeTracker({ consentSettled }: { consentSettled: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Only the first hit of this document load carries the campaign the
  // middleware attribution cookie describes.
  const landingHitSent = useRef(false);
  // Page views recorded before consent resolved. HELD, never discarded.
  const heldViews = useRef<PendingPageView[]>([]);

  useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;
    // Built before the consent check on purpose: a hit that has to wait
    // still has to remember which URL it was.
    const query = searchParams?.toString();
    const url = pathname + (query ? `?${query}` : '');
    const track = setTimeout(() => {
      // document.title is read here rather than at effect time because
      // the new route's <title> lands a tick after the URL does, and a
      // held hit must keep its own title instead of inheriting the title
      // of whatever page is open when the queue drains.
      const hit: PendingPageView = { url, title: document.title };
      if (!consentSettled) {
        // Hold rather than race consent. A page view sent while consent
        // is still 'denied' is a cookieless ping, and the grant that
        // arrives a moment later starts a second, cookied session from
        // the same visit.
        //
        // Held rather than dropped because a visitor can navigate before
        // consent resolves: a guarded route redirecting to /login once
        // the Supabase check returns, an interstitial that pushes on a
        // timer, or simply a job card clicked a second after hydration.
        // Dropping loses the entrance page outright and moves the
        // rescued campaign onto whatever page happens to be open when
        // consent settles. The remaining cost is a visitor who leaves
        // inside CONSENT_SETTLE_CEILING_MS, whose held hits are never
        // sent at all; that is the price of not fragmenting the session
        // of everyone who stays.
        heldViews.current = appendPageView(heldViews.current, hit);
        return;
      }
      // Consent has resolved: replay what was held, in arrival order,
      // then the current page. The first of them is the landing hit, so
      // the campaign lands on the page the attribution cookie describes
      // rather than on wherever the visitor had got to by then.
      const queue = appendPageView(heldViews.current, hit);
      heldViews.current = [];
      for (const entry of queue) {
        // The raw URL is passed on purpose: lib/analytics is the single
        // choke point that strips tokens and disallowed parameters, so
        // there is exactly one place to audit.
        trackPageView(entry.url, {
          title: entry.title,
          isLandingHit: !landingHitSent.current,
        });
        landingHitSent.current = true;
      }
    }, TITLE_SETTLE_MS);
    return () => clearTimeout(track);
  }, [pathname, searchParams, consentSettled]);

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
      // Silently fail: analytics should never break the app
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
   * Mode v2 defaults before gtag.js loads, so no localStorage probe is
   * needed.
   */
  initialConsent?: ConsentCategories | null;
}

/**
 * GA4 bootstrap WITHOUT inline <script> blocks (ISR fix F5).
 *
 * The previous version injected two inline scripts (consent defaults plus
 * gtag config) which required a per-request CSP nonce, and reading that
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
  // A recorded choice is already baked into the consent defaults below,
  // so for that visitor nothing further is pending and the first page
  // view has nothing to wait for.
  const [consentSettled, setConsentSettled] = useState(initialConsent !== null);

  useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;
    // Deployment gate. NODE_ENV alone is true on Vercel preview builds
    // too, which reported branch traffic into the live property.
    if (!isProductionAnalyticsEnv({
      vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
      nodeEnv: process.env.NODE_ENV,
      host: window.location.host,
    })) return;
    // 1. Consent Mode v2 defaults: must be queued before gtag.js executes.
    initConsentDefaults(initialConsent);
    // 2. gtag('js') + base config (send_page_view: false, see the M17
    //    note in lib/analytics.initGaBase).
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

  useEffect(() => {
    if (initialConsent !== null) return;
    // CookieConsent applies its gtag consent update synchronously and
    // dispatches this event afterwards, so the event arriving means the
    // update has already reached gtag. The ceiling covers the strict
    // region where the banner waits on a human, and the case where the
    // /api/consent write hangs and the event never arrives.
    const onConsentChange = () => setConsentSettled(true);
    window.addEventListener(CONSENT_EVENT, onConsentChange);
    const ceiling = setTimeout(() => setConsentSettled(true), CONSENT_SETTLE_CEILING_MS);
    return () => {
      window.removeEventListener(CONSENT_EVENT, onConsentChange);
      clearTimeout(ceiling);
    };
  }, [initialConsent]);

  // `bootstrapped` only ever flips inside the gated effect above, so this
  // renders nothing on the server, in development, and on previews.
  if (!GA_MEASUREMENT_ID || !bootstrapped) {
    return null;
  }

  return (
    <>
      {/* External loader only. Host-allowlisted in the middleware CSP
          (script-src https://www.googletagmanager.com), so no nonce and
          no Dynamic API read anywhere in the layout tree. */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />

      {/* SPA Route Tracker */}
      <Suspense fallback={null}>
        <RouteChangeTracker consentSettled={consentSettled} />
      </Suspense>

      {/* User Identity Sync */}
      <UserIdentitySync />
    </>
  );
}
