/**
 * GA4 browser-tag correctness (package GA-CORE).
 *
 * Context: GA4 has never actually reported from this site. The
 * measurement id is a build-time inlined variable and it is empty in
 * production, so gtag.js never loads. Everything below therefore pins
 * behavior for the moment the owner fills the id in, which is exactly
 * when a silent defect becomes an unrepairable hole in the data.
 *
 * Five defects these tests exist to keep fixed:
 *   1. page views were emitted as a repeated gtag('config') against an
 *      already configured measurement id while the base config set
 *      send_page_view:false, which is not how GA4 records a page view.
 *   2. the tracked URL was built from the raw pathname plus the whole
 *      query string, so magic-link tokens and Stripe session ids were
 *      sent to Google and shown in GA4 page reports.
 *   3. middleware strips utm_* with a 301 before any script runs, so
 *      every manually tagged visit was filed as Direct even though the
 *      values survive in a readable first-party cookie.
 *   4. the only environment gate was NODE_ENV, which is 'production' on
 *      Vercel preview builds too.
 *   5. holding the first hit for Consent Mode is right, but the hold
 *      DISCARDED any page view that happened while consent was still
 *      unsettled, so a visitor redirected out of a guarded route lost
 *      the entrance page and the rescued campaign moved onto the wrong
 *      page.
 *
 * Runs in the vitest 'node' environment (no jsdom in this repo), so the
 * browser globals lib/analytics reads are faked per test, the same way
 * tests/regressions/shell-isr-static-layout.test.ts does it. Component
 * wiring, which cannot be rendered without a DOM, is pinned by reading
 * the source (repo style, see audit-highs-static.test.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ORIGIN = 'https://nphiring.com';

interface FakeBrowser {
  href?: string;
  cookie?: string;
  referrer?: string;
}

/**
 * GA_ID is captured at module scope, so the env stub and the fake
 * browser globals must both be in place BEFORE a fresh import.
 */
async function loadAnalytics(fake: FakeBrowser = {}) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TESTGA401');
  const href = fake.href ?? `${ORIGIN}/jobs`;
  const url = new URL(href);
  const calls: unknown[][] = [];
  (globalThis as Record<string, unknown>).window = {
    location: {
      href,
      pathname: url.pathname,
      host: url.host,
      origin: url.origin,
    },
    dataLayer: [],
    gtag: (...args: unknown[]) => { calls.push(args); },
  };
  (globalThis as Record<string, unknown>).document = {
    title: 'Test page title',
    cookie: fake.cookie ?? '',
    referrer: fake.referrer ?? '',
  };
  const mod = await import('@/lib/analytics');
  return { mod, calls };
}

function pageViewParams(calls: unknown[][]): Record<string, unknown> {
  const event = calls.find((args) => args[0] === 'event' && args[1] === 'page_view');
  expect(event, 'no page_view event was emitted').toBeDefined();
  return event![2] as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
  vi.resetModules();
});

