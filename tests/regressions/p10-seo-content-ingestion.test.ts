/**
 * P10 seo-content-ingestion regressions (E2E journeys seo-data-integrity and
 * candidate-discovery):
 *   1. work-mode flags are mutually exclusive on the ingest LLM merge path
 *   2. CategoryHero renders linked breadcrumbs matching the JSON-LD items
 *   3. multi-state per-jurisdiction titles collapse and lose em dashes
 *   4. feed.xml channel copy and ai.txt carry no em/en dash
 *   5. the homepage emits no single-item BreadcrumbList
 *   6. /jobs/new-grad shows exact counts
 *   7. pSEO count copy agrees in number
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
    workModeFlagsFor,
    planExclusiveWorkModeRepair,
    normalizeIngestedTitle,
} from '@/lib/ingestion-service';
import { buildJobIdentityKey } from '@/lib/deduplicator';
import { crumbHref, normalizeCrumbs } from '@/components/CategoryHero';
import { pluralize, formatCount, isAre, cappedCount } from '@/lib/pseo/plural';
import { formatStatsBadge } from '@/lib/pseo/category-city-template';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DASH_RE = /[–—]/;

describe('1. exclusive work-mode flags', () => {
    it('maps each canonical mode to exactly one flag pair', () => {
        expect(workModeFlagsFor('Remote')).toEqual({ isRemote: true, isHybrid: false });
        expect(workModeFlagsFor('Hybrid')).toEqual({ isRemote: false, isHybrid: true });
        expect(workModeFlagsFor('In-Person')).toEqual({ isRemote: false, isHybrid: false });
        expect(workModeFlagsFor(null)).toEqual({ isRemote: false, isHybrid: false });
    });

    it('the LLM merge no longer ORs isHybrid onto a stale isRemote', () => {
        const src = read('lib/ingestion-service.ts');
        expect(src).not.toMatch(/if \(canon === 'Hybrid'\) next\.isHybrid = true;/);
        expect(src).toMatch(/next\.isRemote = flags\.isRemote;\s*next\.isHybrid = flags\.isHybrid;/);
    });

    it('plans a repair only for double-flagged stored rows', () => {
        expect(planExclusiveWorkModeRepair({ mode: 'Remote', isRemote: true, isHybrid: false })).toBeNull();
        expect(planExclusiveWorkModeRepair({ mode: 'Hybrid', isRemote: true, isHybrid: true }))
            .toEqual({ isRemote: false, isHybrid: true });
        expect(planExclusiveWorkModeRepair({ mode: 'Remote', isRemote: true, isHybrid: true }))
            .toEqual({ isRemote: true, isHybrid: false });
        expect(planExclusiveWorkModeRepair({ mode: null, isRemote: true, isHybrid: true }))
            .toEqual({ isRemote: false, isHybrid: true });
    });

    it('a backfill script exists for already-ingested rows', () => {
        const script = read('scripts/backfill-exclusive-work-mode-flags.ts');
        expect(script).toContain('planExclusiveWorkModeRepair');
        expect(script).toContain('--apply');
    });
});

describe('2. CategoryHero breadcrumb links', () => {
    const base = 'https://nphiring.com';

    it('turns same-site absolute schema URLs into relative hrefs', () => {
        expect(crumbHref(base, base)).toBe('/');
        expect(crumbHref(`${base}/jobs`, base)).toBe('/jobs');
        expect(crumbHref('/jobs/state/texas', base)).toBe('/jobs/state/texas');
    });

    it('never links off site', () => {
        expect(crumbHref('https://evil.example/jobs', base)).toBeNull();
        expect(crumbHref('//evil.example/jobs', base)).toBeNull();
        expect(crumbHref(`${base}.evil.example/jobs`, base)).toBeNull();
        expect(crumbHref(undefined, base)).toBeNull();
    });

    it('links ancestors and leaves the current page unlinked', () => {
        const crumbs = normalizeCrumbs([
            { label: 'Home', href: base },
            { label: 'Jobs', href: `${base}/jobs` },
            { label: 'Remote', href: `${base}/jobs/remote` },
        ], base);
        expect(crumbs).toEqual([
            { label: 'Home', href: '/' },
            { label: 'Jobs', href: '/jobs' },
            { label: 'Remote', href: null },
        ]);
        expect(normalizeCrumbs(['A', 'B'], base).every((c) => c.href === null)).toBe(true);
    });

    it('renders an <a> for linked crumbs', () => {
        const src = read('components/CategoryHero.tsx');
        expect(src).toMatch(/<Link href=\{href\} className="cath5-crumb-link">/);
    });

    it('the category landing template feeds the hero from the schema array', () => {
        const src = read('lib/pseo/category-landing-template.tsx');
        expect(src).toContain('<BreadcrumbSchema items={breadcrumbTrail} />');
        expect(src).toContain('breadcrumbs={breadcrumbTrail.map((crumb) => ({ label: crumb.name, href: crumb.url }))}');
    });
});

describe('3. multi-state ingested titles', () => {
    const base = 'Staff Psychiatric Mental Health Nurse Practitioner (PMHNP) — Remote | Telehealth | Full-Time or Part-Time';

    it('drops a trailing jurisdiction segment and the em dash', () => {
        const expected = 'Staff Psychiatric Mental Health Nurse Practitioner (PMHNP) - Remote | Telehealth | Full-Time or Part-Time';
        expect(normalizeIngestedTitle(`${base} | Commonwealth of the Northern Mariana Islands`)).toBe(expected);
        expect(normalizeIngestedTitle(`${base} | District of Columbia`)).toBe(expected);
        expect(normalizeIngestedTitle(`${base} | USA`)).toBe(expected);
        expect(normalizeIngestedTitle(`${base} | Texas`)).toBe(expected);
        expect(normalizeIngestedTitle(`${base} | Commonwealth of Puerto Rico`)).toBe(expected);
    });

    it('collapses per-state copies onto one dedup identity key', () => {
        const keys = new Set(
            ['Commonwealth of the Northern Mariana Islands', 'District of Columbia', 'USA'].map((j) =>
                buildJobIdentityKey(normalizeIngestedTitle(`${base} | ${j}`), 'Legion Health', 'Austin, Texas'),
            ),
        );
        expect(keys.size).toBe(1);
    });

    it('keeps non-jurisdiction segments and single-segment titles', () => {
        expect(normalizeIngestedTitle('Nurse Practitioner | Texas Oncology')).toBe('Nurse Practitioner | Texas Oncology');
        expect(normalizeIngestedTitle('Texas')).toBe('Texas');
        expect(normalizeIngestedTitle('PMHNP - Remote')).toBe('PMHNP - Remote');
        expect(normalizeIngestedTitle('PMHNP – Dallas, TX')).toBe('PMHNP - Dallas, TX');
    });

    it('is applied before dedup on insert and on the preloaded identity map', () => {
        const src = read('lib/ingestion-service.ts');
        expect(src).toContain('title: normalizeIngestedTitle(normalizeResult.job.title)');
        expect(src).toContain('buildJobIdentityKey(normalizeIngestedTitle(job.title), job.employer, job.location)');
    });
});

describe('4. feed.xml and ai.txt dashes', () => {
    it('channel title and description are dash-free', () => {
        const src = read('app/feed.xml/route.ts');
        const channel = src.slice(src.indexOf('<channel>'), src.indexOf('${items}'));
        expect(channel).not.toMatch(DASH_RE);
        expect(src).toContain('feedText(`${job.title} at ${job.employer}${salary}`)');
        expect(src).not.toMatch(/export function feedText/);
    });

    it('ai.txt carries no em or en dash', () => {
        expect(read('public/ai.txt')).not.toMatch(DASH_RE);
    });
});

describe('5. homepage breadcrumb schema', () => {
    it('app/page.tsx emits no BreadcrumbList', () => {
        expect(read('app/page.tsx')).not.toContain("'@type': 'BreadcrumbList'");
    });
});

describe('6. /jobs/new-grad exact counts', () => {
    it('does not pad totalJobs with "+"', () => {
        const src = read('app/jobs/new-grad/page.tsx');
        expect(src).not.toContain('${stats.totalJobs}+');
        expect(src).not.toContain('{stats.totalJobs}+');
    });
});

describe('7. pSEO count agreement', () => {
    it('pluralizes by count', () => {
        expect(pluralize(1, 'position')).toBe('position');
        expect(pluralize(0, 'position')).toBe('positions');
        expect(formatCount(2, 'role')).toBe('2 roles');
        expect(isAre(1)).toBe('is');
        expect(isAre(3)).toBe('are');
        expect(cappedCount(3, 8)).toBe('3');
        expect(cappedCount(8, 8)).toBe('8+');
    });

    it('the stats badge reads "1 live role"', () => {
        expect(formatStatsBadge(1, new Date('2026-01-02T00:00:00Z'))).toMatch(/^1 live role ·/);
        expect(formatStatsBadge(4, new Date('2026-01-02T00:00:00Z'))).toMatch(/^4 live roles ·/);
    });

    it('templates no longer hardcode plural count labels', () => {
        for (const rel of [
            'lib/pseo/setting-state-template.tsx',
            'lib/pseo/category-landing-template.tsx',
            'lib/pseo/category-city-template.tsx',
            'app/jobs/new-grad/page.tsx',
        ]) {
            const src = read(rel);
            expect(src, rel).not.toMatch(/label: '(positions|employers)'/);
            if (/\$\{(stats\.)?totalJobs\} live roles/.test(src)) {
                // A literal plural is allowed only behind an explicit singular branch.
                expect(src, rel).toMatch(/totalJobs === 1\s*\?\s*'1 live role/);
            }
        }
        const faq = read('lib/pseo/category-faq-data.ts');
        expect(faq).not.toContain('There are currently ${totalJobs}');
    });
});
