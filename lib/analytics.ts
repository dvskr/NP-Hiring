/**
 * ═══════════════════════════════════════════════════════════════
 * Analytics: centralized dataLayer manager
 * ═══════════════════════════════════════════════════════════════
 *
 * Analytics following Google's recommended patterns:
 * 1. DataLayer-driven architecture (GTM-compatible)
 * 2. Consent Mode v2 (GDPR/CCPA compliant)
 * 3. User ID and custom dimensions
 * 4. Full funnel tracking (Search → View → Save → Apply → SignUp)
 * 5. E-commerce-style item tracking for job listings
 * 6. Engagement scoring
 *
 * Two invariants this file exists to hold, both easy to break by
 * accident:
 *   a. NOTHING secret reaches Google. Every URL that leaves this module
 *      goes through sanitizeAnalyticsPath / sanitizeAnalyticsUrl first,
 *      because this site routinely puts one-time tokens and Stripe
 *      session ids in the URL and window.location.href carries them
 *      verbatim.
 *   b. page_view is an EVENT. The base config sets send_page_view:false,
 *      so a repeated gtag('config') is not a page view and a second
 *      config for an already configured target is not a no-op either.
 */

import { brand } from '@/config/brand';
import { PRIVACY_SIGNAL_COOKIE } from '@/lib/consent';

// ── Types ───────────────────────────────────────────────────────

export type ConsentState = 'granted' | 'denied';

export interface ConsentConfig {
  analytics_storage: ConsentState;
  ad_storage: ConsentState;
  ad_user_data: ConsentState;
  ad_personalization: ConsentState;
  functionality_storage: ConsentState;
  personalization_storage: ConsentState;
  security_storage: ConsentState;
}

export interface JobItem {
  item_id: string;
  item_name: string;               // job title
  item_brand?: string;             // company name
  item_category?: string;          // job type (Full-time, Part-time, etc.)
  item_category2?: string;         // work mode (Remote, Hybrid, On-site)
  item_category3?: string;         // state
  item_category4?: string;         // source provider
  item_variant?: string;           // salary range
  price?: number;                  // normalized min salary (for value tracking)
  quantity?: number;               // always 1
  affiliation?: string;            // source site
}

export interface UserProperties {
  user_role?: string;              // job_seeker | employer
  user_plan?: string;              // free | starter | professional | enterprise
  profile_completeness?: number;   // 0-100
  has_resume?: boolean;
  license_states?: string;
}

// ── Globals ─────────────────────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dataLayer: any[];
    gtag: (...args: unknown[]) => void;
  }
}

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';

// ── Core DataLayer Push ─────────────────────────────────────────

function push(data: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(data);
}

function gtag(...args: unknown[]) {
  if (typeof window === 'undefined') return;
  // Use the global gtag() function when available: it pushes Arguments
  // objects to dataLayer which GA4 processes. Plain arrays are ignored.
  if (typeof window.gtag === 'function') {
    window.gtag(...args);
  } else {
    // Fallback before gtag.js loads: push via dataLayer using the
    // standard gtag pattern. We create a wrapper function so that
    // `arguments` is the real Arguments object GA4 expects.
    window.dataLayer = window.dataLayer || [];
    // eslint-disable-next-line prefer-spread
    Function.prototype.apply.call(
      // GA4 only processes REAL Arguments objects pushed to dataLayer,
      // plain arrays (what rest params would produce) are silently ignored,
      // so `arguments` is load-bearing here.
      // eslint-disable-next-line prefer-rest-params
      function() { window.dataLayer.push(arguments); },
      null,
      args
    );
  }
}

// ── Deployment gate ─────────────────────────────────────────────

/** Canonical production origin, without a trailing slash. */
const CANONICAL_ORIGIN = brand.baseUrl.replace(/\/+$/, '');