// ── 1. URL sanitizer ────────────────────────────────────────────
describe('GA-CORE: no secret-bearing URL reaches Google', () => {
  // Every route here is on the Disallow list in app/robots.ts precisely
  // because its URL is a credential.
  const PATH_CASES: Array<[label: string, input: string, expected: string]> = [
    ['job edit magic link', '/jobs/edit/7f3c9a2b1d4e5f60', '/jobs/edit/[token]'],
    ['job edit deeper path', '/jobs/edit/7f3c9a2b/preview', '/jobs/edit/[token]'],
    ['job edit with query', '/jobs/edit/7f3c9a2b?saved=1', '/jobs/edit/[token]'],
    ['bare employer dashboard is untouched', '/employer/dashboard', '/employer/dashboard'],
    ['token employer dashboard', '/employer/dashboard/abc123', '/employer/dashboard/[token]'],
    ['unsubscribe token', '/unsubscribe?token=s3cr3t', '/unsubscribe'],
    ['alert unsubscribe token', '/job-alerts/unsubscribe?token=s3cr3t', '/job-alerts/unsubscribe'],
    ['email preferences token', '/email-preferences?token=s3cr3t', '/email-preferences'],
    ['alert manage token and email', '/job-alerts/manage?token=s3cr3t&email=nurse%40example.com', '/job-alerts/manage'],
    ['stripe success session', '/success?session_id=cs_live_a1b2c3&free=1', '/success?free=1'],
    ['stripe success job id', '/success?jobId=abc&session_id=cs_live_a1', '/success'],
    ['password reset hash tokens', '/reset-password#access_token=aaa&refresh_token=bbb', '/reset-password'],
    ['supabase confirm hash tokens', '/auth/confirm#access_token=aaa&type=recovery', '/auth/confirm'],
    ['oauth code', '/auth/callback?code=4%2F0Ab_c', '/auth/callback'],
    ['reset error detail', '/reset-password?error_code=otp_expired&error_description=Email+link', '/reset-password'],
    ['search facets survive', '/jobs?q=nurse&stateCode=CA&page=2', '/jobs?q=nurse&stateCode=CA&page=2'],
    ['facets kept, secrets dropped', '/jobs?q=nurse&token=s3cr3t', '/jobs?q=nurse'],
    ['repeated facet values survive', '/jobs?jobType=full-time&jobType=contract', '/jobs?jobType=full-time&jobType=contract'],
  ];

  it.each(PATH_CASES)('sanitizeAnalyticsPath: %s', async (_label, input, expected) => {
    const { mod } = await loadAnalytics();
    expect(mod.sanitizeAnalyticsPath(input)).toBe(expected);
  });

  it('sanitizeAnalyticsUrl keeps the origin and drops the secrets', async () => {
    const { mod } = await loadAnalytics();
    expect(mod.sanitizeAnalyticsUrl(`${ORIGIN}/success?session_id=cs_live_a1b2c3`))
      .toBe(`${ORIGIN}/success`);
    expect(mod.sanitizeAnalyticsUrl(`${ORIGIN}/jobs/edit/7f3c9a2b?token=x`))
      .toBe(`${ORIGIN}/jobs/edit/[token]`);
    expect(mod.sanitizeAnalyticsUrl(`${ORIGIN}/auth/confirm#access_token=aaa`))
      .toBe(`${ORIGIN}/auth/confirm`);
  });

  it('never returns an empty page_location (gtag would fall back to the raw href)', async () => {
    const { mod } = await loadAnalytics();
    for (const malformed of ['', 'https://[', 'http://%%%']) {
      const result = mod.sanitizeAnalyticsUrl(malformed);
      expect(result.startsWith('http')).toBe(true);
    }
    expect(mod.sanitizeAnalyticsPath('https://[')).toBe('/');
  });

  it('the allowlist holds no parameter that carries a credential or a person', async () => {
    const { mod } = await loadAnalytics();
    for (const forbidden of ['token', 'session_id', 'email', 'code', 'jobId', 'error_description']) {
      expect(mod.ANALYTICS_QUERY_ALLOWLIST.has(forbidden)).toBe(false);
    }
  });
});

