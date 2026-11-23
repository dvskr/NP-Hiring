/**
 * 2026-11-23: three reads that ran on every render now come through the
 * shared data cache (lib/data-cache.ts), because each took 1.7 to 2.4 s on
 * the production database and together they were over a quarter of its time:
 *
 *  - every live company with its job count, read to resolve ONE company
 *    profile slug (app/companies/[slug]/live-companies.ts);
 *  - the homepage's top states and its employer strip
 *    (components/TopStatesSection.tsx, components/EmployerTrustSection.tsx).
 *
 * A page's cache window is the shortest one in its tree, so each of these
 * must be cached at least as long as the page that reads it
 * (tests/regressions/job-page-isr-window.test.ts has the story).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/prisma', () => ({
    prisma: { company: { findMany: vi.fn(), findUnique: vi.fn() }, job: { groupBy: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import {
    LIVE_COMPANY_DIRECTORY_CACHE_SECONDS,
    LIVE_COMPANY_RECHECK_CACHE_SECONDS,
    loadLiveCompanies,
    readLiveCompanies,
} from '@/app/companies/[slug]/live-companies';
import { TOP_STATES_CACHE_SECONDS } from '@/components/TopStatesSection';
import { EMPLOYER_STRIP_CACHE_SECONDS } from '@/components/EmployerTrustSection';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function pageWindow(rel: string): number {
    const match = read(rel).match(/^export const revalidate = (\d+);/m);
    expect(match, `${rel} exports a numeric revalidate`).not.toBeNull();
    return Number(match![1]);
}

interface SourceFile { file: string; text: string }
const scanned = new Map<string, SourceFile[]>();

/** Every TypeScript file under a top-level folder, read once however many tests ask. */
function sources(dir: string): SourceFile[] {
    const known = scanned.get(dir);
    if (known) return known;
    const files = fs.readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })
        .filter((file) => /\.(tsx|ts)$/.test(file))
        .map((file) => ({ file: `${dir}/${file.replace(/\\/g, '/')}`, text: read(path.join(dir, file)) }));
    scanned.set(dir, files);
    return files;
}

