/**
 * 2026-11-27: on Nov 26 a burst on /jobs/city/[slug] filled the database
 * pooler's 200 clients and the route answered 5xx to almost every request.
 * Two changes make an uncached city page cheaper:
 *
 *  - the state's town groups (the one read that does not depend on the city)
 *    come through the shared data cache, once per state per window, instead
 *    of a grouped read over the whole state on every city page;
 *  - jobs.state_code has an index, so the (state OR state_code) filter that
 *    every city, state and directory read carries can use both indexes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/prisma', () => ({ prisma: { job: { groupBy: vi.fn() } } }));

import { prisma } from '@/lib/prisma';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAGE = 'app/jobs/city/[slug]/page.tsx';
const GROUPS = 'app/jobs/city/[slug]/state-city-groups.ts';
const MIGRATION = 'prisma/migrations/20261127000000_add_jobs_state_code_idx/migration.sql';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe('the city page state town groups', () => {
    it('are read through the shared cache, at least as long as the page itself', async () => {
        const window = Number(read(PAGE).match(/^export const revalidate = (\d+);/m)![1]);
        const groups = read(GROUPS);
        expect(groups).toMatch(
            /sharedCachedRead\(\s*readStateCityGroups,\s*\['city-page-state-city-groups', 'v1'\],\s*STATE_CITY_GROUPS_CACHE_SECONDS,\s*\)/,
        );
        expect(Number(groups.match(/export const STATE_CITY_GROUPS_CACHE_SECONDS = (\d+);/)![1]))
            .toBeGreaterThanOrEqual(window);
    });

    it('are what the page links from, so a city page never groups the state itself', () => {
        const page = read(PAGE);
        expect(page).not.toMatch(/prisma\.job\.groupBy\(/);
        const links = page.slice(page.indexOf('async function getStateCityLinks'));
        expect(links.slice(0, links.indexOf('\n}\n'))).toContain('await stateCityGroups(city.stateName, city.stateCode)');
    }, 60_000);

    it('group the state by town under the canonical predicate and keep only town names', async () => {
        db.job.groupBy.mockResolvedValue([
            { city: 'Austin', _count: { city: 40 } },
            { city: 'Remote', _count: { city: 12 } },
            { city: null, _count: { city: 3 } },
            { city: 'Dallas', _count: { city: 9 } },
        ]);
        const { readStateCityGroups } = await import('@/app/jobs/city/[slug]/state-city-groups');

        const rows = await readStateCityGroups('Texas', 'TX');

        expect(rows).toEqual([{ city: 'Austin', count: 40 }, { city: 'Dallas', count: 9 }]);
        const query = db.job.groupBy.mock.calls[0][0];
        expect(query.by).toEqual(['city']);
        expect(JSON.stringify(query.where)).toContain('"OR":[{"state":"Texas"},{"stateCode":"TX"}]');
    }, 60_000);
});

describe('the jobs.state_code index', () => {
    it('is in the schema and built by its own migration, with a short lock wait', () => {
        const schema = read('prisma/schema.prisma');
        const job = schema.slice(schema.indexOf('model Job {'));
        expect(job.slice(0, job.indexOf('\n}\n'))).toContain('@@index([stateCode])');

        const sql = read(MIGRATION).split('\n').filter((line) => !line.startsWith('--')).join('\n');
        expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
        expect(sql).toContain('CREATE INDEX IF NOT EXISTS "jobs_state_code_idx" ON "jobs"("state_code");');
        expect(sql).not.toMatch(/CONCURRENTLY|DROP|ALTER/i);
    });
});
