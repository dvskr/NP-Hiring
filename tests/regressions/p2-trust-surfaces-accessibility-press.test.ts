/**
 * Regression guards for content audit P2 #9 — the /accessibility and /press
 * trust pages.
 *
 * These two pages exist to be trusted, which makes them the easiest pages on
 * the site to quietly turn into marketing. The guards below pin the three
 * properties that make them worth publishing at all:
 *
 *   1. /accessibility states a PARTIAL conformance posture and keeps a
 *      known-gaps list. A future edit that deletes the gaps (or upgrades the
 *      page to claim full WCAG conformance) fails here.
 *   2. /press derives every statistic from lib/stats-sources.ts and every
 *      practice-authority count from lib/state-practice-authority.ts — no
 *      hardcoded figures, and the live-inventory block degrades to OMITTED
 *      rather than to a fallback constant.
 *   3. Neither page invents people, quotes, publications, or assets: the
 *      brand-asset links resolve to files that actually exist in public/.
 *
 * Static source assertions, matching the repo's existing pin pattern
 * (tests/regressions/testimonials-read-path.test.ts) — the vitest env is
 * node-only, so there is no harness to mount a server component in.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const a11yPage = read('app/accessibility/page.tsx');
const pressPage = read('app/press/page.tsx');
const testimonialsPage = read('app/testimonials/page.tsx');

/**
 * Strip comments. The "must NOT contain" assertions run against this, because
 * the pages' own doc comments quote the tokens and claims they explain the
 * absence of — a comment naming a banned string must not trip the guard that
 * keeps it banned.
 */
const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every .tsx under app/ and components/, so the audits below are exhaustive. */
function walkTsx(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walkTsx(rel, out);
        else if (entry.name.endsWith('.tsx')) out.push(rel);
    }
    return out;
}
const ALL_TSX = [...walkTsx('app'), ...walkTsx('components')];

/** Files that actually render a dialog surface (excluding the statement itself). */
const DIALOG_FILES = ALL_TSX.filter(
    (f) => f !== 'app/accessibility/page.tsx' && /role="dialog"/.test(read(f)),
);

/** WCAG 2.x sRGB relative-luminance contrast, so colour claims are computed. */
const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => channel(v / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}

/** The two backgrounds the trust pages actually paint text on. */
const TRUST_SURFACES = ['#FFFFFF', '#F5F0EB'];
const AA_NORMAL_TEXT = 4.5;

/**
 * The /press download entries, parsed once. Guarded three ways below: the
 * file exists, no two entries are the same bytes, and the stated dimensions
 * match the PNG header.
 */
const brandAssets = [
    ...pressPage
        .slice(
            pressPage.indexOf('const BRAND_ASSETS'),
            pressPage.indexOf('export default async function PressPage'),
        )
        .matchAll(/\{ href: '([^']+)', label: '([^']+)', detail: '([^']+)' \}/g),
].map((m) => ({ href: m[1], label: m[2], detail: m[3] }));

