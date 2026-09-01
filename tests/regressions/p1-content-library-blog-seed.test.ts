/**
 * P1 #3 — seed blog batch + admin editor prerequisites (content-library).
 *
 * Six evergreen NP posts live as .mdx in content/blog/ and are wired
 * into config/niche/content-map.ts (job-page sidebar slots + homepage
 * featured list). These tests enforce:
 *
 *   1. WIRING: every slug the content map links resolves to a real
 *      content/blog/<slug>.mdx file (a missing homepage slug is a live
 *      sitewide internal 404 — mirrors scripts/fork-preflight.ts).
 *   2. CONTENT SHAPE: 700–1200 words, valid public category, meta
 *      description, and a visible FAQ section (which the sync script
 *      extracts into faq_json for FAQPage schema).
 *   3. TRUTH RULES: cited statistics match lib/stats-sources.ts and no
 *      fabricated inventory claims re-enter.
 *   4. EDITOR FIXES: the admin editor derives its categories from
 *      BLOG_CATEGORIES (was missing 4 of 13), can author faq_json and
 *      reviewed_at (validated in the API), and the blog index color map
 *      is keyed by real category ids (job_seeker_tips bug).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    RELATED_BLOG_SLUGS,
    HOMEPAGE_FEATURED_POSTS,
} from '@/config/niche/content-map';
import { BLOG_CATEGORIES } from '@/lib/blog';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { salaryConfig } from '@/config/niche/salary';

const ROOT = process.cwd();
const BLOG_DIR = path.join(ROOT, 'content', 'blog');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Set<string>, not Set<BlogCategory>: the values under test come from raw
// .mdx frontmatter, so the membership check must accept an arbitrary string
// (that is the whole point of the check) rather than fail type-checking.
const CATEGORY_IDS = new Set<string>(BLOG_CATEGORIES.map((c) => c.id));

function contentMapSlugs(): string[] {
    const slugs = [
        ...RELATED_BLOG_SLUGS.always,
        ...RELATED_BLOG_SLUGS.remoteOrTelehealth,
        ...RELATED_BLOG_SLUGS.newGrad,
        ...RELATED_BLOG_SLUGS.generalFallback,
    ];
    for (const post of HOMEPAGE_FEATURED_POSTS) {
        if (post.href.startsWith('/blog/')) slugs.push(post.href.slice('/blog/'.length));
    }
    return [...new Set(slugs)];
}

function parsePost(slug: string) {
    const raw = fs.readFileSync(path.join(BLOG_DIR, `${slug}.mdx`), 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    const fm: Record<string, string> = {};
    if (m) {
        for (const line of m[1].split(/\r?\n/)) {
            const idx = line.indexOf(':');
            if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
    }
    return { fm, body: m ? m[2] : raw };
}

function wordCount(markdown: string): number {
    return markdown
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*`>|]/g, '')
        .split(/\s+/)
        .filter(Boolean).length;
}

describe('content-map wiring', () => {
    it('all sidebar slots and the homepage featured list are populated', () => {
        expect(RELATED_BLOG_SLUGS.always.length).toBeGreaterThan(0);
        expect(RELATED_BLOG_SLUGS.remoteOrTelehealth.length).toBeGreaterThan(0);
        expect(RELATED_BLOG_SLUGS.newGrad.length).toBeGreaterThan(0);
        expect(RELATED_BLOG_SLUGS.generalFallback.length).toBeGreaterThan(0);
        expect(HOMEPAGE_FEATURED_POSTS.length).toBe(6);
    });

    it('every linked slug resolves to a content/blog/<slug>.mdx source file', () => {
        for (const slug of contentMapSlugs()) {
            const file = path.join(BLOG_DIR, `${slug}.mdx`);
            expect(fs.existsSync(file), `content/blog/${slug}.mdx missing — content-map link 404s`).toBe(true);
        }
    });

    it('the six priority posts from the content plan all exist', () => {
        const slugs = new Set(contentMapSlugs());
        for (const slug of [
            'np-salary-guide',
            'remote-telehealth-np-jobs-guide',
            'new-grad-np-first-job',
            'highest-paying-np-specialties',
            'fnp-vs-pmhnp-vs-agacnp',
            'np-1099-vs-w2',
        ]) {
            expect(slugs.has(slug), `${slug} not wired into the content map`).toBe(true);
        }
    });
});

describe('post shape', () => {
    for (const slug of [
        'np-salary-guide',
        'remote-telehealth-np-jobs-guide',
        'new-grad-np-first-job',
        'highest-paying-np-specialties',
        'fnp-vs-pmhnp-vs-agacnp',
        'np-1099-vs-w2',
    ]) {
        it(`${slug}: frontmatter, category, length, and FAQ block`, () => {
            const { fm, body } = parsePost(slug);
            expect(fm.title, 'title missing').toBeTruthy();
            expect(fm.description, 'description missing').toBeTruthy();
            expect(fm.date, 'date missing').toBeTruthy();
            expect(CATEGORY_IDS.has(fm.category), `invalid category '${fm.category}'`).toBe(true);

            const words = wordCount(body);
            expect(words, `${words} words — outside the 700–1200 evergreen band`).toBeGreaterThanOrEqual(700);
            expect(words).toBeLessThanOrEqual(1200);

            // Visible FAQ block — the sync script extracts this into faq_json,
            // so schema always mirrors on-page content.
            expect(body).toMatch(/^## Frequently asked questions/m);
            const faqSection = body.split(/^## Frequently asked questions/m)[1];
            const questions = faqSection.match(/^### .+$/gm) ?? [];
            expect(questions.length, 'need at least 3 FAQ questions').toBeGreaterThanOrEqual(3);

            // Quick-answer opener (hoisted into the styled callout by the
            // post template).
            expect(body).toMatch(/\*\*Quick answer:\*\*/);
        });
    }
});

