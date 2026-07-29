/**
 * P3 #12 + #13 — AI-discovery text, security.txt, tab titles, image ladders.
 *
 * P3 #12: public/llms.txt (and its extended sibling) were frozen at a
 * launch-day inventory claim — "335+ active NP job listings" / "335+ active
 * listings at launch" — which is exactly the hardcoded-count pattern the
 * board bans everywhere else (config/niche/copy.ts; see the B5 guard in
 * aeo-content-inventory-claims.test.ts, which explicitly exempted these two
 * files because they were dated "at launch"). They also listed a stale
 * 42-slug taxonomy, so AI systems were told about a category set that no
 * longer matches the registry.
 *
 * The fix is evergreen phrasing plus a live pointer (/feed.xml,
 * /api/sitemaps/index) instead of a number, and this test is the
 * self-updating half: the category list is pinned to the taxonomy registry,
 * so adding a slug without updating llms.txt fails CI. That is the cheap
 * mechanism — a static file that cannot silently drift beats a dynamic route
 * here, because Next.js cannot serve both public/llms.txt and an
 * app/llms.txt route handler for the same path.
 *
 * P3 #13: security.txt's Policy field pointed at /privacy (not a
 * vulnerability-disclosure policy), and /reset-password + /unsubscribe are
 * client components that could not export metadata, so both showed the
 * generic site title in the browser tab.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LLMS_FILES = ['public/llms.txt', 'public/llms-full.txt'] as const;

describe('P3 #12 — llms files carry no frozen inventory claim', () => {
    it.each(LLMS_FILES)('%s drops the launch-day count', (rel) => {
        const src = read(rel);
        expect(src).not.toContain('335+');
        expect(src).not.toMatch(/at launch/i);
        // No bare "<number>+ ... listings/jobs/openings/positions" claim of
        // any size — the whole class, not just the one that went stale.
        expect(src).not.toMatch(/\d[\d,]*\+\s+(active\s+)?(NP\s+)?(job\s+)?(listings|jobs|openings|positions)/i);
    });

    it.each(LLMS_FILES)('%s points AI systems at a live surface instead', (rel) => {
        const src = read(rel);
        expect(src).toContain('/feed.xml');
        expect(src).toContain('/api/sitemaps/index');
    });

    it('llms.txt still states the sourcing + salary honesty policy', () => {
        const src = read('public/llms.txt');
        expect(src).toMatch(/8 ATS sources/);
        expect(src).toMatch(/we do not estimate or fabricate pay/i);
    });
});

describe('P3 #12 — the llms editorial claim does not outrun /editorial-policy', () => {
    // llms-full.txt asserted "Statistics quoted on our pages carry a named
    // source and an as-of date; we omit a number rather than estimate one".
    // That is false against live pages: every category x city page renders an
    // unsourced salary band, and the template's own TODO calls those values
    // estimates. /editorial-policy makes the narrower claim that is actually
    // true — CITED statistics are sourced, and descriptive market context is
    // labelled as the estimate it is. llms-full now matches that wording.

    it('the counter-evidence is still live, so the narrow claim remains the correct one', () => {
        // Self-updating: if the estimate bands are ever replaced with sourced
        // figures, this fails and the broader claim can be reconsidered on
        // purpose rather than reintroduced by accident.
        const tpl = read('lib/pseo/category-city-template.tsx');
        expect(tpl, 'salaryRange values are no longer flagged as estimates — revisit the llms wording')
            .toMatch(/TODO\(content\)[\s\S]{0,400}?estimates/);
        expect(tpl, 'the unsourced band no longer renders in FAQ copy').toMatch(/typical range for/);
    });

    it.each(LLMS_FILES)('%s makes no blanket "we never estimate" claim', (rel) => {
        const src = read(rel);
        expect(src).not.toMatch(/omit a number rather than estimate/i);
        expect(src).not.toMatch(/we (do not|don't|never) estimate(?! or fabricate pay)/i);
        // The overreach was the unqualified universal "Statistics ... carry a
        // named source"; the accurate scope is "Cited statistics".
        expect(src).not.toMatch(/^-\s*Statistics\b/im);
    });

    it('llms-full scopes the claim exactly as /editorial-policy does', () => {
        const src = read('public/llms-full.txt');
        expect(src).toMatch(/Cited statistics on our pages carry a named source and an as-of date/);
        expect(src).toMatch(/labelled as the estimate it is/);
    });

    it('/editorial-policy still carries that wording, so the two cannot drift apart', () => {
        const policy = read('app/editorial-policy/page.tsx');
        expect(policy).toMatch(/named source and an &quot;as of&quot; date/);
        expect(policy).toMatch(/labelled as the estimate it is/);
    });

    it('the job-level salary promise stays scoped to the employer posting', () => {
        // This one IS true and must survive the rewording above.
        expect(read('public/llms.txt')).toMatch(/we do not estimate or fabricate pay for an individual listing/i);
        expect(read('public/llms-full.txt')).toMatch(/reproduced from the employer's posting, never modeled/i);
    });
});

describe('P3 #12 — llms files track the live category taxonomy', () => {
    it('llms.txt lists every registry slug as a /jobs/<slug> link', () => {
        const src = read('public/llms.txt');
        const missing = ALL_CATEGORY_SLUGS.filter((slug) => !src.includes(`/jobs/${slug}`));
        expect(
            missing,
            `public/llms.txt is missing category hubs: ${missing.join(', ')} — add them (or drop the slug from the registry)`
        ).toEqual([]);
    });

    it('llms-full.txt lists every registry slug', () => {
        const src = read('public/llms-full.txt');
        // The extended file lists bare slugs grouped by axis.
        const missing = ALL_CATEGORY_SLUGS.filter((slug) => !new RegExp(`(^|[\\s,])${slug}([\\s,)]|$)`, 'm').test(src));
        expect(
            missing,
            `public/llms-full.txt is missing category hubs: ${missing.join(', ')}`
        ).toEqual([]);
    });

    it('both files quote the registry count rather than a stale one', () => {
        const expected = String(ALL_CATEGORY_SLUGS.length);
        expect(read('public/llms.txt')).toContain(`${expected} category hubs`);
        expect(read('public/llms-full.txt')).toContain(`Category Pages (${expected})`);
    });

    it('every slug advertised to AI systems has a real route folder', () => {
        for (const slug of ALL_CATEGORY_SLUGS) {
            expect(
                fs.existsSync(path.join(ROOT, 'app', 'jobs', slug, 'page.tsx')),
                `llms.txt advertises /jobs/${slug} but app/jobs/${slug}/page.tsx does not exist`
            ).toBe(true);
        }
    });
});

describe('P3 #13 — security.txt names a real disclosure policy', () => {
    const files = ['public/.well-known/security.txt', 'public/security.txt'] as const;

    it.each(files)('%s Policy points at the disclosure page, not the privacy policy', (rel) => {
        const src = read(rel);
        expect(src).toMatch(/^Policy: https:\/\/nphiring\.com\/security$/m);
        expect(src).not.toMatch(/^Policy: .*\/privacy$/m);
    });

    it('the two copies stay identical (RFC 9116 canonical + legacy root)', () => {
        expect(read('public/security.txt')).toBe(read('public/.well-known/security.txt'));
    });

    it('the Policy target is a real page with a vulnerability-reporting section', () => {
        const page = read('app/security/page.tsx');
        expect(page).toContain('Reporting a vulnerability');
    });

    it.each(files)('%s advertises no optional field it cannot back', (rel) => {
        const src = read(rel);
        // Same defect class as the Policy:/privacy mispoint this file just
        // fixed — an RFC 9116 field is a promise about what lives at the URL,
        // and a wrong target wastes a researcher's first click.
        //
        //   Acknowledgments (RFC 9116 §2.5.2) must link a page that RECOGNISES
        //   reporters. /security says only "we acknowledge contributions in
        //   writing" and carries no such list, so there is nothing to link.
        //   Hiring (§2.5.8) must link SECURITY-related job openings. /about
        //   contains no hiring or careers content of any kind.
        //
        // Both are optional; the honest move is to omit them until the page
        // exists, not to point them at the nearest plausible URL.
        expect(src, 'Acknowledgments must name a page that actually recognises reporters')
            .not.toMatch(/^Acknowledgments:/mi);
        expect(src, 'Hiring must name security-related job openings')
            .not.toMatch(/^Hiring:/mi);
    });

    it.each(files)('%s keeps every field it does declare pointed at a real page', (rel) => {
        const src = read(rel);
        const paths = [...src.matchAll(/^(?:Policy|Acknowledgments|Hiring):\s*https:\/\/nphiring\.com(\/[^\s]*)$/gim)]
            .map((m) => m[1]);
        for (const p of paths) {
            expect(
                fs.existsSync(path.join(ROOT, 'app', p.replace(/^\//, ''), 'page.tsx')),
                `security.txt points at ${p} but app${p}/page.tsx does not exist`
            ).toBe(true);
        }
    });

    it('the two copies stay identical after the field removals', () => {
        expect(read('public/security.txt')).toBe(read('public/.well-known/security.txt'));
    });
});

describe('P3 #13 — token-bearing pages have their own tab title', () => {
    const routes = [
        { layout: 'app/reset-password/layout.tsx', title: 'Set a New Password' },
        { layout: 'app/unsubscribe/layout.tsx', title: 'Unsubscribe' },
    ] as const;

    it.each(routes)('$layout sets a specific title', ({ layout, title }) => {
        const src = read(layout);
        expect(src).toContain(`title: \`${title} | \${brand.name}\``);
        // These URLs carry reset/unsubscribe tokens — never indexable.
        expect(src).toContain('robots: { index: false, follow: false }');
    });

    it.each(routes)('$layout does not turn the route into a client component', ({ layout }) => {
        expect(read(layout)).not.toContain("'use client'");
    });
});

describe('P3 #12 — the image ladder ships nothing it has not wired', () => {
    const script = read('scripts/regen-image-ladders.mjs');

    /** Every `{ src: '...', css: N }` REGISTRY row (REGISTRY rows only — the
     *  PENDING_WIRING rows below carry a third `consumer` key). */
    const registry = [...script.matchAll(/\{ src: '([^']+)', css: (\d+) \}/g)].map((m) => ({
        src: m[1],
        css: Number(m[2]),
    }));

    /** Every PENDING_WIRING row: source that has no srcSet consumer yet. */
    const pendingWiring = [...script.matchAll(/\{ src: '([^']+)', css: (\d+), consumer: '([^']+)' \}/g)].map((m) => ({
        src: m[1],
        css: Number(m[2]),
        consumer: m[3],
    }));

    it('tracks the account/dashboard PNGs as pending wiring, not as done', () => {
        // These eleven 1024px masters are still served raw through plain
        // `<img src>` by five components, none of them owned by this batch.
        // Generating their ladders first put 88 files / 436 KB into the repo
        // and the deploy artifact that no browser would ever request — a
        // ladder nobody references is not a speed-up. They stay listed (so the
        // handoff is visible and one command away) but ungenerated.
        const registered = new Set(registry.map((r) => r.src));
        const pending = new Set(pendingWiring.map((r) => r.src));
        for (const name of [
            'clay-stat-saved', 'clay-stat-applied', 'clay-stat-views', 'clay-stat-alerts',
            'empty-applications', 'empty-saved', 'empty-messages',
            'spot-alerts-empty', 'spot-applications', 'spot-saved', 'spot-applied',
        ]) {
            const src = `public/illustrations/${name}.png`;
            expect(pending, `${src} is not tracked in PENDING_WIRING`).toContain(src);
            expect(registered, `${src} is in REGISTRY but its consumer has no srcSet`).not.toContain(src);
        }
        expect(pendingWiring).toHaveLength(11);
    });

    it('every PENDING_WIRING row names a consumer that still serves the raw file', () => {
        // The row is a promise about where the srcSet has to go. If the
        // consumer moved, or already got wired, this catches the stale entry.
        for (const { src, consumer } of pendingWiring) {
            expect(fs.existsSync(path.join(ROOT, src)), `missing source: ${src}`).toBe(true);
            expect(fs.existsSync(path.join(ROOT, consumer)), `missing consumer: ${consumer}`).toBe(true);
            const publicPath = src.replace(/^public/, '');
            expect(
                read(consumer),
                `${consumer} no longer references ${publicPath} — update or retire the PENDING_WIRING row`
            ).toContain(publicPath);
        }
    });

    it('no ladder output is checked in for art that has no srcSet consumer', () => {
        // The actual regression guard: unreferenced -<w>.webp files must not
        // exist on disk. Wiring the component and running the regen in the
        // SAME change is what flips a row from PENDING_WIRING to REGISTRY.
        for (const { src } of pendingWiring) {
            const { dir, name } = path.parse(src);
            const strays = fs
                .readdirSync(path.join(ROOT, dir))
                .filter((f) => new RegExp(`^${name}-\\d+\\.webp$`).test(f));
            expect(
                strays,
                `${dir}/${name} has unreferenced ladder outputs — delete them or wire the srcSet`
            ).toEqual([]);
        }
    });

    it('REGISTRY and PENDING_WIRING never claim the same source', () => {
        const registered = new Set(registry.map((r) => r.src));
        const overlap = pendingWiring.filter((r) => registered.has(r.src)).map((r) => r.src);
        expect(overlap, `listed as both wired and pending: ${overlap.join(', ')}`).toEqual([]);
    });

    it('every registered source file exists', () => {
        for (const { src } of registry) {
            expect(fs.existsSync(path.join(ROOT, src)), `REGISTRY points at a missing file: ${src}`).toBe(true);
        }
    });

    it('the generated ladder files are checked in at the 1x step', () => {
        for (const { src, css } of registry) {
            const { dir, name } = path.parse(src);
            const oneX = path.join(ROOT, dir, `${name}-${css}.webp`);
            expect(
                fs.existsSync(oneX),
                `missing ladder output ${dir}/${name}-${css}.webp — run: node scripts/regen-image-ladders.mjs ${src} ${css}`
            ).toBe(true);
        }
    });

    it('source-capped art is listed for re-render rather than faked into the registry', () => {
        expect(script).toContain('PENDING_RERENDER');
        expect(script).toContain('reportPendingRerenders');
        const registered = new Set(registry.map((r) => r.src));
        // These are at/below their CSS size — a ladder cannot help until the
        // artwork is re-rendered, so they must NOT sit in REGISTRY pretending
        // to be crisp.
        for (const src of [
            'public/images/contact/hero.webp',
            'public/images/terms/hero.webp',
            'public/images/job-seekers/bento-match.webp',
        ]) {
            expect(script, `${src} should be tracked as pending re-render`).toContain(src);
            expect(registered, `${src} is source-capped and must not be in REGISTRY`).not.toContain(src);
        }
    });
});
