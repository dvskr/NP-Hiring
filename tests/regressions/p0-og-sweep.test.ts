/**
 * P0 #1 — sitewide OG-image sweep regression pins.
 *
 * ~70 pages referenced dead Supabase `site-assets` page-screenshots in
 * their openGraph/twitter metadata (the bucket is unpopulated — every URL
 * 400s), and lib/image-seo.ts fed the same dead URLs into
 * image-sitemap.xml. The fix routes every metadata image through the
 * board's own edge OG renderer (/api/og — working pattern:
 * app/for-employers/page.tsx). The image sitemap itself is retired
 * (indexing audit FB-4); its only images, the state dioramas, now ride on
 * the gated state entries of /sitemap.xml.
 *
 * These tests pin:
 *   1. lib/image-seo.ts only emits board-resolvable images (local
 *      /images/**) — never a remote storage bucket.
 *   2. The retired image sitemap stays retired.
 *   3. Swept page files contain no site-assets metadata references.
 *   4. Spot-pins on 5 representative pages' OG config.
 *   5. Files that legitimately keep STORAGE_BASE for visible art
 *      (pending the P1 asset regen) never use it inside metadata images.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { stateDioramaSitemapImages } from '@/lib/image-seo';
import { STATE_DIORAMA_SLUGS } from '@/components/StateImage';
import robots from '@/app/robots';
import { brand } from '@/config/brand';

const ROOT = path.resolve(__dirname, '../..');
const src = (rel: string): string =>
    fs.readFileSync(path.join(ROOT, rel), 'utf-8');

/** Page files whose ENTIRE source must be free of storage-bucket refs. */
const FULLY_SWEPT_FILES = [
    'lib/image-seo.ts',
    'app/page.tsx',
    'app/jobs/page.tsx',
    'app/about/page.tsx',
    'app/blog/page.tsx',
    'app/for-job-seekers/page.tsx',
    'app/companies/page.tsx',
    'app/terms/page.tsx',
    'app/salary-guide/page.tsx',
    'app/salary-guide/[state]/page.tsx',
    'app/resources/fpa-guide/page.tsx',
    'app/resources/1099-vs-w2/page.tsx',
    'app/resources/private-practice-guide/page.tsx',
];

/**
 * Files that still use STORAGE_BASE for VISIBLE images (P1 asset-regen
 * scope) but whose metadata images must route through /api/og.
 */
const VISIBLE_ART_HOLDOUTS = ['app/privacy/page.tsx', 'app/resources/page.tsx'];

describe('P0 OG sweep — lib/image-seo.ts', () => {
    it('every sitemap image is a board-local /images/** file, never a storage bucket', () => {
        const images = STATE_DIORAMA_SLUGS.flatMap((slug) => stateDioramaSitemapImages(slug, brand.baseUrl));
        expect(images.length).toBeGreaterThan(0);
        for (const image of images) {
            expect(image.startsWith(`${brand.baseUrl}/images/`), `non-resolvable image: ${image}`).toBe(true);
            expect(image).not.toContain('supabase');
        }
    });
});

describe('P0 OG sweep — the retired image sitemap stays retired (FB-4)', () => {
    it('has no route, so /image-sitemap.xml answers 404', () => {
        expect(fs.existsSync(path.join(ROOT, 'app', 'image-sitemap.xml'))).toBe(false);
    });

    it('robots.txt does not advertise it', () => {
        const sitemaps = ([] as string[]).concat(robots().sitemap ?? []);
        expect(sitemaps.some((url) => url.includes('image-sitemap'))).toBe(false);
    });
});