// ── 2. page_view is an event, not a second config ───────────────
describe('GA-CORE: page views', () => {
  it('emits gtag event page_view and never a repeat config', async () => {
    const { mod, calls } = await loadAnalytics({ href: `${ORIGIN}/jobs?q=nurse` });
    mod.trackPageView('/jobs?q=nurse');
    expect(calls.some((args) => args[0] === 'config')).toBe(false);
    const params = pageViewParams(calls);
    expect(params.page_path).toBe('/jobs?q=nurse');
    expect(params.page_location).toBe(`${ORIGIN}/jobs?q=nurse`);
    expect(params.page_title).toBe('Test page title');
  });

  it('routes page_path AND page_location through the sanitizer', async () => {
    const { mod, calls } = await loadAnalytics({
      href: `${ORIGIN}/success?session_id=cs_live_a1b2c3`,
    });
    mod.trackPageView('/success?session_id=cs_live_a1b2c3');
    const params = pageViewParams(calls);
    expect(params.page_path).toBe('/success');
    expect(params.page_location).toBe(`${ORIGIN}/success`);
    expect(JSON.stringify(calls)).not.toContain('cs_live_a1b2c3');
  });

  it('installs the sanitized URL globally so later events inherit it', async () => {
    const { mod, calls } = await loadAnalytics({
      href: `${ORIGIN}/jobs/edit/7f3c9a2b`,
    });
    mod.trackPageView('/jobs/edit/7f3c9a2b');
    const set = calls.find((args) => args[0] === 'set');
    expect(set, 'no gtag set call').toBeDefined();
    const globals = set![1] as Record<string, unknown>;
    expect(globals.page_path).toBe('/jobs/edit/[token]');
    expect(globals.page_location).toBe(`${ORIGIN}/jobs/edit/[token]`);
    expect(JSON.stringify(calls)).not.toContain('7f3c9a2b');
  });

  it('sanitizes a same-origin referrer and leaves a third-party one alone', async () => {
    const internal = await loadAnalytics({
      href: `${ORIGIN}/jobs`,
      referrer: `${ORIGIN}/success?session_id=cs_live_a1b2c3`,
    });
    internal.mod.trackPageView('/jobs');
    expect(pageViewParams(internal.calls).page_referrer).toBe(`${ORIGIN}/success`);

    const external = await loadAnalytics({
      href: `${ORIGIN}/jobs`,
      referrer: 'https://www.google.com/search?q=np+jobs',
    });
    external.mod.trackPageView('/jobs');
    expect(pageViewParams(external.calls).page_referrer)
      .toBe('https://www.google.com/search?q=np+jobs');
  });
});

// ── 3. identity never re-configures the target ──────────────────
describe('GA-CORE: setUserId', () => {
  it('uses gtag set, not a second config for the measurement id', async () => {
    const { mod, calls } = await loadAnalytics();
    mod.setUserId('user-123');
    expect(calls.some((args) => args[0] === 'config')).toBe(false);
    const set = calls.find((args) => args[0] === 'set');
    expect(set![1]).toEqual({ user_id: 'user-123' });
  });

  it('clears identity the same way on sign-out', async () => {
    const { mod, calls } = await loadAnalytics();
    mod.setUserId(null);
    expect(calls.some((args) => args[0] === 'config')).toBe(false);
    expect((calls[0][1] as Record<string, unknown>).user_id).toBeNull();
  });
});