describe('P2 #9 — /accessibility exists and is honest about conformance', () => {
    it('is a static server page (no client bundle for a policy document)', () => {
        expect(exists('app/accessibility/page.tsx')).toBe(true);
        expect(a11yPage).not.toContain("'use client'");
    });

    it('claims PARTIAL conformance and explicitly disclaims certification', () => {
        expect(a11yPage).toContain('Conformance status: partial');
        expect(a11yPage).toMatch(/do <em>not<\/em> claim to fully meet it/);
        // No VPAT, no third-party audit — both stated, not implied.
        expect(a11yPage).toContain('VPAT');
        expect(a11yPage).toContain('self-assessment');
    });

    it('keeps a non-empty known-gaps list with impact and remediation for each', () => {
        expect(a11yPage).toContain('const KNOWN_GAPS');
        const block = a11yPage.slice(
            a11yPage.indexOf('const KNOWN_GAPS'),
            a11yPage.indexOf('export default function AccessibilityPage'),
        );
        // Every gap entry carries all three fields — a gap without an impact
        // statement or a plan is just an apology. Counting the literal-valued
        // keys skips the type annotation on the const itself.
        const gapCount = (block.match(/gap: '/g) || []).length;
        expect(gapCount).toBeGreaterThanOrEqual(4);
        expect((block.match(/impact:\s*'/g) || []).length).toBe(gapCount);
        expect((block.match(/plan:\s*'/g) || []).length).toBe(gapCount);
    });

    it('names the specific gaps that were verified against the codebase', () => {
        // Contrast, un-announced status messages, untagged PDF, and
        // employer-authored markup were each confirmed in the source.
        expect(a11yPage).toContain('Low-contrast secondary text');
        expect(a11yPage).toContain('Status messages are not announced');
        expect(a11yPage).toContain('not tagged');
        expect(a11yPage).toContain('Employer-authored job descriptions');
    });

    it('gives a reporting route with a response commitment and an alternative', () => {
        expect(a11yPage).toContain('brand.email.contact');
        expect(a11yPage).toContain('five business days');
        // An accessibility statement without an equal-access fallback is
        // incomplete — pin the promise to provide the info another way.
        expect(a11yPage).toMatch(/another way/);
    });

    it('never claims focus management the codebase does not implement', () => {
        // The page previously asserted "Every dialog on the site … uses one
        // shared focus-trap hook". It was false: most role="dialog" surfaces
        // have no focus containment and no focus restore. A page whose whole
        // premise is refusing unearned conformance claims cannot carry one.
        const trapped = DIALOG_FILES.filter((f) => read(f).includes('useFocusTrap'));
        const untrapped = DIALOG_FILES.filter((f) => !read(f).includes('useFocusTrap'));

        expect(DIALOG_FILES.length).toBeGreaterThan(0);
        expect(code(a11yPage)).not.toMatch(/Every dialog on the site/);

        // Self-maintaining in both directions: while ANY dialog is untrapped
        // the gap must be published; once every dialog is migrated onto the
        // hook, the gap entry must be deleted in that same change.
        if (untrapped.length > 0) {
            expect(a11yPage).toContain('Focus is not trapped in every dialog.');
        } else {
            expect(a11yPage).not.toContain('Focus is not trapped in every dialog.');
        }

        // The shipped-controls entry says "The five dialogs". If a sixth file
        // adopts the hook (or one drops it), this fails and forces the copy to
        // be re-verified rather than silently drifting again.
        expect(trapped.length, `files importing useFocusTrap: ${trapped.join(', ')}`).toBe(5);
        expect(a11yPage).toContain('The five dialogs in the search-and-apply path');
    });

    it('scopes the aria-modal claim to the dialogs that actually carry it', () => {
        const missing = DIALOG_FILES.filter((f) => !read(f).includes('aria-modal'));
        // Exactly one exception today — the cookie banner — and the page names
        // it rather than papering over it with "Dialogs carry … aria-modal".
        expect(missing).toEqual(['components/CookieConsent.tsx']);
        expect(a11yPage).toContain('every one except the cookie banner also carries aria-modal');
    });

    it('never claims reduced-motion support the JS-animated components lack', () => {
        // app/globals.css gates the CSS animations and says in its own comment
        // that it cannot reach framer-motion: "JS-driven and cannot be gated
        // from CSS; components using it must check the media query
        // themselves." The page nonetheless claimed "the JavaScript-driven
        // animations render straight to their resting state instead of
        // moving" — false for every importer that never calls
        // useReducedMotion(). Unlike the focus-trap and aria-modal claims this
        // one had no computed guard, so it drifted unchecked.
        const globals = read('app/globals.css');
        expect(globals).toContain('cannot be gated from CSS');

        const importers = ALL_TSX.filter((f) => /from 'framer-motion'/.test(read(f)));
        const gated = importers.filter((f) => read(f).includes('useReducedMotion'));
        const ungated = importers.filter((f) => !read(f).includes('useReducedMotion'));

        expect(importers.length).toBeGreaterThan(0);
        expect(code(a11yPage)).not.toMatch(
            /the JavaScript-driven animations render straight to their resting state/,
        );

        // There is no global escape hatch. If <MotionConfig reducedMotion="user">
        // is ever added, this fails and the copy can be broadened back in the
        // same change rather than being broadened on an assumption.
        // Comment-stripped: the statement's own doc comment names the component
        // it is recording the ABSENCE of, and must not satisfy the search for it.
        expect(ALL_TSX.filter((f) => code(read(f)).includes('MotionConfig'))).toEqual([]);

        // Self-maintaining in both directions, like the focus-trap guard above:
        // while ANY importer is ungated the gap must be published; once every
        // one checks the preference, the gap entry must go in that same change.
        if (ungated.length > 0) {
            expect(a11yPage).toContain('JavaScript-driven animations ignore reduced motion.');
        } else {
            expect(a11yPage).not.toContain('JavaScript-driven animations ignore reduced motion.');
        }

        // The copy states both counts. If either moves, this fails and forces
        // the claim to be re-verified instead of silently going stale.
        expect(gated.length, `gated: ${gated.join(', ')}`).toBe(3);
        expect(ungated.length, `ungated: ${ungated.join(', ')}`).toBe(2);
        expect(a11yPage).toContain('Three of the JavaScript-animated sections');
        expect(a11yPage).toContain('Two JavaScript-driven animations ignore reduced motion.');
    });

    it('carries a review date and canonical metadata, and links the sibling policies', () => {
        expect(a11yPage).toContain('ACCESSIBILITY_LAST_REVIEWED');
        expect(a11yPage).toMatch(/ACCESSIBILITY_LAST_REVIEWED = '\d{4}-\d{2}-\d{2}'/);
        expect(a11yPage).toContain('/accessibility`');
        expect(a11yPage).toContain('/editorial-policy');
    });
});

describe('P2 #9 — /press derives its numbers instead of stating them', () => {
    it('exists as a server page and pulls stats from the audited source file', () => {
        expect(exists('app/press/page.tsx')).toBe(true);
        expect(pressPage).not.toContain("'use client'");
        expect(pressPage).toContain("from '@/lib/stats-sources'");
        expect(pressPage).toContain('STAT_SOURCES.averageSalary');
        expect(pressPage).toContain('STAT_SOURCES.blsGrowth2034');
        expect(pressPage).toContain('STAT_SOURCES.hrsaShortagePopulation');
        expect(pressPage).toContain('STAT_SOURCES.fullPracticeStates');
        expect(pressPage).toContain('STATS_LAST_REVIEWED');
    });

    it('computes practice-authority counts from the dataset, never as literals', () => {
        expect(pressPage).toContain("getStatesByAuthority('full').length");
        expect(pressPage).toContain("getStatesByAuthority('reduced').length");
        expect(pressPage).toContain("getStatesByAuthority('restricted').length");
    });

    it('has no hardcoded salary / growth / shortage figures in its copy', () => {
        // A bare "$129,210", "45%", "27 states", or "90 million" typed into
        // this page would be a second source of truth. Values must render
        // from STAT_SOURCES.
        expect(pressPage).not.toMatch(/\$1[0-9]{2},[0-9]{3}/);
        expect(pressPage).not.toMatch(/\b\d{2}\s?million\+?/i);
        expect(pressPage).not.toMatch(/\b27 states\b/);
    });

    it('omits the live-inventory block rather than rendering a fallback number', () => {
        expect(pressPage).toContain('async function getInventorySnapshot');
        // Failure path returns null…
        const fn = pressPage.slice(
            pressPage.indexOf('async function getInventorySnapshot'),
            pressPage.indexOf('const BRAND_ASSETS'),
        );
        expect(fn).toContain('catch (error)');
        expect(fn).toContain('return null;');
        // …and the section is conditional on that value.
        expect(pressPage).toContain('{inventory && (');
        // Counted with the canonical countable-inventory predicate (live
        // review 2026-08-17 item #4: activeIndexableJobWhere composed with
        // GLOBAL_EXCLUSIONS via lib/canonical-counts.ts) — strictly tighter
        // than the sitemap filter alone, never looser.
        expect(pressPage).toContain('canonicalActiveJobWhere()');
        expect(pressPage).toContain('canonicalEmployerWhere()');
    });

    it('labels board aggregates as board-specific, not as market data', () => {
        // JSX prose wraps across lines, so match on collapsed whitespace.
        expect(pressPage).toMatch(/not\s+a\s+market\s+estimate/);
        expect(pressPage).toMatch(/not\s+a\s+wage\s+survey/);
    });

    it('escapes its JSON-LD with the repo pattern', () => {
        expect(pressPage).toContain("replace(/</g, '\\\\u003c')");
        expect(pressPage).toContain("replace(/>/g, '\\\\u003e')");
    });

    it('offers only brand assets that actually exist on disk', () => {
        expect(brandAssets.length).toBeGreaterThan(0);
        for (const { href } of brandAssets) {
            expect(exists(path.join('public', href)), href).toBe(true);
        }
    });

    it('offers no two assets that are the same file under different names', () => {
        // /logo-cropped.png shipped here as a second, distinct mark described
        // as having a "tighter bounding box". It was byte-identical to
        // /logo.png (sha1 423968c4…), so a design desk downloading the
        // "cropped" version received the identical image. The existence check
        // above passes for a real file with a false description, which is why
        // the bytes have to be compared and not just the path.
        const seen = new Map<string, string>();
        for (const { href } of brandAssets) {
            const hash = crypto
                .createHash('sha1')
                .update(fs.readFileSync(path.join(ROOT, 'public', href)))
                .digest('hex');
            expect(seen.get(hash), `${href} is byte-identical to ${seen.get(hash)}`).toBeUndefined();
            seen.set(hash, href);
        }
    });

    it('states each asset’s real pixel dimensions, read from the PNG header', () => {
        // The description is the only thing a downloader sees before clicking.
        // IHDR puts width at byte 16 and height at byte 20, big-endian.
        let checked = 0;
        for (const { href, detail } of brandAssets) {
            const dims = detail.match(/(\d+)\s*×\s*(\d+)/);
            if (!dims) continue;
            const buf = fs.readFileSync(path.join(ROOT, 'public', href));
            expect(buf.subarray(1, 4).toString('ascii'), href).toBe('PNG');
            expect(buf.readUInt32BE(16), `${href} width`).toBe(Number(dims[1]));
            expect(buf.readUInt32BE(20), `${href} height`).toBe(Number(dims[2]));
            checked++;
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('routes media to the press inbox and links the editorial policy', () => {
        expect(pressPage).toContain('brand.email.press');
        expect(pressPage).toContain('/editorial-policy');
        expect(pressPage).toContain('/accessibility');
    });

    it('invents no coverage: no publication names, no "as seen in" strip', () => {
        // Skip the file's own header comment, which explains the absence.
        const body = pressPage.slice(pressPage.indexOf("import { Metadata }"));
        expect(body).not.toMatch(/as seen in/i);
        expect(body).not.toMatch(/featured in/i);
    });
});

/**
 * The trust pages publish a contrast complaint. Shipping that complaint in
 * text that fails the very threshold it complains about is self-refuting, so
 * these guards compute the ratios rather than pinning strings.
 *
 * SCOPE NOTE: TRUST_PAGES below covers only the three pages in this file. The
 * same package also added the checkout trust rail and the compact testimonial
 * panel, which fell outside this list and shipped #6B7280 on #F5F0EB (4.269:1)
 * as a result. Those two surfaces are guarded in
 * tests/regressions/p2-trust-surfaces-point-of-sale.test.ts — add new trust
 * surfaces to whichever list matches the file, not to neither.
 */
describe('P2 #9 — the trust pages meet the contrast bar they publish', () => {
    /** The muted tokens /accessibility names in its known-gaps entry. */
    const FAILING_MUTED_TOKENS = ['#B0BEC5', '#A0AEB5', '#94A3B8', '#8A9BA6', '#6B7F8A'];
    const TRUST_PAGES: [string, string][] = [
        ['app/accessibility/page.tsx', a11yPage],
        ['app/press/page.tsx', pressPage],
        ['app/testimonials/page.tsx', testimonialsPage],
    ];

    it('the tokens the gap entry calls failing really do fail AA on white', () => {
        // Validates the page's own claim. If a token is ever darkened
        // site-wide, this fails and the gap text has to be corrected.
        for (const token of FAILING_MUTED_TOKENS) {
            expect(contrast(token, '#FFFFFF'), token).toBeLessThan(AA_NORMAL_TEXT);
        }
    });

    it('uses none of those tokens for its own text', () => {
        for (const [name, src] of TRUST_PAGES) {
            for (const token of FAILING_MUTED_TOKENS) {
                expect(code(src), `${name} / ${token}`).not.toContain(`color: '${token}'`);
            }
        }
    });

    it('declares a MUTED_TEXT token that clears AA on both trust-page surfaces', () => {
        for (const [name, src] of TRUST_PAGES) {
            const match = src.match(/const MUTED_TEXT = '(#[0-9A-Fa-f]{6})'/);
            expect(match, `${name} declares MUTED_TEXT`).not.toBeNull();
            const token = match![1];
            for (const bg of TRUST_SURFACES) {
                expect(contrast(token, bg), `${name}: ${token} on ${bg}`).toBeGreaterThanOrEqual(
                    AA_NORMAL_TEXT,
                );
            }
            // …and it is genuinely muted, not just the body colour reused.
            expect(contrast(token, '#FFFFFF'), name).toBeLessThan(contrast('#4A5568', '#FFFFFF'));
        }
    });
});

/**
 * A page that declares itself indexable and is then linked from nowhere and
 * listed in no sitemap is an orphan — the exact defect P0 #7 fixed for
 * /for-programs. Both new trust pages shipped that way.
 */
describe('P2 #9 — the indexable trust pages are actually discoverable', () => {
    const sitemap = read('app/sitemap.ts');
    const footer = read('components/Footer.tsx');

    it('declares /accessibility and /press indexable', () => {
        expect(a11yPage).toMatch(/robots:\s*\{\s*index:\s*true/);
        expect(pressPage).toMatch(/robots:\s*\{\s*index:\s*true/);
    });

    it('advertises both in the sitemap', () => {
        expect(sitemap).toContain('${baseUrl}/accessibility');
        expect(sitemap).toContain('${baseUrl}/press');
    });

    it('gives both an inbound link from the sitewide footer', () => {
        expect(footer).toContain('href="/accessibility"');
        expect(footer).toContain("href: '/press'");
    });

    it('keeps /testimonials out of the sitemap, because it 404s when empty', () => {
        // The page calls notFound() until a testimonial is consented AND
        // featured. Submitting it would advertise a URL that 404s on an
        // empty board — worse than not advertising it at all.
        expect(testimonialsPage).toContain('notFound()');
        expect(code(sitemap)).not.toContain('${baseUrl}/testimonials');
    });
});
