/**
 * P3 #13 — error / 404 / 401 surface polish.
 *
 * Three separate defects were shipped on the error surfaces:
 *
 *  1. app/error.tsx told every user "Our engineers have been securely
 *     notified" while the boundary did nothing but console.error. That was
 *     false: logger.error's Sentry forwarding is server/edge-only
 *     (lib/logger.ts returns early on `typeof window !== 'undefined'`), and
 *     React swallows boundary-caught errors before the browser SDK's global
 *     handlers ever see them. The fix is BOTH halves — capture the error for
 *     real, and stop promising the user something we can't guarantee (a DSN
 *     may not be configured, and "captured" is not "a human was paged").
 *
 *  2. app/unauthorized/page.tsx shipped a placeholder button label,
 *     'Go Config Home', from the template scaffold.
 *
 *  3. app/not-found.tsx is the landing zone for every dead donor URL,
 *     expired job, and stale backlink on the board, and offered no way to
 *     search or browse — two generic buttons and two marketing cards.
 *
 * These are text/structure assertions on source, matching the repo's
 * existing static-guard convention (see aeo-content-*.test.ts).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorBoundary from '@/app/error';
import GlobalError from '@/app/global-error';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Render a boundary to HTML and strip tags, so assertions run against the
 * words a user actually reads rather than against the source that produces
 * them. Both boundaries are client components whose only effect is the Sentry
 * capture; effects do not run under renderToStaticMarkup, so this is inert.
 */
const renderCopy = (
    Component: (props: { error: Error & { digest?: string }; reset: () => void }) => React.JSX.Element,
    digest?: string
): string => {
    const error: Error & { digest?: string } = Object.assign(new Error('boom'), digest ? { digest } : {});
    const html = renderToStaticMarkup(React.createElement(Component, { error, reset: () => {} }));
    return html
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
};

const BOUNDARIES: ReadonlyArray<
    readonly [string, (props: { error: Error & { digest?: string }; reset: () => void }) => React.JSX.Element]
> = [
    ['app/error.tsx', ErrorBoundary],
    ['app/global-error.tsx', GlobalError],
];