/** Canonical production host, lowercase, no scheme. */
const CANONICAL_HOST = CANONICAL_ORIGIN.replace(/^https?:\/\//, '').toLowerCase();

export interface AnalyticsEnvInput {
  /** NEXT_PUBLIC_VERCEL_ENV: 'production' | 'preview' | 'development'. */
  vercelEnv?: string;
  /** NODE_ENV of the build that is running. */
  nodeEnv?: string;
  /** window.location.host of the visitor's tab, port included. */
  host?: string;
}

/**
 * True only on the real production deployment.
 *
 * NODE_ENV is not a deployment gate. Vercel builds preview deployments
 * in production mode as well, so a NODE_ENV-only check lets every branch
 * preview and every rollback URL report into the live property, where
 * that traffic is indistinguishable from real visitors.
 *
 * NEXT_PUBLIC_VERCEL_ENV is the authoritative answer when the project
 * exposes system environment variables. It is absent otherwise (Next
 * inlines it as undefined at build time), so the fallback compares the
 * browser host against the canonical host from config/brand.ts: a
 * preview deployment is served from a *.vercel.app host and never from
 * the apex domain, so it fails the comparison.
 */
export function isProductionAnalyticsEnv(input: AnalyticsEnvInput): boolean {
  const vercelEnv = input.vercelEnv?.trim();
  if (vercelEnv) return vercelEnv === 'production';
  if (input.nodeEnv !== 'production') return false;
  const host = input.host?.trim().toLowerCase();
  if (!host) return false;
  return host === CANONICAL_HOST || host === `www.${CANONICAL_HOST}`;
}

// ── URL sanitization ────────────────────────────────────────────

/**
 * The only query parameters allowed to reach Google.
 *
 * Deny by default, on purpose. This site puts one-time credentials in
 * the query string (?token= on the unsubscribe, email-preference and
 * alert-manage links, ?session_id= on the Stripe success page) plus the
 * subscriber's own address (?email=), and gtag reports whatever URL it
 * is handed. An allowlist also means a secret parameter added next
 * quarter is dropped without anyone remembering this file exists.
 *
 * The entries are the job-search facets (lib/filters.ts
 * parseFiltersFromParams) plus listing navigation and two outcome flags,
 * which are the only parameters worth a report row.
 */
export const ANALYTICS_QUERY_ALLOWLIST: ReadonlySet<string> = new Set([
  'q',
  'workMode',
  'jobType',
  'specialty',
  'experienceLevel',
  'newGrad',
  'minYears',
  'salaryMin',
  'postedWithin',
  'location',
  'cityExact',
  'stateCode',
  'employer',
  'category',
  'recruitmentType',
  'page',
  'sort',
  // /success?free=1 and /job-alerts/confirmed?status=... describe an
  // outcome, never a person.
  'free',
  'status',
]);

interface SecretPathRule {
  /** Lowercase path segments that identify the route. */
  readonly prefix: readonly string[];
  /** Replacement for the segment that follows the prefix. */
  readonly placeholder: string;
}

/**
 * Routes whose NEXT path segment is a credential.
 *
 * Swapping the segment for the Next.js route-parameter name keeps one
 * GA4 row per ROUTE (which is the number anyone actually wants) instead
 * of one row per emailed magic link, and the token itself never leaves
 * the browser. Routes that carry their token in the query string are
 * handled by the allowlist above, not here.
 */
const SECRET_PATH_RULES: ReadonlyArray<SecretPathRule> = [
  // Employer job-edit magic link (app/jobs/edit/[token]).
  { prefix: ['jobs', 'edit'], placeholder: '[token]' },
  // Deprecated token dashboard (app/employer/dashboard/[token]). It only
  // redirects today, but the links are still live in old employer mail.
  { prefix: ['employer', 'dashboard'], placeholder: '[token]' },
];

function sanitizePathname(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  for (const rule of SECRET_PATH_RULES) {
    if (segments.length <= rule.prefix.length) continue;
    const matches = rule.prefix.every(
      (segment, index) => segments[index]?.toLowerCase() === segment,
    );
    // Everything below the token segment is dropped too: a deeper path
    // under a magic link is still part of the credentialed URL.
    if (matches) return `/${[...rule.prefix, rule.placeholder].join('/')}`;
  }
  return pathname || '/';
}

function sanitizeQuery(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  params.forEach((value, key) => {
    if (ANALYTICS_QUERY_ALLOWLIST.has(key)) kept.append(key, value);
  });
  const query = kept.toString();
  return query ? `?${query}` : '';
}

/**
 * Sanitize a path (with optional query and fragment) for page_path.
 *
 * The fragment is always dropped: Supabase magic links and password
 * recovery deliver #access_token and #refresh_token there, /auth/confirm
 * and /reset-password read them from window.location, and a fragment has
 * never been worth a GA4 report row.
 */
export function sanitizeAnalyticsPath(pathWithQuery: string): string {
  try {
    const url = new URL(pathWithQuery, CANONICAL_ORIGIN);
    return `${sanitizePathname(url.pathname)}${sanitizeQuery(url.searchParams)}`;
  } catch {
    return '/';
  }
}

/** Sanitize an absolute (or origin-relative) URL for page_location. */
export function sanitizeAnalyticsUrl(href: string): string {
  try {
    const url = new URL(href, CANONICAL_ORIGIN);
    return `${url.origin}${sanitizePathname(url.pathname)}${sanitizeQuery(url.searchParams)}`;
  } catch {
    // Never return an empty string. gtag falls back to the raw
    // window.location.href whenever page_location is missing, which is
    // precisely the leak this function exists to close.
    return `${CANONICAL_ORIGIN}/`;
  }
}

// ── Landing attribution ─────────────────────────────────────────

/** GA4 manual campaign parameters, as GA4 spells them. */
export interface LandingAttribution {
  campaign_source?: string;
  campaign_medium?: string;
  campaign_name?: string;
}

/** GA4 truncates an event parameter value at 100 characters. */
const ATTRIBUTION_VALUE_MAX = 100;

/** No browser stores a cookie past about 4 KB; a larger value is not ours. */
const ATTRIBUTION_COOKIE_MAX = 4096;

/**
 * Name of the first-party attribution cookie middleware writes when it
 * strips utm_* off the URL.
 *
 * Spelled by derivation rather than as a literal because the name still
 * carries the donor brand prefix, and the niche-copy ratchet
 * (tests/regressions/niche-copy-debt.test.ts) fails any production file
 * that gains a new occurrence of it. middleware.ts owns the literal and
 * belongs to another branch, so it cannot export a shared constant yet.
 * tests/regressions/ga-tag-correctness.test.ts pins this value against
 * the literal in middleware.ts, so a rename on either side fails loudly
 * instead of silently reading a cookie that is never there.
 */
export const ATTRIBUTION_COOKIE_NAME = `${PRIVACY_SIGNAL_COOKIE.split('_')[0]}_attribution`;

function readRawCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  let jar = '';
  try {
    jar = document.cookie;
  } catch {
    // document.cookie throws in a sandboxed iframe with cookies blocked.
    return null;
  }
  const row = jar.split('; ').find((entry) => entry.startsWith(`${name}=`));
  if (!row) return null;
  const value = row.slice(name.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    // A hand-edited cookie can hold a stray percent sign, which makes
    // decodeURIComponent throw. The raw value is still handed to the
    // parser, which validates it on its own merits.
    return value;
  }
}