// ── 4. campaign attribution rescued from the middleware cookie ──
describe('GA-CORE: landing attribution', () => {
  const cookieFor = (value: unknown, name = 'pmhnp_attribution') =>
    `${name}=${encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value))}`;

  it('reads the cookie name middleware actually writes', async () => {
    const { mod } = await loadAnalytics();
    // The literal cannot live in lib/analytics.ts (niche-copy ratchet),
    // so it is derived there and pinned against middleware.ts here.
    expect(mod.ATTRIBUTION_COOKIE_NAME).toBe('pmhnp_attribution');
    expect(read('middleware.ts')).toContain("'pmhnp_attribution'");
  });

  it('maps the cookie fields onto GA4 manual campaign parameters', async () => {
    const { mod } = await loadAnalytics();
    expect(mod.parseAttributionCookie(
      JSON.stringify({ source: 'widget', campaign: 'pd-ucsf', medium: 'referral' }),
    )).toEqual({
      campaign_source: 'widget',
      campaign_medium: 'referral',
      campaign_name: 'pd-ucsf',
    });
  });

  it('accepts a partial cookie', async () => {
    const { mod } = await loadAnalytics();
    expect(mod.parseAttributionCookie(
      JSON.stringify({ source: 'widget', campaign: null, medium: null }),
    )).toEqual({ campaign_source: 'widget' });
  });

  const MALFORMED: Array<[label: string, raw: string | null]> = [
    ['absent', null],
    ['empty', ''],
    ['not json', 'utm_source=widget'],
    ['truncated json', '{"source":"widget"'],
    ['json array', '[1,2,3]'],
    ['json string', '"widget"'],
    ['json number', '42'],
    ['json null', 'null'],
    ['all fields null', '{"source":null,"campaign":null,"medium":null}'],
    ['nested objects', '{"source":{"a":1},"campaign":["x"]}'],
    ['whitespace-only values', '{"source":"   ","campaign":"\\t"}'],
  ];

  it.each(MALFORMED)('returns null and never throws for %s input', async (_label, raw) => {
    const { mod } = await loadAnalytics();
    expect(() => mod.parseAttributionCookie(raw)).not.toThrow();
    expect(mod.parseAttributionCookie(raw)).toBeNull();
  });

  it('refuses an oversized cookie instead of parsing it', async () => {
    const { mod } = await loadAnalytics();
    const huge = JSON.stringify({ source: 'x'.repeat(5000) });
    expect(mod.parseAttributionCookie(huge)).toBeNull();
  });

  it('clamps a long value to the GA4 parameter limit and strips control characters', async () => {
    const { mod } = await loadAnalytics();
    const parsed = mod.parseAttributionCookie(
      JSON.stringify({ source: 'a'.repeat(400), campaign: 'pd\u0000-\u001Funi' }),
    );
    expect(parsed?.campaign_source).toHaveLength(100);
    expect(parsed?.campaign_name).toBe('pd-uni');
  });

  it('attaches the campaign to the landing hit only', async () => {
    const { mod, calls } = await loadAnalytics({
      cookie: cookieFor({ source: 'widget', campaign: 'pd-ucsf', medium: 'referral' }),
    });

    mod.trackPageView('/jobs', { isLandingHit: true });
    const landing = pageViewParams(calls);
    expect(landing.campaign_source).toBe('widget');
    expect(landing.campaign_medium).toBe('referral');
    expect(landing.campaign_name).toBe('pd-ucsf');

    // A client-side navigation 30 seconds later must not restate it.
    calls.length = 0;
    mod.trackPageView('/jobs/remote', { isLandingHit: false });
    expect(pageViewParams(calls).campaign_source).toBeUndefined();

    // Nor may a caller that wrongly claims to be the landing hit again.
    calls.length = 0;
    mod.trackPageView('/jobs/remote', { isLandingHit: true });
    expect(pageViewParams(calls).campaign_source).toBeUndefined();
  });

  it('sends no campaign when the cookie is hostile or absent', async () => {
    const hostile = await loadAnalytics({ cookie: 'pmhnp_attribution=%7Bnot-json' });
    hostile.mod.trackPageView('/jobs', { isLandingHit: true });
    expect(pageViewParams(hostile.calls).campaign_source).toBeUndefined();

    const absent = await loadAnalytics({ cookie: 'consent_mirror=x' });
    absent.mod.trackPageView('/jobs', { isLandingHit: true });
    expect(pageViewParams(absent.calls).campaign_source).toBeUndefined();
  });
});

// ── 5. deployment gate ──────────────────────────────────────────
describe('GA-CORE: only the production deployment reports', () => {
  const CASES: Array<[label: string, input: Record<string, string>, expected: boolean]> = [
    ['vercel production', { vercelEnv: 'production', nodeEnv: 'production', host: 'nphiring.com' }, true],
    ['vercel production on its deployment URL', { vercelEnv: 'production', nodeEnv: 'production', host: 'np-hiring-abc123.vercel.app' }, true],
    ['vercel preview', { vercelEnv: 'preview', nodeEnv: 'production', host: 'np-hiring-git-feat.vercel.app' }, false],
    ['vercel preview on the apex-looking host', { vercelEnv: 'preview', nodeEnv: 'production', host: 'nphiring.com' }, false],
    ['vercel development', { vercelEnv: 'development', nodeEnv: 'development', host: 'localhost:3000' }, false],
    ['no vercel env, canonical host', { nodeEnv: 'production', host: 'nphiring.com' }, true],
    ['no vercel env, www host', { nodeEnv: 'production', host: 'WWW.NPHIRING.COM' }, true],
    ['no vercel env, preview host', { nodeEnv: 'production', host: 'np-hiring-abc123.vercel.app' }, false],
    ['no vercel env, localhost', { nodeEnv: 'production', host: 'localhost:3000' }, false],
    ['development build', { nodeEnv: 'development', host: 'nphiring.com' }, false],
    ['nothing known', {}, false],
  ];

  it.each(CASES)('%s', async (_label, input, expected) => {
    const { mod } = await loadAnalytics();
    expect(mod.isProductionAnalyticsEnv(input)).toBe(expected);
  });
});