describe('P3 #13 — app/error.tsx makes no unbacked notification claim', () => {
    const src = read('app/error.tsx');

    it('does not claim engineers were notified', () => {
        expect(src).not.toMatch(/engineers have been/i);
        expect(src).not.toMatch(/been (securely )?notified/i);
    });

    it('actually reports the error instead of only console.error', () => {
        expect(src).toContain("from '@/lib/sentry'");
        expect(src).toMatch(/captureException\(\s*error/);
        expect(src).not.toContain('console.error');
    });

    it('does not double-report server-origin errors', () => {
        // One failure, one Sentry event — the invariant lib/sentry.ts and
        // instrumentation.ts both enforce. Their mechanism is a marker set on
        // the Error INSTANCE (logger.markSentryCaptured), which cannot survive
        // the server→client hop: Next serializes a redacted copy carrying only
        // `digest`, so a client-side re-capture is a brand-new object the
        // dedupe can never match. `digest` is present only on server-thrown
        // errors, and those already went through
        // instrumentation.ts#onRequestError → captureRequestError.
        expect(src).toMatch(/if\s*\(\s*error\.digest\s*\)\s*return;/);
    });

    it('surfaces the digest so a user can quote it to support', () => {
        expect(src).toContain('error.digest');
        expect(src).toContain('Reference:');
        expect(src).toContain('brand.email.support');
    });

    it('drops the sci-fi copy for plain language', () => {
        for (const phrase of ['System Malfunction', 'Reinitialize Request', 'Abort to Safety', 'Diagnostic Matrix']) {
            expect(src, `sci-fi copy still present: ${phrase}`).not.toContain(phrase);
        }
        expect(src).toContain('Something went wrong');
    });
});

describe('P3 #13 — app/global-error.tsx gets the same treatment', () => {
    const src = read('app/global-error.tsx');

    it('captures the error rather than only logging to the console', () => {
        expect(src).toContain("from '@/lib/sentry'");
        expect(src).toMatch(/captureException\(\s*error/);
        expect(src).not.toContain('console.error');
    });

    it('drops the sci-fi copy and shows the digest', () => {
        for (const phrase of ['Critical Global Failure', 'Restart Engine', 'unrecoverable exception']) {
            expect(src, `sci-fi copy still present: ${phrase}`).not.toContain(phrase);
        }
        expect(src).toContain('error.digest');
        expect(src).toContain('Reference:');
    });

    it('does not double-report server-origin errors either', () => {
        expect(src).toMatch(/if\s*\(\s*error\.digest\s*\)\s*return;/);
    });

    it('names the support address it tells the user to email', () => {
        // "email support" with no address is an instruction the user cannot
        // follow — and this boundary renders when the root layout is gone, so
        // there is no header or footer to find it in.
        expect(src).toContain('brand.email.support');
        expect(src).toMatch(/mailto:\$\{brand\.email\.support\}/);
        expect(src, 'copy still says "email support" without giving one')
            .not.toMatch(/email support\b(?!@)/);
    });
});

describe('P3 #13 — neither boundary can be reached without an address to escalate to', () => {
    it.each(['app/error.tsx', 'app/global-error.tsx'])('%s renders a mailto link', (rel) => {
        expect(read(rel)).toMatch(/href=\{`mailto:\$\{brand\.email\.support\}`\}/);
    });
});

describe('P3 #13 — neither boundary tells the user to quote a reference it did not render', () => {
    // The first cut of this copy said "...and include the reference below"
    // unconditionally while the `Reference: {digest}` block stayed gated on
    // `error.digest`. Next attaches `digest` only to errors thrown during
    // SERVER rendering, so the digest-less case — the client-origin errors
    // this boundary exists to catch, per `if (error.digest) return;` — showed
    // the instruction with nothing to follow it. Same class of unkept promise
    // as the "engineers have been securely notified" line this batch removed.
    //
    // Asserted on rendered output rather than on source: the defect was a
    // mismatch between two independently-gated regions, which only a render
    // can hold to account.

    it.each(BOUNDARIES)('%s: no digest → no reference block AND no mention of one', (_rel, Component) => {
        const copy = renderCopy(Component);
        expect(copy, 'Reference block must not render without a digest').not.toContain('Reference:');
        expect(copy, 'copy points at a reference the page never rendered').not.toMatch(/reference below/i);
        // The sentence must still terminate cleanly once the clause is dropped.
        expect(copy).toMatch(/support@[\w.]+\./);
    });

    it.each(BOUNDARIES)('%s: digest present → reference block AND the instruction', (_rel, Component) => {
        const copy = renderCopy(Component, 'd1g3st42');
        expect(copy).toContain('Reference: d1g3st42');
        expect(copy, 'the identifier renders but nothing tells the user to send it')
            .toMatch(/reference below/i);
    });

    it.each(BOUNDARIES)('%s: the instruction appears iff the identifier does', (_rel, Component) => {
        // The invariant itself, stated once: these two must never disagree.
        for (const digest of [undefined, 'abc123']) {
            const copy = renderCopy(Component, digest);
            expect(
                /reference below/i.test(copy),
                `instruction/identifier disagree for digest=${String(digest)}`
            ).toBe(copy.includes('Reference:'));
        }
    });

    it.each(BOUNDARIES)('%s: still routes the user to support in both states', (_rel, Component) => {
        for (const digest of [undefined, 'abc123']) {
            expect(renderCopy(Component, digest)).toContain('support@');
        }
    });
});

describe('P3 #13 — the digest gate has somewhere to hand server errors off to', () => {
    it('instrumentation.ts forwards App Router server errors to Sentry', () => {
        const src = read('instrumentation.ts');
        expect(src).toContain('export function onRequestError');
        expect(src).toContain('captureRequestError');
    });

    it('the server runtime falls back to the public DSN, so the gate is never a blind spot', () => {
        // Load-bearing premise of `if (error.digest) return;`: if the browser
        // can report, the server can too. Were the server config to require
        // SENTRY_DSN alone, a NEXT_PUBLIC-only deployment would silently lose
        // every server-origin error the boundary now declines to re-capture.
        for (const rel of ['sentry.server.config.ts', 'sentry.edge.config.ts']) {
            expect(read(rel), `${rel} must fall back to NEXT_PUBLIC_SENTRY_DSN`)
                .toMatch(/process\.env\.SENTRY_DSN\s*\|\|\s*process\.env\.NEXT_PUBLIC_SENTRY_DSN/);
        }
    });
});

describe('P3 #13 — app/unauthorized/page.tsx has real copy', () => {
    const src = read('app/unauthorized/page.tsx');

    it('the scaffold placeholder label is gone', () => {
        expect(src).not.toContain('Go Config Home');
    });

    it('offers a recovery path and a way to reach support', () => {
        expect(src).toContain('Back to Homepage');
        expect(src).toContain('href="/contact"');
    });
});

describe('P3 #13 — app/not-found.tsx offers real recovery affordances', () => {
    const src = read('app/not-found.tsx');

    it('renders a labelled, no-JS search form pointed at the /jobs `q` param', () => {
        expect(src).toContain('action="/jobs"');
        expect(src).toContain('method="get"');
        expect(src).toContain('name="q"');
        // The input must be reachable by its label (a11y) — the htmlFor and
        // the input id have to agree.
        expect(src).toContain('htmlFor="notfound-search"');
        expect(src).toContain('id="notfound-search"');
    });

    it('links category, state, and popular-page recovery trails', () => {
        expect(src).toContain('/jobs/state/');
        expect(src).toContain('/jobs/locations');
        expect(src).toContain('/salary-guide');
        expect(src).toContain('/blog');
        expect(src).toContain('/resources');
        expect(src).toContain('/job-alerts');
        expect(src).toContain('/companies');
    });

    it('derives category labels from the taxonomy instead of hardcoding them', () => {
        expect(src).toContain("from '@/lib/pseo/category-faq-data'");
        expect(src).toContain('CATEGORY_LABELS[slug]');
    });

    it('stays DB-free — a 404 is served on unbounded crawler volume', () => {
        expect(src).not.toContain('@/lib/prisma');
        expect(src).not.toContain('getSiteStats');
    });

    it('quotes no inventory or ranking statistic', () => {
        // Omit-not-fabricate: the recovery lists carry no counts and make no
        // "top"/"most popular state" claim, which would be an uncited stat.
        expect(src).not.toMatch(/\d[\d,]*\+ (jobs|listings|openings|positions)/i);
        expect(src).not.toMatch(/top (states|specialties)/i);
    });

    it('claims no COVERAGE for the destinations it links, only names them', () => {
        // The first cut of this page labelled /jobs/locations "All 50 states +
        // DC" in two places. Both halves were false. app/jobs/locations
        // whitelists exactly 50 names and District of Columbia is not among
        // them (its own comment claims "+ DC"); and the rendered grid is
        // `stats.states` — a Prisma groupBy over published jobs run through
        // that whitelist — so it shows only states holding live inventory,
        // never a fixed 50 or 51. A count is an inventory claim about a
        // destination this page cannot see, so the rule is: name the
        // destination, never its size.
        expect(src).not.toMatch(/\ball\s+\d+\s+states?\b/i);
        expect(src).not.toMatch(/states?\s*\+\s*(DC|D\.C\.)/i);
        expect(src).not.toMatch(/\b\d+\s*-\s*states?\b/i);
        expect(src).not.toMatch(/\b(every|all)\s+(US\s+)?states?\b/i);
    });
});

describe('P3 #13 — the 404 does not out-claim the pages it links', () => {
    const src = read('app/not-found.tsx');
    const locations = read('app/jobs/locations/page.tsx');

    it('the /jobs/locations index is DB-derived, so no static count can describe it', () => {
        // Recomputed from the destination rather than asserted from memory:
        // if that page ever switches to rendering the whitelist directly, this
        // test says so and the 404 may quote a number again.
        expect(locations, '/jobs/locations no longer renders a groupBy-derived list')
            .toMatch(/stats\.states\.map/);
        expect(locations).toMatch(/prisma\.job\.groupBy/);
    });

    it('the 404 links the index without describing its contents numerically', () => {
        const pillAndBlurb = [...src.matchAll(/\/jobs\/locations['"][\s\S]{0,200}/g)].join('\n');
        expect(pillAndBlurb, 'the 404 must link /jobs/locations').not.toBe('');
        expect(pillAndBlurb).not.toMatch(/\d+\s*states?/i);
    });
});

describe('P3 #13 — every recovery link on the 404 resolves to a real route', () => {
    const src = read('app/not-found.tsx');

    /** Static hrefs written as string literals in the source. */
    const literalHrefs = [...src.matchAll(/href(?:=|: )['"](\/[^'"?#]*)['"]/g)].map((m) => m[1]);
    /** Category slugs interpolated into `/jobs/${slug}`. */
    const categorySlugs = [...src.matchAll(/^\s{4}'([a-z0-9-]+)',$/gm)].map((m) => m[1]);
    /** State slugs from the STATE_LINKS table. */
    const stateSlugs = [...src.matchAll(/slug: '([a-z-]+)'/g)].map((m) => m[1]);

    it('finds the link tables it is asserting on', () => {
        expect(literalHrefs.length).toBeGreaterThan(8);
        expect(categorySlugs.length).toBeGreaterThan(4);
        expect(stateSlugs.length).toBeGreaterThan(4);
    });

    it.each(['/jobs', '/jobs/locations', '/salary-guide', '/blog', '/resources', '/job-alerts', '/companies', '/post-job', '/for-job-seekers', '/for-employers'])(
        '%s has a route folder',
        (href) => {
            expect(literalHrefs, `${href} is not linked from the 404`).toContain(href);
            const dir = path.join(ROOT, 'app', href.replace(/^\//, ''));
            expect(fs.existsSync(path.join(dir, 'page.tsx')), `no page.tsx at app${href}`).toBe(true);
        }
    );

    it('every category pill points at a real app/jobs/<slug>/ folder', () => {
        for (const slug of categorySlugs) {
            expect(
                fs.existsSync(path.join(ROOT, 'app', 'jobs', slug, 'page.tsx')),
                `404 links /jobs/${slug} but app/jobs/${slug}/page.tsx does not exist`
            ).toBe(true);
        }
    });

    it('state pills use the /jobs/state/[state] slug shape', () => {
        expect(fs.existsSync(path.join(ROOT, 'app', 'jobs', 'state', '[state]', 'page.tsx'))).toBe(true);
        for (const slug of stateSlugs) {
            expect(slug, `state slug "${slug}" is not lowercase-hyphenated`).toMatch(/^[a-z]+(-[a-z]+)*$/);
        }
    });
});