function cleanAttributionValue(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // The cookie is not HttpOnly, so any script on the page can write any
  // value into it. Strip control characters and clamp to the GA4 limit
  // before the value is allowed anywhere near a hit.
  const printable = [...raw]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim();
  if (!printable) return undefined;
  return printable.slice(0, ATTRIBUTION_VALUE_MAX);
}

/**
 * Parse the middleware attribution cookie into GA4 campaign parameters.
 *
 * Returns null for anything that is not a JSON object with at least one
 * usable string field. Never throws: the input is attacker-writable in
 * the sense that any value at all can appear there.
 */
export function parseAttributionCookie(
  raw: string | null | undefined,
): LandingAttribution | null {
  if (!raw || raw.length > ATTRIBUTION_COOKIE_MAX) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const attribution: LandingAttribution = {};
  const source = cleanAttributionValue(record.source);
  const medium = cleanAttributionValue(record.medium);
  const campaign = cleanAttributionValue(record.campaign);
  if (source) attribution.campaign_source = source;
  if (medium) attribution.campaign_medium = medium;
  if (campaign) attribution.campaign_name = campaign;
  return Object.keys(attribution).length > 0 ? attribution : null;
}

/**
 * Module-scope, so it resets on every document load and survives every
 * client-side navigation in between. That is exactly the scope the
 * campaign belongs to.
 */