// ── 6. base config keys ─────────────────────────────────────────
describe('GA-CORE: base config', () => {
  it('drops the Universal Analytics leftovers and same-sites the cookie', async () => {
    const { mod, calls } = await loadAnalytics();
    mod.initGaBase();
    const config = calls.find((args) => args[0] === 'config');
    expect(config, 'no base config was queued').toBeDefined();
    const options = config![2] as Record<string, unknown>;
    expect(options.custom_map).toBeUndefined();
    expect(options.anonymize_ip).toBeUndefined();
    expect(options.cookie_flags).toBe('SameSite=Lax;Secure');
    expect(options.send_page_view).toBe(false);
  });

  it('sanitizes the landing URL baked into the base config', async () => {
    const { mod, calls } = await loadAnalytics({
      href: `${ORIGIN}/jobs/edit/7f3c9a2b?token=x`,
    });
    mod.initGaBase();
    const options = calls.find((args) => args[0] === 'config')![2] as Record<string, unknown>;
    expect(options.page_path).toBe('/jobs/edit/[token]');
    expect(options.page_location).toBe(`${ORIGIN}/jobs/edit/[token]`);
  });

  it('keeps the privacy posture exactly as it was', async () => {
    const { mod, calls } = await loadAnalytics();
    mod.initGaBase();
    const options = calls.find((args) => args[0] === 'config')![2] as Record<string, unknown>;
    // Owner decision, not a code cleanup: these override a visitor who
    // accepts marketing in the banner. Pinned so nothing flips them
    // without the decision being made.
    expect(options.allow_google_signals).toBe(false);
    expect(options.allow_ad_personalization_signals).toBe(false);
  });
});

// ── 7. the consent hold queues page views, it does not drop them ─
describe('GA-CORE: page views held while consent resolves', () => {
  it('keeps arrival order and drops only an immediate repeat', async () => {
    const { mod } = await loadAnalytics();
    // Consent settling re-runs the tracker effect for the SAME url that
    // was queued a moment earlier. That repeat is one page view arriving
    // twice, not two page views.
    let queue = mod.appendPageView([], { url: '/messages', title: 'Messages' });
    queue = mod.appendPageView(queue, { url: '/login?next=/messages', title: 'Sign in' });
    queue = mod.appendPageView(queue, { url: '/login?next=/messages', title: 'Sign in' });
    expect(queue.map((hit) => hit.url)).toEqual(['/messages', '/login?next=/messages']);
  });

  it('keeps a genuine return to a page already visited', async () => {
    const { mod } = await loadAnalytics();
    let queue = mod.appendPageView([], { url: '/jobs', title: 'Jobs' });
    queue = mod.appendPageView(queue, { url: '/jobs/remote', title: 'Remote' });
    queue = mod.appendPageView(queue, { url: '/jobs', title: 'Jobs' });
    expect(queue.map((hit) => hit.url)).toEqual(['/jobs', '/jobs/remote', '/jobs']);
  });

  it('never mutates the queue it was handed', async () => {
    const { mod } = await loadAnalytics();
    const queue = [{ url: '/jobs', title: 'Jobs' }];
    mod.appendPageView(queue, { url: '/pricing', title: 'Pricing' });
    mod.appendPageView(queue, { url: '/jobs', title: 'Jobs' });
    expect(queue).toHaveLength(1);
  });

  it('replays every held hit with its own URL, title and the campaign on the first', async () => {
    // The visitor opened a campaign link to /messages, was redirected to
    // /login before the banner decided, and consent resolved only after
    // that. Both pages must still be reported, in that order.
    const { mod, calls } = await loadAnalytics({
      href: `${ORIGIN}/login?next=/messages`,
      cookie: `pmhnp_attribution=${encodeURIComponent(
        JSON.stringify({ source: 'newsletter', medium: 'email', campaign: 'weekly-digest' }),
      )}`,
    });
    const queue = mod.appendPageView(
      mod.appendPageView([], { url: '/messages', title: 'Messages' }),
      { url: '/login?next=/messages', title: 'Sign in' },
    );
    let landingSent = false;
    for (const entry of queue) {
      mod.trackPageView(entry.url, { title: entry.title, isLandingHit: !landingSent });
      landingSent = true;
    }

    const views = calls
      .filter((args) => args[0] === 'event' && args[1] === 'page_view')
      .map((args) => args[2] as Record<string, unknown>);
    expect(views).toHaveLength(2);
    expect(views[0].page_path).toBe('/messages');
    expect(views[0].page_title).toBe('Messages');
    expect(views[0].campaign_source).toBe('newsletter');
    expect(views[0].campaign_name).toBe('weekly-digest');
    // page_location must follow the hit, not the browser: by the time
    // the queue drains the visitor is already sitting on /login.
    expect(views[0].page_location).toBe(`${ORIGIN}/messages`);
    // `next` is not on the allowlist, so it is stripped like any other
    // parameter that was never asked for.
    expect(views[1].page_path).toBe('/login');
    expect(views[1].page_title).toBe('Sign in');
    expect(views[1].page_location).toBe(`${ORIGIN}/login`);
    expect(views[1].campaign_source).toBeUndefined();
  });
});

