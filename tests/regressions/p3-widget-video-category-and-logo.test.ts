/**
 * Regression pins for the P3 widget-video package.
 *
 * P3 #11 (widget half) — /widget gained a ?category= filter so a nursing
 * program can embed specialty-specific listings:
 *   • the slug is validated against lib/pseo/taxonomy-registry.ts;
 *   • UNKNOWN values are IGNORED, never 400 — the widget lives in an
 *     iframe on a third-party .edu page, so a typo must degrade to the
 *     unfiltered state listing rather than replace the embed with an
 *     error card;
 *   • matching goes through withTagFallback (the same categoryTags path
 *     the /jobs/<category> pages and the /jobs ?category= filter use), so
 *     the widget and the page its CTA links to agree on "in category";
 *   • the existing param contract (state / program / limit) and the
 *     caching headers are untouched;
 *   • the embed snippet is documented in the route header.
 *
 * P3 #1 (logo half) — components/VideoJsonLd.tsx published a donor-era
 * remote logo (`site-assets/images/<donor>-hiring-logo.webp`) on a Supabase
 * project where that object was never uploaded: a guaranteed 404 in
 * VideoObject.publisher.logo. It now uses the local public/logo.png every
 * other publisher schema on the board already uses. Plus an honesty pin on
 * lib/video-seo.ts: while PAGE_VIDEO_SEO is empty, NOTHING may advertise a
 * video, and public/videos/ must stay absent of phantom references.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ALL_CATEGORY_SLUGS } from '../../lib/pseo/taxonomy-registry';
import {
    PAGE_VIDEO_SEO,
    getPageVideoSEO,
    getAllPageVideos,
} from '../../lib/video-seo';

const ROOT = path.resolve(__dirname, '../..');
const WIDGET = path.join(ROOT, 'app/widget/route.ts');
const VIDEO_JSONLD = path.join(ROOT, 'components/VideoJsonLd.tsx');
const VIDEO_SEO = path.join(ROOT, 'lib/video-seo.ts');

const widgetSrc = fs.readFileSync(WIDGET, 'utf8');
const videoJsonLdSrc = fs.readFileSync(VIDEO_JSONLD, 'utf8');
const videoSeoSrc = fs.readFileSync(VIDEO_SEO, 'utf8');

describe('P3 #11: /widget ?category= filter', () => {
    it('validates the slug against the taxonomy registry, not a local list', () => {
        expect(widgetSrc).toMatch(
            /import\s*\{\s*ALL_CATEGORY_SLUGS\s*\}\s*from\s*'@\/lib\/pseo\/taxonomy-registry'/,
        );
        expect(widgetSrc).toContain('new Set(ALL_CATEGORY_SLUGS)');
        // No inline copy of the taxonomy — that is the drift the registry exists
        // to prevent. A literal array of >3 known slugs would be a red flag.
        const inlineSlugLiterals = ALL_CATEGORY_SLUGS.filter((slug) =>
            widgetSrc.includes(`'${slug}'`),
        );
        expect(
            inlineSlugLiterals,
            'widget must not hardcode taxonomy slugs; derive from ALL_CATEGORY_SLUGS',
        ).toEqual([]);
    });

    it('resolves unknown categories to undefined instead of erroring', () => {
        // The resolver must be OUTSIDE the zod schema whose failure path
        // returns the 400 error shell.
        expect(widgetSrc).toMatch(/function resolveCategory\(/);
        const schemaBlock = widgetSrc.slice(
            widgetSrc.indexOf('const QUERY_SCHEMA'),
            widgetSrc.indexOf('function candidatePoolFor'),
        );
        expect(schemaBlock.length).toBeGreaterThan(0);
        expect(
            schemaBlock,
            'category must NOT live in QUERY_SCHEMA — schema failures render the 400 error shell',
        ).not.toContain('category');

        // Behavioral check on the resolver logic, replayed against the same
        // registry the route uses.
        const set = new Set<string>(ALL_CATEGORY_SLUGS);
        const resolve = (raw: string | null): string | undefined => {
            if (!raw) return undefined;
            const slug = raw.trim().toLowerCase();
            return set.has(slug) ? slug : undefined;
        };
        expect(resolve(null)).toBeUndefined();
        expect(resolve('')).toBeUndefined();
        expect(resolve('not-a-real-category')).toBeUndefined();
        expect(resolve('  TELEHEALTH ')).toBe('telehealth');
        for (const slug of ALL_CATEGORY_SLUGS) {
            expect(resolve(slug)).toBe(slug);
        }
    });

    it('filters via withTagFallback so the widget and /jobs agree on membership', () => {
        expect(widgetSrc).toMatch(
            /import\s*\{[^}]*withTagFallback[^}]*\}\s*from\s*'@\/lib\/pseo\/category-tagger'/,
        );
        expect(widgetSrc).toContain('withTagFallback(category)');
        // Threaded into the Prisma AND array conditionally — no clause at all
        // when no valid category was requested.
        expect(widgetSrc).toMatch(/\.\.\.\(category\s*\n?\s*\?\s*\[withTagFallback/);
    });

    it('threads the category into the CTA + empty-state links', () => {
        expect(widgetSrc).toContain('&category=${encodeURIComponent(category)}');
        // Both outbound /jobs links must carry it.
        expect(widgetSrc).toContain('${categoryQuery}&utm_source=widget');
        expect(widgetSrc).toContain('${escape(categoryQuery)}');
    });

    it('labels the category from the shared helper, not local niche copy', () => {
        expect(widgetSrc).toMatch(
            /import\s*\{\s*categoryFilterLabel\s*\}\s*from\s*'@\/lib\/filters'/,
        );
        expect(widgetSrc).toContain('categoryFilterLabel(category)');
    });

    it('keeps the existing param contract and caching behavior', () => {
        // state / program / limit validation is unchanged.
        expect(widgetSrc).toContain('state must be a 2-letter code');
        expect(widgetSrc).toContain('unknown US state code');
        expect(widgetSrc).toContain('const PROGRAM_PATTERN');
        expect(widgetSrc).toContain('const LIMIT_MIN = 3');
        expect(widgetSrc).toContain('const LIMIT_MAX = 12');
        expect(widgetSrc).toContain('const LIMIT_DEFAULT = 6');
        // Caching + embedding headers untouched.
        expect(widgetSrc).toContain(
            "'public, max-age=30, s-maxage=60, stale-while-revalidate=300'",
        );
        expect(widgetSrc).toContain("frame-ancestors 'self' https://*.edu");
        expect(widgetSrc).toContain("res.headers.set('X-Robots-Tag', 'noindex, nofollow')");
    });

    it('documents the embed snippet in the route header', () => {
        const header = widgetSrc.slice(0, widgetSrc.indexOf('const STATE_PATTERN'));
        expect(header).toContain('<iframe');
        expect(header).toContain('category=');
        expect(header).toMatch(/loading="lazy"/);
        // The header must state the ignore-unknown contract, since that is the
        // behavior an embedder depends on.
        expect(header.toLowerCase()).toContain('ignored');
    });
});

describe('P3 #1: VideoObject publisher logo is a live local asset', () => {
    it('no longer references the donor remote storage bucket', () => {
        for (const re of [/storage\/v1\/object/i, /site-assets/i, /storageBase/]) {
            expect(videoJsonLdSrc, `dead remote asset ref matches ${re}`).not.toMatch(re);
        }
    });

    it('publishes /logo.png, which exists on disk at the declared size', () => {
        expect(videoJsonLdSrc).toContain("path: '/logo.png'");
        const logoPath = path.join(ROOT, 'public', 'logo.png');
        expect(fs.existsSync(logoPath), 'public/logo.png must exist').toBe(true);

        // Declared width/height must be the PNG's real intrinsic size — read it
        // out of the IHDR chunk rather than trusting the constant.
        const buf = fs.readFileSync(logoPath);
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        expect(videoJsonLdSrc).toContain(`width: ${width}`);
        expect(videoJsonLdSrc).toContain(`height: ${height}`);
    });

    it('serializes JSON-LD with the repo escape chain', () => {
        expect(videoJsonLdSrc).toContain("replace(/</g, '\\\\u003c')");
        expect(videoJsonLdSrc).toContain("replace(/>/g, '\\\\u003e')");
        // Raw JSON.stringify must not reach dangerouslySetInnerHTML directly.
        expect(videoJsonLdSrc).not.toMatch(
            /dangerouslySetInnerHTML=\{\{\s*__html:\s*JSON\.stringify/,
        );
    });
});

describe('P3 #1: the empty video map advertises nothing', () => {
    it('PAGE_VIDEO_SEO is empty and both readers return nothing', () => {
        expect(Object.keys(PAGE_VIDEO_SEO)).toEqual([]);
        expect(getAllPageVideos()).toEqual([]);
        for (const route of [
            '/',
            '/about',
            '/faq',
            '/blog',
            '/resources',
            '/salary-guide',
            '/for-job-seekers',
        ]) {
            expect(getPageVideoSEO(route), `${route} must map to no video`).toBeNull();
        }
    });

    it('public/videos/ does not exist, so no entry can point at a real file yet', () => {
        // Guard rail, not a wish: if someone lands recordings, this flips and
        // forces a conscious re-read of the mapping contract in video-seo.ts.
        const videosDir = path.join(ROOT, 'public', 'videos');
        const exists = fs.existsSync(videosDir);
        if (!exists) {
            expect(Object.keys(PAGE_VIDEO_SEO)).toEqual([]);
            return;
        }
        // Recordings arrived — every mapped entry must resolve on disk.
        const missing = Object.entries(PAGE_VIDEO_SEO)
            .filter(([, seo]) => !fs.existsSync(path.join(ROOT, 'public', seo.video)))
            .map(([route]) => route);
        expect(missing, 'mapped routes whose video file is missing').toEqual([]);
    });

    it('every mapped entry (when any exist) is internally honest', () => {
        for (const [route, seo] of Object.entries(PAGE_VIDEO_SEO)) {
            expect(seo.duration, `${route} duration must be a positive integer`)
                .toBeGreaterThan(0);
            expect(Number.isInteger(seo.duration), `${route} duration`).toBe(true);
            expect(
                seo.uploadDate,
                `${route} uploadDate must be ISO 8601 with a time zone`,
            ).toMatch(/T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
            expect(seo.title.length, `${route} title`).toBeGreaterThan(0);
            expect(seo.description.length, `${route} description`).toBeGreaterThan(0);
        }
    });

    it('the video sitemap does not read this map (self-hosted scrolls stay out)', () => {
        const sitemapSrc = fs.readFileSync(
            path.join(ROOT, 'app/video-sitemap.xml/route.ts'),
            'utf8',
        );
        expect(sitemapSrc).not.toContain('video-seo');
        expect(sitemapSrc).not.toContain('getAllPageVideos');
        // It advertises only YouTube-backed blog posts.
        expect(sitemapSrc).toContain('youtube_video_id');
        // …and robots.ts can therefore keep listing the route unconditionally:
        // with zero rows it still emits a well-formed empty <urlset>.
        expect(sitemapSrc).toContain('<urlset');
        expect(sitemapSrc).toContain('blogEntries.join');
        const robotsSrc = fs.readFileSync(path.join(ROOT, 'app/robots.ts'), 'utf8');
        expect(robotsSrc).toContain('/video-sitemap.xml');
    });

    it('video-seo.ts documents the drop-in contract for a human recorder', () => {
        expect(videoSeoSrc).toContain('public/videos/');
        expect(videoSeoSrc).toMatch(/ISO 8601 WITH a time zone/);
        // The stale remote-thumbnail example must not linger as a dead-URL
        // template for whoever repopulates the map.
        expect(videoSeoSrc).not.toContain('site-assets');
        expect(videoSeoSrc).not.toContain('storageBase');
    });
});