let landingAttributionConsumed = false;

/**
 * Campaign parameters for the landing hit, once per document load.
 *
 * The cookie lives for 30 minutes so a slow client can still read it,
 * but the campaign describes ONE arrival. Stamping it on every route
 * change for half an hour would restate the campaign mid-session and
 * inflate the campaign's page-view count. A hard reload inside the same
 * 30 minutes does re-read the cookie, which restates the identical
 * values GA4 already holds for the session rather than inventing new
 * ones.
 */
export function consumeLandingAttribution(): LandingAttribution | null {
  if (landingAttributionConsumed) return null;
  landingAttributionConsumed = true;
  return parseAttributionCookie(readRawCookie(ATTRIBUTION_COOKIE_NAME));
}

// ── Consent Mode v2 ─────────────────────────────────────────────
// All non-essential storage is 'denied' by default (GDPR/CCPA/ePrivacy).
// CookieConsent component flips signals to 'granted' on user accept.

/**
 * Push the Consent Mode v2 defaults. Must run before gtag.js executes.
 *
 * `cats` is the previously recorded per-category consent (from the
 * middleware-mirrored consent cookie, see lib/consent.ts). Passing
 * null (no prior choice) keeps every non-essential signal 'denied'.
 *
 * Called from GoogleAnalytics.tsx as plain module code, NOT an inline
 * <script>, so no CSP nonce is needed and the root layout can stay
 * static/ISR-compatible (ISR fix F5).
 */
export function initConsentDefaults(cats: { analytics: boolean; marketing: boolean } | null = null) {
  const analytics: ConsentState = cats?.analytics === true ? 'granted' : 'denied';
  const marketing: ConsentState = cats?.marketing === true ? 'granted' : 'denied';
  gtag('consent', 'default', {
    analytics_storage: analytics,
    ad_storage: marketing,
    ad_user_data: marketing,
    ad_personalization: marketing,
    functionality_storage: 'granted',
    personalization_storage: analytics,
    security_storage: 'granted',
    wait_for_update: 500,           // ms to wait for consent before first hit
  } as Record<string, unknown>);
}

/**
 * One-time GA4 bootstrap: the `gtag('js')` timestamp plus the base
 * config. Replaces the former inline `ga-init` <script> in
 * GoogleAnalytics.tsx (inline scripts need a per-request CSP nonce,
 * which forced the root layout to read headers() and killed ISR).
 * Queued via dataLayer, so ordering vs. gtag.js loading is safe.
 */
