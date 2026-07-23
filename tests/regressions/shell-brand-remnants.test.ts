/**
 * Regression guards for F2 (shell package): donor-brand "PMHNP" copy on
 * live user-facing shell surfaces. Every brand/niche identity string on
 * these surfaces must derive from config/brand.ts tokens:
 *
 *   - middleware styled 410/gone pages (logo text, CTA, tab titles)
 *   - push cron notification title
 *   - public/push-sw.js fallback title/body (static asset — hardcodes the
 *     CURRENT brand, tracked by the ratchets for future forks)
 *   - weekly recommendation digest email header
 *   - OG image fallback text + default company param
 *
 * The scan is case-sensitive on "PMHNP": internal cookie names such as
 * `pmhnp_consent_region` are lowercase functional identifiers, not
 * user-visible copy, and are deliberately allowed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SURFACES = [
  'middleware.ts',
  'public/push-sw.js',
  'app/api/cron/push-notifications/route.ts',
  'lib/inngest/functions/recommendation-digest.ts',
  'app/api/og/route.tsx',
];

describe('F2 — no donor-brand copy on shell surfaces', () => {
  it.each(SURFACES)('%s contains no uppercase PMHNP copy', (rel) => {
    const src = read(rel);
    const hits = src.match(/PMHNP/g) ?? [];
    expect(hits, `${rel} still contains donor-niche copy`).toEqual([]);
  });

  it('middleware 410 pages derive branding from config/brand.ts', () => {
    const mw = read('middleware.ts');
    expect(mw).toContain('${opts.badge} — ${brand.name}');
    expect(mw).toContain('Browse all ${safe(brand.niche.short)} jobs');
    // Donor-specialty copy on the telehealth quick-card is gone.
    expect(mw).not.toContain('Virtual psychiatric care');
  });

  it('push cron titles the notification with the brand niche token', () => {
    const src = read('app/api/cron/push-notifications/route.ts');
    expect(src).toContain('New ${brand.niche.short} Job');
  });

  it('weekly digest header uses brand.name', () => {
    const src = read('lib/inngest/functions/recommendation-digest.ts');
    expect(src).toContain('${escapeHtml(brand.name)} · Weekly Digest');
  });

  it('OG route falls back to brand.name (default company + logo fallback)', () => {
    const src = read('app/api/og/route.tsx');
    expect(src).toContain("searchParams.get('company') || brand.name");
    // The wordmark fallback (rendered only when fetching /logo.png fails)
    // and the img alt text both derive from config.
    expect(src).toContain('{brand.name}');
    expect(src).toContain('alt={brand.name}');
  });
});