// ── 8. component wiring (no DOM in this repo's vitest setup) ────
describe('GA-CORE: GoogleAnalytics wiring', () => {
  const src = read('components/GoogleAnalytics.tsx');

  it('gates on the deployment, not on NODE_ENV alone', () => {
    expect(src).toContain('isProductionAnalyticsEnv');
    expect(src).toContain('NEXT_PUBLIC_VERCEL_ENV');
    // The bare NODE_ENV render gate is what let previews report.
    expect(src).not.toMatch(/process\.env\.NODE_ENV !== 'production' \|\| !bootstrapped/);
  });

  it('waits for consent to resolve, with a ceiling and a listener that is removed', () => {
    expect(src).toContain('CONSENT_EVENT');
    expect(src).toMatch(/setTimeout\(\(\) => setConsentSettled\(true\), CONSENT_SETTLE_CEILING_MS\)/);
    expect(src).toMatch(/removeEventListener\(CONSENT_EVENT, onConsentChange\)/);
  });

  it('QUEUES the page view while consent is unsettled instead of returning empty-handed', () => {
    // The regression this exists for: `if (!consentSettled) return;`
    // above the URL capture silently threw away every page view that
    // happened before the banner decided.
    expect(src).not.toMatch(/if \(!consentSettled\) return;/);
    expect(src).toMatch(/if \(!consentSettled\) \{[\s\S]*?appendPageView\(/);
    expect(src).toMatch(/heldViews\.current = \[\];/);
  });

  it('captures the URL before the consent check and the title inside the settle timer', () => {
    const urlBuilt = src.indexOf('const url = pathname');
    const consentCheck = src.indexOf('if (!consentSettled)');
    expect(urlBuilt).toBeGreaterThan(-1);
    expect(consentCheck).toBeGreaterThan(-1);
    // A held hit that did not capture its own URL would be replayed as
    // whatever page the visitor reached later.
    expect(urlBuilt).toBeLessThan(consentCheck);
    expect(src).toMatch(/title: document\.title/);
  });

  it('marks only the first hit of a document load as the landing hit', () => {
    expect(src).toMatch(/isLandingHit: !landingHitSent\.current/);
    expect(src).toMatch(/landingHitSent\.current = true;/);
  });

  it('keeps one page view per navigation, with the timer cleaned up', () => {
    expect(src).toMatch(/return \(\) => clearTimeout\(track\)/);
    // One call site, so the sanitizer choke point cannot be bypassed.
    expect((src.match(/trackPageView\(/g) ?? []).length).toBe(1);
  });
});