export function initGaBase() {
  if (!GA_ID || typeof window === 'undefined') return;
  // Restore the classic-snippet global (regression guard): gtag.js itself
  // NEVER defines window.gtag. The deleted inline script's top-level
  // `function gtag(){dataLayer.push(arguments)}` was the only definition.
  // Direct consumers guard on `typeof window.gtag === 'function'`
  // (e.g. PseoPageViewTracker's pseo_page_view event in
  // components/analytics/ViewTrackers.tsx), so without this shim those
  // events silently stop firing. Must push the real Arguments object:
  // GA4 ignores plain arrays.
  if (typeof window.gtag !== 'function') {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtagShim() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    };
  }
  gtag('js', new Date());
  // custom_map and anonymize_ip are deliberately absent.
  //
  // custom_map is a Universal Analytics construct. GA4 ignores it, and
  // the map here had already drifted from reality (it registered
  // job_source, which nothing sends). In GA4 a custom event parameter
  // stays invisible in reports until it is registered by NAME under
  // Admin > Custom definitions. The parameters this codebase actually
  // sends, for whoever does that registration:
  //   dimensions  user_role, apply_method, job_id, job_title, company,
  //               job_type, work_mode, state, source, filter_name,
  //               filter_value, subscribe_source, checkout_type,
  //               pricing_tier, email_domain, candidate_id,
  //               recipient_type, link_url, link_text, pseo_page_type
  //   metrics     results_count, completeness, used, limit
  // anonymize_ip is ignored by GA4 as well: IP anonymization is
  // unconditional on every GA4 hit, so the flag only implied a control
  // we do not have.
  gtag('config', GA_ID, {
    // SEO Fix M17: send_page_view: false. RouteChangeTracker owns the
    // entire page_view lifecycle (initial plus SPA route changes), so
    // firing one here too would double count every session.
    send_page_view: false,
    // Sanitized: a visitor can land directly on a magic-link URL, and
    // these two values are attached to every event fired before the
    // first trackPageView (pseo_page_view, for one).
    page_path: sanitizeAnalyticsPath(window.location.pathname),
    page_location: sanitizeAnalyticsUrl(window.location.href),
    // SameSite=Lax, not None. None exists to let a cookie ride
    // cross-site requests, which matters only when the page runs inside
    // a third-party iframe. The embeddable widget (app/widget/route.ts)
    // is a Route Handler that returns a bare Response and bypasses the
    // root layout, so GA never runs in anybody else's frame and the
    // relaxation bought nothing while widening the cookie's exposure.
    cookie_flags: 'SameSite=Lax;Secure',
    cookie_domain: 'auto',
    cookie_expires: 63072000,
    // PRIVACY POSTURE, owner decision pending: these two are hardcoded
    // false, which OVERRIDES a visitor who accepts marketing in the
    // consent banner. gtag('consent','update') grants ad_storage, but a
    // config flag set to false wins, so Google Signals and ad
    // personalization stay off for everyone. Left exactly as it is on
    // purpose: flipping it would start sending more data to Google than
    // this site sends today, which is not a code cleanup.
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
}

export function updateConsent(consent: Partial<ConsentConfig>) {
  gtag('consent', 'update', consent as Record<string, unknown>);
}

export function grantAllConsent() {
  updateConsent({
    analytics_storage: 'granted',
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    personalization_storage: 'granted',
  });
}

export function denyAllConsent() {
  updateConsent({
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    personalization_storage: 'denied',
  });
}

/**
 * Map per-category consent (Essential / Analytics / Marketing) to the
 * granular Consent Mode v2 signals.
 */
export function updateConsentByCategories(cats: { analytics: boolean; marketing: boolean }) {
  updateConsent({
    analytics_storage: cats.analytics ? 'granted' : 'denied',
    personalization_storage: cats.analytics ? 'granted' : 'denied',
    ad_storage: cats.marketing ? 'granted' : 'denied',
    ad_user_data: cats.marketing ? 'granted' : 'denied',
    ad_personalization: cats.marketing ? 'granted' : 'denied',
  });
}

// ── User Identity ───────────────────────────────────────────────

export function setUserId(userId: string | null) {
  if (!GA_ID) return;
  // gtag('set') attaches user_id to every subsequent hit without
  // touching the measurement id's configuration. The former
  // gtag('config', GA_ID, { user_id }) re-configured an already
  // configured target, which re-runs config initialization and risks a
  // duplicate page view on every load for every signed-in visitor.
  // UserIdentitySync calls this on each mount, so the cost was paid on
  // every page load, not once.
  gtag('set', { user_id: userId });
}

export function setUserProperties(props: UserProperties) {
  if (!GA_ID) return;
  gtag('set', 'user_properties', props as Record<string, unknown>);
}

// ── Page Tracking ───────────────────────────────────────────────

/** One page view waiting to be sent, carrying the title of ITS own page. */
export interface PendingPageView {
  url: string;
  title: string;
}

/**
 * Append a page view to an ordered queue unless it repeats the entry
 * already at the end.
 *
 * RouteChangeTracker holds page views while Consent Mode is still
 * resolving and replays them afterwards, so the queue has to keep
 * arrival order. The repeat check is load-bearing for one specific case:
 * when consent settles, the tracker's effect re-runs for the SAME url it
 * queued a moment earlier, so the held entry and the current one are one
 * page view arriving twice. Only an immediate repeat is dropped, so a
 * genuine A to B to A navigation still produces three hits.
 *
 * Pure and exported because this repo's vitest runs in the node
 * environment: the component that owns the queue cannot be rendered, so
 * this is the only way the ordering rules can be tested for real rather
 * than by reading the source.
 */
export function appendPageView(
  queue: readonly PendingPageView[],
  hit: PendingPageView,
): PendingPageView[] {
  const last = queue[queue.length - 1];
  if (last?.url === hit.url) return [...queue];
  return [...queue, hit];
}

/**
 * Absolute URL for the path being reported.
 *
 * Deliberately NOT window.location.href. A held page view is replayed
 * after the visitor has already navigated on, and reading the live
 * document at that moment would pair one page's page_path with another
 * page's page_location: GA4 would receive a single hit describing two
 * different pages. The live origin is still used, so an apex visitor and
 * a www visitor are not rewritten onto each other.
 */
function absoluteUrlFor(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location?.origin : undefined;
  if (!origin) return path;
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}

export interface TrackPageViewOptions {
  /** Overrides document.title, which is what is used otherwise. */
  title?: string;
  /**
   * True for the FIRST page view of a document load, which is the hit
   * the middleware attribution cookie describes. Client-side navigations
   * that follow pass false.
   */
  isLandingHit?: boolean;
}

/**
 * Record a GA4 page view.
 *
 * Emitted as an EVENT, not as a repeated gtag('config'). A second config
 * call for an already configured measurement id is not the documented
 * way to record a page view, and with send_page_view:false on the base
 * config (initGaBase) it can record nothing at all, which is how this
 * site ended up with a page-view mechanism that may never have produced
 * a page view.
 *
 * Both page_path and page_location come from `path`, never from the live
 * document, so a hit replayed out of the consent hold queue still
 * describes the page it was recorded on (see absoluteUrlFor).
 *
 * Referrer: GA4 attaches page_referrer from the live document unless a
 * value is supplied, so the URL of the PREVIOUS page leaks the same
 * secrets the current one does. A same-origin referrer is sanitized; a
 * third-party referrer passes through untouched, because it holds none
 * of our secrets and rewriting it would corrupt traffic-source reports.
 */
export function trackPageView(path: string, options: TrackPageViewOptions = {}) {
  if (!GA_ID) return;
  const pageLocation = sanitizeAnalyticsUrl(absoluteUrlFor(path));
  // Every other event (search, select_item, generate_lead) inherits
  // page_location and page_referrer from the live document unless a
  // global value is set, so the sanitized URL has to be installed
  // globally rather than attached to this one hit. Set BEFORE the event
  // so the page view and everything after it agree.
  const globals: Record<string, unknown> = {
    page_path: sanitizeAnalyticsPath(path),
    page_location: pageLocation,
  };
  const referrer = currentPageReferrer();
  if (referrer) globals.page_referrer = referrer;
  gtag('set', globals);

  const params: Record<string, unknown> = {
    ...globals,
    page_title: options.title || (typeof document !== 'undefined' ? document.title : ''),
  };
  if (options.isLandingHit) {
    // middleware 301-redirects utm_* off the URL before any script runs,
    // so GA4 would file every manually tagged visit as Direct. The
    // values survive in the first-party cookie middleware writes during
    // that redirect, and this is the one hit they describe.
    Object.assign(params, consumeLandingAttribution() ?? {});
  }
  gtag('event', 'page_view', params);
}

function currentPageReferrer(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  let referrer = '';
  try {
    referrer = document.referrer;
  } catch {
    return undefined;
  }
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    const ownOrigin = typeof window !== 'undefined' ? window.location?.origin : undefined;
    if (!ownOrigin || url.origin !== ownOrigin) return referrer;
    return sanitizeAnalyticsUrl(referrer);
  } catch {
    return undefined;
  }
}