describe('truth rules', () => {
    const allBodies = [
        'np-salary-guide',
        'remote-telehealth-np-jobs-guide',
        'new-grad-np-first-job',
        'highest-paying-np-specialties',
        'fnp-vs-pmhnp-vs-agacnp',
        'np-1099-vs-w2',
    ].map((slug) => ({ slug, body: parsePost(slug).body }));

    it('cited statistics match lib/stats-sources.ts exactly', () => {
        for (const { slug, body } of allBodies) {
            if (body.includes('$129,210')) {
                expect(STAT_SOURCES.averageSalary.formatted).toBe('$129,210');
                expect(body, `${slug}: median cited without BLS attribution`).toMatch(/BLS/);
            }
            if (/40%/.test(body)) {
                expect(STAT_SOURCES.blsGrowth2034.formatted).toBe('40%');
            }
            if (body.includes('27 states + DC')) {
                expect(STAT_SOURCES.fullPracticeStates.formatted).toBe('27 states + DC');
                expect(body, `${slug}: FPA count cited without AANP attribution`).toMatch(/AANP/);
            }
            if (body.includes('90 million+')) {
                expect(STAT_SOURCES.hrsaShortagePopulation.formatted).toBe('90 million+');
                expect(body, `${slug}: HPSA stat must say primary care (source is primary-care HPSA)`).toMatch(/primary.care/i);
                expect(body, `${slug}: HPSA stat cited without HRSA attribution`).toMatch(/HRSA/);
            }
        }
    });

    it('no fabricated inventory claims re-enter (P0 #5 pattern)', () => {
        for (const { slug, body } of allBodies) {
            expect(body, slug).not.toMatch(/10,000\+|3,000\+|#1 (job board|source)/i);
            expect(body, slug).not.toMatch(/\b\d{1,3}(,\d{3})?\+ (open )?(positions|jobs|employers|companies)\b/i);
        }
    });

    it('no fabricated people, quotes, or testimonials', () => {
        for (const { slug, body } of allBodies) {
            expect(body, slug).not.toMatch(/testimonial|—\s*[A-Z][a-z]+ [A-Z]\.,/);
        }
    });

    /**
     * Provenance ratchet: a dollar figure may only appear in the seed batch
     * if it already exists in a repo source of truth. A new band invented
     * for a post would contradict the pSEO surfaces quoting the old one
     * (the P0 #4 failure mode), so new figures must be added to the source
     * file FIRST and then listed here.
     */
    it('every dollar figure traces to a repo source of truth', () => {
        const ALLOWED = new Map<string, string>([
            [STAT_SOURCES.averageSalary.formatted, 'lib/stats-sources.ts — BLS OEWS median'],
            ['$110K–$170K', 'config/niche/salary.ts — normalizer.typical'],
            ['$95K–$120K', 'app/jobs/new-grad + app/jobs/entry-level FAQ copy'],
            ['$60–$150+', 'config/niche/salary.ts header — locum NP hourly band'],
            ['$70–$130', 'lib/pseo/setting-state-config.ts — contract hourly band'],
            ['$180K–$250K+', 'lib/pseo/state-narrative.ts — CRNA band'],
            ['$120K–$170K', 'lib/pseo/city-narrative.ts — behavioral-health band'],
            ['$5K', 'illustrative negotiation delta, not a market claim'],
        ]);
        // Longest-first so '$110K–$170K' is consumed before its '$110K' half.
        const patterns = [...ALLOWED.keys()].sort((a, b) => b.length - a.length);
        for (const { slug, body } of allBodies) {
            let rest = body;
            for (const p of patterns) rest = rest.split(p).join('');
            const orphans = rest.match(/\$[\d][\d,.]*[KkMm]?\+?/g) ?? [];
            expect(orphans, `${slug}: untraced dollar figure(s)`).toEqual([]);
        }
        // The typical-band literal must still match the config it cites.
        const cfg = salaryConfig.normalizer.typical;
        expect(`$${cfg.min / 1000}K–$${cfg.max / 1000}K`).toBe('$110K–$170K');
    });

    it('no invented NHSC award amount (link to the program instead)', () => {
        for (const { slug, body } of allBodies) {
            if (!/NHSC|National Health Service Corps/.test(body)) continue;
            expect(body, `${slug}: quotes an NHSC award amount`)
                .not.toMatch(/(NHSC|National Health Service Corps)[^.]{0,120}\$[\d]/);
            expect(body, `${slug}: NHSC mentioned without pointing at the program`)
                .toMatch(/nhsc\.hrsa\.gov/);
        }
    });
});

describe('admin editor prerequisites', () => {
    it('editor derives categories from BLOG_CATEGORIES (all 13, not 9)', () => {
        const src = read('app/admin/blog/page.tsx');
        expect(src).toMatch(/import \{ BLOG_CATEGORIES \} from '@\/lib\/blog-categories'/);
        expect(src).toMatch(/BLOG_CATEGORIES\.map/);
        // The stale hand-rolled list is gone.
        expect(src).not.toContain("{ value: 'job_seeker_attraction', label: 'Job Seeker Attraction' }");
        expect(BLOG_CATEGORIES).toHaveLength(13);
    });

    /**
     * Deriving the taxonomy must not cost a client bundle. lib/blog.ts
     * imports @supabase/supabase-js and sanitize-html, and its top-level
     * BLOG_SANITIZE_CONFIG dereferences `sanitizeHtml.defaults`, so the
     * sanitizer stays reachable from any importer — pulling it into a
     * 'use client' page ships that whole graph to the browser. The
     * taxonomy therefore lives in a dependency-free module that both
     * sides import.
     */
    it('no "use client" file imports the server blog module', () => {
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                    walk(full);
                    continue;
                }
                if (!/\.(tsx|ts)$/.test(entry.name)) continue;
                const src = fs.readFileSync(full, 'utf8');
                if (!/^\s*(['"])use client\1/.test(src)) continue;
                if (/from '@\/lib\/blog'/.test(src)) {
                    offenders.push(path.relative(ROOT, full));
                }
            }
        };
        for (const dir of ['app', 'components']) walk(path.join(ROOT, dir));
        expect(offenders, `client components importing '@/lib/blog': ${offenders.join(', ')}`)
            .toEqual([]);
    });

    it('lib/blog-categories.ts stays dependency-free and lib/blog re-exports it', () => {
        const cats = read('lib/blog-categories.ts');
        expect(cats, 'blog-categories.ts must not import anything').not.toMatch(/^import\s/m);
        expect(cats).toMatch(/export const BLOG_CATEGORIES/);
        const blog = read('lib/blog.ts');
        expect(blog).toMatch(/export \{ BLOG_CATEGORIES \} from '@\/lib\/blog-categories'/);
        expect(blog).toMatch(/export type \{ BlogCategory \} from '@\/lib\/blog-categories'/);
        // Server callers keep working through the re-export.
        expect(BLOG_CATEGORIES.map((c) => c.id)).toContain('state_spotlight');
    });

    it('editor can author faq_json and reviewed_at', () => {
        const src = read('app/admin/blog/page.tsx');
        expect(src).toContain('reviewedAt');
        expect(src).toContain('faqJson');
        expect(src).toMatch(/type="date"/);
    });

    it('admin API validates faqJson + reviewedAt on create and update', () => {
        const create = read('app/api/admin/blog/route.ts');
        const update = read('app/api/admin/blog/[id]/route.ts');
        const validate = read('app/api/admin/blog/validate.ts');
        for (const src of [create, update]) {
            expect(src).toContain('parseFaqJson');
            expect(src).toContain('parseReviewedAt');
        }
        expect(validate).toMatch(/typeof \(entry as FaqEntry\)\.name !== 'string'/);
        // Clearing the Json column uses Prisma null semantics, not raw null.
        expect(update).toContain('Prisma.DbNull');
    });

    it('blog index color map is keyed by real category ids (job_seeker_tips bug)', () => {
        const src = read('app/blog/page.tsx');
        expect(src).not.toMatch(/^\s*job_seeker_tips:/m);
        expect(src).toMatch(/^\s*job_seeker_attraction:/m);
        // Every public category id has a color entry.
        for (const { id } of BLOG_CATEGORIES) {
            expect(src, `CATEGORY_COLORS missing '${id}'`).toMatch(new RegExp(`^\\s*${id}:`, 'm'));
        }
    });

    it('sync script validates categories, extracts FAQ, and has the atomic license-guide mode', () => {
        const src = read('scripts/sync-blog-to-db.ts');
        expect(src).toContain('VALID_CATEGORIES');
        expect(src).toContain('extractFaqFromMarkdown');
        expect(src).toContain('--license-guides');
        expect(src).toContain('$transaction');
        // The old broken mappings to nonexistent categories are gone.
        expect(src).not.toContain('career_development');
        expect(src).not.toContain('interview_prep');
        expect(src).not.toContain('telehealth_digital');
    });

    it('sync script derives its category allowlist instead of mirroring it by hand', () => {
        const src = read('scripts/sync-blog-to-db.ts');
        expect(src).toMatch(/from '\.\.\/lib\/blog-categories'/);
        expect(src).toMatch(/VALID_CATEGORIES = new Set<string>\(BLOG_CATEGORIES\.map/);
    });

    /**
     * Prisma reads `undefined` as "don't touch this column", so
     * `faqJson: faqJson ?? undefined` left the PREVIOUS faq_json in place
     * on the --update path. An .mdx post whose FAQ section was trimmed or
     * removed would keep emitting the old FAQPage JSON-LD — schema that
     * no longer appears anywhere on the page.
     */
    it('--update clears faq_json rather than stranding a stale FAQPage payload', () => {
        const src = read('scripts/sync-blog-to-db.ts');
        expect(src).toContain('Prisma.DbNull');
        expect(src).not.toMatch(/faqJson:\s*faqJson\s*\?\?\s*undefined/);
        expect(src).not.toMatch(/faqJson:\s*post\.faq_json\s*\?\?\s*undefined/);
        expect(src).toMatch(/import \{ Prisma, PrismaClient \} from '@prisma\/client'/);
    });
});
