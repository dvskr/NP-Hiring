/**
 * Indexing readiness audit, handoff-fix round: the smaller leftovers other
 * packages handed off, pinned together.
 *
 *   - HANDOFFS 179 (CQ-05): enrich-jobs re-derives categoryTags when it fills
 *     a field the tagger reads.
 *   - CONTENT-GUIDES 40, 43, 80/124, 125: salary hub cross-link, the
 *     /resources hasPart name, the /compare licensure claim, the 1099
 *     calculator's salary guide blurb.
 *   - SITE-COPY 50/85/86/148, 58/152b, 152c: admin company links, the CE hub
 *     links, and the landing sibling grid preferring indexable landings.
 *   - SITEMAP 174 to 177, JOB-PAGE 16, INGEST 30: stale comments and scripts.
 *   - APPLY (PENDING_WORK 2.11) and GAPS 186 / JOB-PAGE 13: the closed guest
 *     Easy Apply entry and the recorded owner steps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { brand } from '@/config/brand';
import { renewalCategoryTags } from '@/lib/ingestion-service';
import { companyProfilePath } from '@/lib/company-slug';
import { getLicenseGuidePost, LICENSE_GUIDE_STATES } from '@/lib/blog-license-guides';
import { CEU_GUIDE_SLUG, CEU_GUIDE_TITLE } from '@/lib/blog-ceu-guide';
import { preferIndexableSiblings } from '@/lib/pseo/category-landing-template';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('HANDOFFS 179: enrich-jobs keeps categoryTags in step with the fields it fills', () => {
    const src = read('app/api/cron/enrich-jobs/route.ts');

    it('selects every tagger input plus the stored tags, and re-derives before the write', () => {
        for (const field of ['descriptionSummary: true', 'newGradFriendly: true', 'minYearsExperience: true', 'categoryTags: true']) {
            expect(src, field).toContain(field);
        }
        expect(src).toContain("import { renewalCategoryTags } from '@/lib/ingestion-service';");
        const derive = src.indexOf('const categoryTags = renewalCategoryTags(job, updateData);');
        expect(derive).toBeGreaterThan(-1);
        expect(src).toContain('if (categoryTags) updateData.categoryTags = categoryTags;');
        // Before the content stamp and the write, so both see the new tags.
        expect(derive).toBeLessThan(src.indexOf('Object.assign(updateData, contentChangeStamp(job, updateData));'));
        expect(derive).toBeLessThan(src.indexOf('data: updateData,'));
    });

    const row = {
        title: 'Nurse Practitioner',
        description: 'See adult patients in a primary care clinic and manage chronic conditions.',
        descriptionSummary: null,
        jobType: null,
        mode: null,
        isRemote: false,
        isHybrid: false,
        setting: null,
        population: null,
        newGradFriendly: false,
        minYearsExperience: null,
        employer: 'Acme Health',
        categoryTags: [] as string[],
    };

    it('a run that fills the work mode re-tags the job', () => {
        const tags = renewalCategoryTags(row, { lastEnrichedAt: new Date(), mode: 'Remote', isRemote: true, isHybrid: false });
        expect(tags).not.toBeNull();
        expect(tags).toContain('remote');
    });

    it('a run that only stamps lastEnrichedAt, or fills nothing the tagger reads, leaves the tags alone', () => {
        expect(renewalCategoryTags(row, { lastEnrichedAt: new Date() })).toBeNull();
        expect(renewalCategoryTags(row, { lastEnrichedAt: new Date(), city: 'Austin', benefits: ['Dental'] })).toBeNull();
    });
});

describe('content and copy leftovers', () => {
    it('CONTENT-GUIDES 40: the salary hub links the long-form pay factors post', () => {
        const hub = read('app/salary-guide/page.tsx');
        expect(hub).toMatch(/<Link href="\/blog\/np-salary-guide"[^>]*>\s*What moves NP pay\s*<\/Link>/);
        expect(fs.existsSync(path.join(ROOT, 'content/blog/np-salary-guide.mdx'))).toBe(true);
    });

    it("CONTENT-GUIDES 43: the /resources hasPart name is the FPA guide's own title", () => {
        const resources = read('app/resources/page.tsx');
        const guide = read('app/resources/fpa-guide/page.tsx');
        expect(guide).toContain('const PAGE_TITLE = `What Full Practice Authority Means for ${brand.niche.short}s`;');
        expect(resources).toContain("{ '@type': 'Article', name: `What Full Practice Authority Means for ${brand.niche.short}s`, url: `${brand.baseUrl}/resources/fpa-guide` }");
        expect(resources).not.toContain('name: `${brand.niche.short} Full Practice Authority Guide`');
    });

    it('CONTENT-GUIDES 80/124: /compare no longer says the guides never state fees or processing times', () => {
        const compare = read('lib/compare-data.ts');
        expect(compare).not.toContain('rather than asserting fees and processing times as fact');
        expect(compare).toContain('stating a fee or processing time only with its source and check date');
    });

    it('CONTENT-GUIDES 125: the 1099 calculator describes the salary guide by what it publishes', () => {
        const page = read('app/tools/1099-vs-w2-calculator/page.tsx');
        expect(page).toContain("blurb: 'The national median, and a state median wherever enough postings support one.'");
        expect(page).not.toContain('State-by-state pay, updated from live postings.');
    });
});

describe('SITE-COPY: links built by the shared helpers', () => {
    it('50/85/86/148: the admin company pages link through companyProfilePath, never the legacy slug', () => {
        for (const rel of ['app/admin/companies/page.tsx', 'app/admin/company-claims/page.tsx']) {
            const src = read(rel);
            expect(src, rel).toContain("import { companyProfilePath } from '@/lib/company-slug';");
            expect(src, rel).not.toContain('function companyHref(');
            expect(src, rel).not.toMatch(/normalizedName\.replace\(/);
        }
        expect(read('app/admin/companies/page.tsx')).toContain('href={companyProfilePath({ name: c.name, normalizedName: c.normalizedName })}');
        expect(read('app/admin/company-claims/page.tsx')).toContain('href={companyProfilePath(c.company)}');
        // The helper prefers the display-name slug the public page answers on.
        expect(companyProfilePath({ name: 'LifeStance Health', normalizedName: 'lifestance health' })).toMatch(/^\/companies\/[a-z0-9-]+$/);
    });

    it('58/152b: every license guide links the CE hub from its renewal section', () => {
        const href = `/blog/${CEU_GUIDE_SLUG}`;
        for (const state of LICENSE_GUIDE_STATES) {
            const post = getLicenseGuidePost(state.stateSlug)!;
            const renewal = post.content.slice(post.content.indexOf(`## Renewing your ${state.name} license`));
            expect(renewal, state.name).toContain(`[${CEU_GUIDE_TITLE}](${href})`);
        }
    });

    it('58/152b: /blog links the CE hub on every page of the index, page 1 included', () => {
        const blog = read('app/blog/page.tsx');
        expect(blog).toContain("import { CEU_GUIDE_SLUG, CEU_GUIDE_TITLE } from '@/lib/blog-ceu-guide';");
        expect(blog).toMatch(/<Link href=\{`\/blog\/\$\{CEU_GUIDE_SLUG\}`\}[^>]*>\s*\{CEU_GUIDE_TITLE\}\s*<\/Link>/);
        expect(CEU_GUIDE_TITLE).toContain(brand.niche.long);
    });

    it('152c: indexable sibling landings come first, nothing is dropped, and no verdicts keeps axis order', () => {
        const siblings = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }];
        expect(preferIndexableSiblings(siblings, new Set(['c', 'a'])).map((s) => s.slug)).toEqual(['a', 'c', 'b', 'd']);
        expect(preferIndexableSiblings(siblings, null).map((s) => s.slug)).toEqual(['a', 'b', 'c', 'd']);
        expect(preferIndexableSiblings(siblings, new Set()).map((s) => s.slug)).toEqual(['a', 'b', 'c', 'd']);
        const template = read('lib/pseo/category-landing-template.tsx');
        expect(template).toContain("loadIndexableLandingSlugs('category-landing-siblings')");
        expect(template).toContain('const related = preferIndexableSiblings(relatedByAxis, indexableLandings);');
    });
});

describe('stale comments and scripts', () => {
    it('SITEMAP 174 to 177: nothing still describes the retired image sitemap or a listed video sitemap', () => {
        expect(read('components/StateImage.tsx')).not.toContain('app/image-sitemap.xml');
        expect(read('components/StateImage.tsx')).toContain('stateDioramaSitemapImages');
        expect(read('lib/video-seo.ts')).not.toMatch(/keep advertising\s+\*?\s*\/video-sitemap\.xml/);
        expect(read('lib/video-seo.ts')).toContain('robots.txt no longer lists /video-sitemap.xml');
        expect(read('scripts/optimize-state-images.mjs')).not.toContain('image-sitemap');
        expect(read('scripts/audit/sitemaps.mjs')).not.toMatch(/image-sitemap|video-sitemap/);
    });

    it('JOB-PAGE 16: the Career Pulse comment no longer claims the card is live', () => {
        const stats = read('config/niche/stats.ts');
        expect(stats).not.toContain('This card IS live on every job page');
        expect(stats).toContain('CQ-11 removed the card (CareerPulseCard) from the job page');
    });

    it('INGEST 30: the salary config describes dropping, not clamping', () => {
        const salary = read('config/niche/salary.ts');
        expect(salary).not.toContain('CLAMPS out-of-range values');
        expect(salary).not.toContain('clamp-not-drop');
        expect(salary).toContain('out-of-range values are DROPPED by');
        expect(salary).not.toContain('normalization + clamping');
        expect(salary).toContain('out-of-range values are withheld or flagged, never clamped');
    });
});

describe('docs: the pending work register follows the owner decisions', () => {
    const pending = read('docs/PENDING_WORK.md');

    it('2.11 records guest Easy Apply as closed (applying requires an account)', () => {
        expect(pending).toContain('**2.11 Guest Easy Apply: closed.**');
        expect(pending).toContain('guest Easy Apply will not be built; JobPosting directApply stays false.');
        expect(pending).not.toContain('accepts a rate-limited guest submit');
    });

    it('records the indexing data repairs as owner steps, in run order', () => {
        expect(pending).toContain('**1.12 Indexing data repairs');
        const order = [
            'backfill-content-changed-at.ts',
            'unpublish-misrepresented-jobs',
            'unpublish-non-us-jobs',
            'hold-stub-description-jobs',
            'backfill-job-locations',
            'correct-location-and-pay',
            'collapse-duplicate-jobs',
            'rederive-job-type',
            'retag-category-tags',
            'scripts/backfill-remote-flags.ts',
            'populate-company-website-logo.ts',
        ];
        const at = order.map((step) => pending.indexOf(step));
        for (const [i, pos] of at.entries()) expect(pos, order[i]).toBeGreaterThan(-1);
        expect([...at].sort((a, b) => a - b)).toEqual(at);
        expect(pending).toContain('work-mode-check-constraints.sql');
    });

    it('the house style holds in the new entries (no em or en dash)', () => {
        const start = pending.indexOf('**1.12 Indexing data repairs');
        const end = pending.indexOf('## 2. Engineering');
        expect(pending.slice(start, end)).not.toMatch(/[–—]/);
        const closed = pending.slice(pending.indexOf('**2.11'), pending.indexOf('## 3. Decisions'));
        expect(closed).not.toMatch(/[–—]/);
    });
});