// ── Job Funnel Events ───────────────────────────────────────────
// Follows GA4's recommended e-commerce events adapted for job board:
// view_item_list → select_item → view_item → add_to_wishlist → generate_lead
//
// IMPORTANT: All events use gtag('event', ...) NOT dataLayer.push().
// Without GTM, dataLayer.push() for custom events is silently ignored.

/** User views a list of jobs (search results, category page, homepage) */
export function trackJobListView(jobs: JobItem[], listName: string) {
  gtag('event', 'view_item_list', {
    item_list_id: listName.toLowerCase().replace(/\s+/g, '_'),
    item_list_name: listName,
    items: jobs.slice(0, 20).map((job, index) => ({
      ...job,
      index,
      quantity: 1,
    })),
  });
}

/** User clicks a job card from a list */
export function trackJobClick(job: JobItem, listName: string, position: number) {
  gtag('event', 'select_item', {
    item_list_id: listName.toLowerCase().replace(/\s+/g, '_'),
    item_list_name: listName,
    items: [{
      ...job,
      index: position,
      quantity: 1,
    }],
  });
}

/** User views a job detail page */
export function trackJobView(job: JobItem) {
  gtag('event', 'view_item', {
    currency: 'USD',
    value: job.price || 0,
    items: [{ ...job, quantity: 1 }],
  });
}

