/**
 * P6 #11 — metadata layouts for the six noindexed utility pages
 * (content-fill package).
 *
 * saved, my-applications, success, email-preferences, auth/confirm, and
 * jobs/edit/[token] are all client components ('use client') that cannot
 * export metadata, so they shipped the generic root-layout title. The
 * repo's documented remediation (app/data-request/layout.tsx,
 * app/settings/layout.tsx, app/unsubscribe/layout.tsx) is a metadata-only
 * layout per route. Pins:
 *
 *   1. Each route has a layout exporting metadata with a branded title and
 *      a description.
 *   2. Every one stays noindexed — per-page robots { index: false,
 *      follow: false } matching middleware's X-Robots-Tag guard (the
 *      belt-and-suspenders pattern the auth surfaces use).
 *   3. Token-bearing routes (success / email-preferences / auth/confirm /
 *      jobs/edit/[token]) claim NO canonical; the stable account routes
 *      (saved / my-applications) do, so inbound link variants don't
 *      splinter.
 *   4. The underlying pages remain client components — the reason the
 *      layout pattern applies. If a page gains its own metadata export,
 *      its layout entry here should be retired, not duplicated.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

interface UtilityRoute {
    layout: string;
    page: string;
    /** Stable routes canonicalize; token-bearing routes must not. */
    hasCanonical: boolean;
}

const ROUTES: readonly UtilityRoute[] = [
    { layout: 'app/saved/layout.tsx', page: 'app/saved/page.tsx', hasCanonical: true },
    { layout: 'app/my-applications/layout.tsx', page: 'app/my-applications/page.tsx', hasCanonical: true },
    { layout: 'app/success/layout.tsx', page: 'app/success/page.tsx', hasCanonical: false },
    { layout: 'app/email-preferences/layout.tsx', page: 'app/email-preferences/page.tsx', hasCanonical: false },
    { layout: 'app/auth/confirm/layout.tsx', page: 'app/auth/confirm/page.tsx', hasCanonical: false },
    { layout: 'app/jobs/edit/[token]/layout.tsx', page: 'app/jobs/edit/[token]/page.tsx', hasCanonical: false },
];

describe.each(ROUTES)('P6 #11 — $layout', ({ layout, page, hasCanonical }) => {
    const src = read(layout);

    it('exports metadata with a branded title and a description', () => {
        expect(src).toContain('export const metadata: Metadata');
        // Title interpolates the brand name — never a hardcoded board name
        // and never the bare root-layout default.
        expect(src).toMatch(/title: `[^`]*\$\{brand\.name\}`/);
        expect(src).toMatch(/description: `[^`]+`/);
    });

    it('stays noindexed (per-page robots matching the middleware guard)', () => {
        expect(src).toContain('robots: { index: false, follow: false }');
    });

    it(hasCanonical ? 'canonicalizes its stable URL' : 'claims no canonical (token-bearing URL)', () => {
        // Checked via the `alternates` metadata key — the docblocks of the
        // token-bearing layouts NAME the no-canonical rule, so a bare
        // "canonical" substring check would trip on comments.
        if (hasCanonical) {
            expect(src).toContain('alternates');
            expect(src).toContain('canonical:');
        } else {
            expect(src).not.toContain('alternates');
        }
    });

    it('is a pass-through layout (renders children only)', () => {
        expect(src).toMatch(/return children;/);
    });

    it('covers a page that is still a client component', () => {
        const pageSrc = read(page);
        expect(pageSrc.slice(0, 200)).toMatch(/^'use client'/);
    });
});