// Reading a whole folder takes seconds on a busy Windows disk.
const SCAN_TIMEOUT_MS = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe('the live company directory', () => {
    it('is cached at least as long as the profile page that reads it', () => {
        expect(LIVE_COMPANY_DIRECTORY_CACHE_SECONDS).toBeGreaterThanOrEqual(pageWindow('app/companies/[slug]/page.tsx'));
        expect(read('app/companies/[slug]/live-companies.ts')).toMatch(
            /sharedCachedRead\(\s*readLiveCompanies,\s*\['live-company-directory', 'v1'\],\s*LIVE_COMPANY_DIRECTORY_CACHE_SECONDS,\s*\)/,
        );
    });

    it('is what the profile route resolves a slug against, with no directory query of its own', () => {
        const page = read('app/companies/[slug]/page.tsx');
        expect(page).toContain('const candidates = await loadLiveCompanies();');
        expect(page).not.toMatch(/jobs:\s*\{\s*some:\s*liveWhere/);
    });

    it('has a five-minute second copy, read only for a slug the hourly copy does not know', () => {
        // Its window is shorter than the page's on purpose: a page that reads
        // it is regenerated that often, so it must stay behind the miss.
        expect(LIVE_COMPANY_RECHECK_CACHE_SECONDS).toBe(300);
        expect(LIVE_COMPANY_RECHECK_CACHE_SECONDS).toBeLessThan(pageWindow('app/companies/[slug]/page.tsx'));
        expect(read('app/companies/[slug]/live-companies.ts')).toMatch(
            /sharedCachedRead\(\s*readLiveCompanies,\s*\['live-company-directory-recheck', 'v1'\],\s*LIVE_COMPANY_RECHECK_CACHE_SECONDS,\s*\)/,
        );
        const page = read('app/companies/[slug]/page.tsx');
        const calls = [...page.matchAll(/loadLiveCompaniesAfterMiss\(\)/g)];
        expect(calls).toHaveLength(1);
        const hit = page.indexOf("if (match) return { kind: 'profile', normalizedName: match.normalizedName };");
        expect(hit).toBeGreaterThan(-1);
        expect(calls[0].index).toBeGreaterThan(hit);
    });

    it('lists each live company with its live job count, under the profile page\'s own predicate', async () => {
        db.company.findMany.mockResolvedValue([
            { name: 'One Medical', normalizedName: 'one', _count: { jobs: 89 } },
            { name: 'LifeStance Health', normalizedName: 'life-stance', _count: { jobs: 314 } },
        ]);
        expect(await readLiveCompanies()).toEqual([
            { name: 'One Medical', normalizedName: 'one', activeJobs: 89 },
            { name: 'LifeStance Health', normalizedName: 'life-stance', activeJobs: 314 },
        ]);
        const args = db.company.findMany.mock.calls[0][0];
        const live = activeIndexableJobWhere(new Date());
        expect(Object.keys(args.where.jobs.some).sort()).toEqual(Object.keys(live).sort());
        expect(args.select._count.select.jobs.where).toEqual(args.where.jobs.some);
        expect(Object.keys(args.select).sort()).toEqual(['_count', 'name', 'normalizedName']);
    });

    it('lets a failed read through when there is no cached copy (a 5xx, never a cached 404)', async () => {
        db.company.findMany.mockRejectedValue(new Error('timeout exceeded when trying to connect'));
        await expect(loadLiveCompanies()).rejects.toThrow('timeout exceeded when trying to connect');
    });
});

describe('the homepage sections', () => {
    it('cache their grouped reads at least as long as the homepage, which alone renders them', () => {
        const homepage = pageWindow('app/page.tsx');
        expect(TOP_STATES_CACHE_SECONDS).toBeGreaterThanOrEqual(homepage);
        expect(EMPLOYER_STRIP_CACHE_SECONDS).toBeGreaterThanOrEqual(homepage);
        // A page with a longer window than these caches must not render them.
        const importers = sources('app')
            .filter(({ text }) => /components\/(EmployerTrustSection|TopStatesSection)'/.test(text))
            .map(({ file }) => file);
        expect(importers).toEqual(['app/page.tsx']);
    }, SCAN_TIMEOUT_MS);

    it('read through the shared cache, each under its own key', () => {
        expect(read('components/TopStatesSection.tsx')).toMatch(
            /sharedCachedRead\(readTopStateCounts, \['homepage-top-state-counts', 'v1'\], TOP_STATES_CACHE_SECONDS\)/,
        );
        expect(read('components/EmployerTrustSection.tsx')).toMatch(
            /sharedCachedRead\(readEmployerChips, \['homepage-employer-chips', 'v1'\], EMPLOYER_STRIP_CACHE_SECONDS\)/,
        );
    });
});

describe('every shared read', () => {
    it('has its own name and a version of its value\'s shape, because the data cache outlives a deploy', () => {
        // The cache key is the key parts and the arguments, nothing else
        // (lib/data-cache.ts). A release that changes what a read returns
        // must raise the version, or it is handed the old release's values.
        const calls = ['app', 'components', 'lib'].flatMap(sources)
            .filter(({ file }) => file !== 'lib/data-cache.ts')
            .flatMap(({ file, text }) =>
                [...text.matchAll(/sharedCachedRead\(\s*\w+,\s*\[([^\]]*)\]/g)].map((match) => ({ file, keyParts: match[1] })));
        expect(calls.map((call) => call.keyParts.split(',')[0]).sort()).toEqual([
            "'homepage-employer-chips'",
            "'homepage-top-state-counts'",
            "'jobs-board-count'",
            "'jobs-board-rows'",
            "'live-company-directory'",
            "'live-company-directory-recheck'",
        ]);
        for (const { file, keyParts } of calls) {
            expect(keyParts, file).toMatch(/^'[a-z-]+', 'v\d+'(, [A-Z_]+)?$/);
        }
    }, SCAN_TIMEOUT_MS);
});