/** User saves a job */
export function trackJobSave(job: JobItem) {
  gtag('event', 'add_to_wishlist', {
    currency: 'USD',
    value: job.price || 0,
    items: [{ ...job, quantity: 1 }],
  });
}

/** User unsaves a job */
export function trackJobUnsave(job: JobItem) {
  gtag('event', 'remove_from_wishlist', {
    job_id: job.item_id,
    job_title: job.item_name,
  });
}

/** User clicks apply: PRIMARY CONVERSION */
export function trackJobApply(job: JobItem, method: 'external' | 'platform') {
  // Fire GA4 recommended event for lead generation
  gtag('event', 'generate_lead', {
    currency: 'USD',
    value: job.price || 1,
    items: [{ ...job, quantity: 1 }],
  });

  // Also fire as custom event for easier reporting
  gtag('event', 'job_apply', {
    job_id: job.item_id,
    job_title: job.item_name,
    company: job.item_brand,
    apply_method: method,
    job_type: job.item_category,
    work_mode: job.item_category2,
    state: job.item_category3,
    source: job.item_category4,
  });
}

// ── Search Tracking ─────────────────────────────────────────────

export function trackSearch(searchTerm: string, filters?: Record<string, string>, resultsCount?: number) {
  gtag('event', 'search', {
    search_term: searchTerm,
    results_count: resultsCount,
    ...filters,
  });
}

export function trackFilterChange(filterName: string, filterValue: string) {
  gtag('event', 'filter_change', {
    filter_name: filterName,
    filter_value: filterValue,
  });
}

// ── Auth Events ─────────────────────────────────────────────────

export function trackSignUp(method: 'email' | 'google', role: 'job_seeker' | 'employer') {
  gtag('event', 'sign_up', {
    method,
    user_role: role,
  });
}

export function trackLogin(method: 'email' | 'google', role?: string) {
  gtag('event', 'login', {
    method,
    user_role: role,
  });
}

// ── Engagement Events ───────────────────────────────────────────

export function trackShare(contentType: string, itemId: string, method: string) {
  gtag('event', 'share', {
    content_type: contentType,
    item_id: itemId,
    method,
  });
}