describe('P0 OG sweep — robots.txt social-bot /api/og carve-out', () => {
    // Every og:image now points at /api/og, but SOCIAL_DISALLOW blocks
    // /api/ for the preview bots that render share cards. Under RFC 9309
    // longest-match-wins a bare `allow: '/'` (1 char) loses to `/api/`
    // (5 chars), so without an explicit /api/og allow the X/LinkedIn/
    // Slack/Facebook crawlers are told not to fetch the card images —
    // partially defeating the sweep. Pin the carve-out on emitted output.
    const asArray = <T,>(v: T | T[] | undefined): T[] =>
        v === undefined ? [] : Array.isArray(v) ? v : [v];

    it('social preview bots get an /api/og allow that out-matches the /api/ disallow', () => {
        const rules = asArray(robots().rules);
        const socialRule = rules.find((rule) =>
            asArray(rule.userAgent).includes('Twitterbot'),
        );
        expect(socialRule, 'no social-bot rule block in robots.ts').toBeDefined();
        const allow = asArray(socialRule!.allow);
        const disallow = asArray(socialRule!.disallow);
        // The hazard this guards against is still present…
        expect(disallow).toContain('/api/');
        // …so the longer-match allow must be too.
        expect(
            allow,
            'social bots lost the /api/og carve-out — share cards will render without images',
        ).toContain('/api/og');
    });

    it('every rule block that disallows /api/ carries the /api/og carve-out', () => {
        for (const rule of asArray(robots().rules)) {
            const disallow = asArray(rule.disallow);
            if (!disallow.includes('/api/')) continue;
            const agents = asArray(rule.userAgent).join(', ') || '*';
            // ClaudeBot is a live-browsing fetcher, not a share-card
            // renderer — its dedicated block intentionally has no /api/og
            // allow (nothing user-facing depends on it fetching OG images).
            if (agents === 'ClaudeBot') continue;
            expect(
                asArray(rule.allow),
                `rule block [${agents}] disallows /api/ without the /api/og carve-out`,
            ).toContain('/api/og');
        }
    });
});

describe('P0 OG sweep — page metadata sources', () => {
    it('swept files contain zero storage-bucket references', () => {
        for (const rel of FULLY_SWEPT_FILES) {
            const source = src(rel);
            expect(source, `${rel} still references site-assets`).not.toContain('site-assets');
            expect(source, `${rel} still references storageBase`).not.toContain('storageBase');
            expect(source, `${rel} still references supabase directly`).not.toContain('supabase.co');
        }
    });

    it('visible-art holdouts never use STORAGE_BASE inside metadata images', () => {
        for (const rel of VISIBLE_ART_HOLDOUTS) {
            const source = src(rel);
            // og/twitter images arrays must not reference the storage bucket…
            expect(
                /images:\s*\[[^\]]*STORAGE_BASE/.test(source),
                `${rel} metadata images still reference STORAGE_BASE`,
            ).toBe(false);
            // …and must route through the board's own OG renderer.
            expect(source, `${rel} metadata lost its /api/og card`).toContain('/api/og?title=');
        }
    });

    it('spot-pin: homepage uses the bare /api/og homepage card', () => {
        const source = src('app/page.tsx');
        expect(source).toContain('const HOME_OG_IMAGE = `${brand.baseUrl}/api/og`');
        expect(source).toContain('images: [HOME_OG_IMAGE]');
    });

    it('spot-pin: /terms og+twitter use an /api/og card', () => {
        const source = src('app/terms/page.tsx');
        expect(source).toContain("/api/og?title=${encodeURIComponent('Terms of Service')}&type=page");
        expect(source).toContain('images: [TERMS_OG_IMAGE]');
    });

    it('spot-pin: /companies og+twitter use an /api/og card', () => {
        const source = src('app/companies/page.tsx');
        expect(source).toContain('COMPANIES_OG_IMAGE = `${brand.baseUrl}/api/og?title=');
        expect(source).toContain('images: [COMPANIES_OG_IMAGE]');
    });

    it('spot-pin: salary-guide state pages render per-state /api/og cards', () => {
        const source = src('app/salary-guide/[state]/page.tsx');
        // Per-page params: the card title carries the state name and code.
        expect(source).toContain('Salary in ${stateName} (${code})');
        expect(source).toContain('/api/og?title=${encodeURIComponent(');
        // Article JSON-LD image uses the same generator (no dead bucket URL).
        expect(source).toContain('image: salaryGuideOgImage(stateName, stateCode)');
    });

    it('spot-pin: fpa-guide og/twitter/Article image all use the /api/og card', () => {
        const source = src('app/resources/fpa-guide/page.tsx');
        expect(source).toContain('HERO_IMAGE = `${brand.baseUrl}/api/og?title=');
        expect(source).toContain('images: [HERO_IMAGE]');
        expect(source).toContain('image: HERO_IMAGE');
    });
});