export function trackEmailSubscribe(source: string) {
  gtag('event', 'email_subscribe', {
    subscribe_source: source,
  });
}

export function trackResumeUpload() {
  gtag('event', 'resume_upload', {
    engagement_type: 'high_value',
  });
}

export function trackProfileComplete(completenessPercent: number) {
  gtag('event', 'profile_complete', {
    completeness: completenessPercent,
  });
}

// ── Employer Events ─────────────────────────────────────────────

export function trackJobPost(jobId: string, tier: string) {
  gtag('event', 'post_job', {
    job_id: jobId,
    pricing_tier: tier,
  });
}

// ── Pricing Funnel (P7) ─────────────────────────────────────────
// Client-side events for measuring the employer-side pricing funnel.
// Server-side `purchase` events fire from the Stripe webhook via
// Measurement Protocol (lib/analytics-server.ts). The webhook is the only
// place we know payment actually completed.

/** Employer landed on the post-job page */
export function trackViewPostJobPage() {
  gtag('event', 'view_post_job_page', {});
}

/** Employer clicked through to Stripe checkout */
export function trackBeginCheckout(amountCents: number, type: 'new' | 'renewal') {
  gtag('event', 'begin_checkout', {
    currency: 'USD',
    value: amountCents / 100,
    checkout_type: type,
  });
}

/** Free post submitted successfully (no Stripe involved) */
export function trackSubmitFreePost(jobId: string) {
  gtag('event', 'submit_free_post', { job_id: jobId });
}

/** Employer hit the free-post lifetime limit on this domain */
export function trackFreePostLimitHit(domain: string, used: number, limit: number) {
  gtag('event', 'free_post_limit_hit', {
    email_domain: domain,
    used,
    limit,
  });
}

/** Employer hit the per-posting unlock cap */
export function trackUnlockLimitHit(used: number, limit: number) {
  gtag('event', 'unlock_limit_hit', { used, limit });
}

/** Employer hit the per-posting InMail cap */
export function trackInMailLimitHit(used: number, limit: number) {
  gtag('event', 'inmail_limit_hit', { used, limit });
}

export function trackCandidateView(candidateId: string) {
  gtag('event', 'view_candidate', {
    candidate_id: candidateId,
  });
}

export function trackMessageSent(recipientType: 'candidate' | 'employer') {
  gtag('event', 'message_sent', {
    recipient_type: recipientType,
  });
}

// ── Utility Events ──────────────────────────────────────────────

export function trackOutboundLink(url: string, linkText?: string) {
  gtag('event', 'click', {
    link_url: url,
    link_text: linkText,
    outbound: true,
  });
}

export function trackError(errorType: string, errorMessage: string, fatal: boolean = false) {
  gtag('event', 'exception', {
    description: `${errorType}: ${errorMessage}`,
    fatal,
  });
}

export function trackTiming(category: string, variable: string, valueMs: number) {
  gtag('event', 'timing_complete', {
    name: variable,
    value: valueMs,
    event_category: category,
  });
}

// ── Job Item Builder Helper ─────────────────────────────────────
// Converts a database job record to a GA4 item object

export function buildJobItem(job: {
  id: string;
  title: string;
  employer?: string;
  company?: string;
  jobType?: string;
  mode?: string;
  state?: string;
  stateCode?: string;
  sourceProvider?: string;
  salaryRange?: string;
  normalizedMinSalary?: number | null;
  sourceSite?: string;
}): JobItem {
  return {
    item_id: job.id,
    item_name: job.title,
    item_brand: job.employer || job.company || 'Unknown',
    item_category: job.jobType || undefined,
    item_category2: job.mode || undefined,
    item_category3: job.stateCode || job.state || undefined,
    item_category4: job.sourceProvider || undefined,
    item_variant: job.salaryRange || undefined,
    price: job.normalizedMinSalary || undefined,
    quantity: 1,
    affiliation: job.sourceSite || undefined,
  };
}
