import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ADZUNA_MAX_CALLS_PER_RUN,
    ADZUNA_MAX_PAGES_PER_QUERY,
    fetchAdzunaJobs,
} from '@/lib/aggregators/adzuna';
import { ADZUNA_SEARCH_QUERIES } from '@/lib/aggregators/search-terms/adzuna';

/**
 * The Adzuna allowance is per API call and the account does not report it,
 * so the adapter's call budget is the only thing keeping a run inside it.
 */

function fullPage(query: string, page: number) {
    return {
        count: 100_000,
        results: Array.from({ length: 50 }, (_, i) => ({
            id: `${query}-${page}-${i}`,
            title: 'Nurse Practitioner',
            company: { display_name: 'Clinic' },
            location: { display_name: 'Austin, Travis County', area: ['US', 'Texas', 'Travis County', 'Austin'] },
            description: 'x',
            redirect_url: `https://www.adzuna.com/land/ad/${query}-${page}-${i}`,
            created: '2026-11-12T00:00:00Z',
        })),
    };
}

describe('Adzuna adapter call budget', () => {
    const calls: URL[] = [];
    let respond: (url: URL) => Response;

    beforeEach(() => {
        calls.length = 0;
        process.env.ADZUNA_APP_ID = 'id';
        process.env.ADZUNA_APP_KEY = 'key';
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', async (input: string) => {
            const url = new URL(input);
            calls.push(url);
            return respond(url);
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        delete process.env.ADZUNA_APP_ID;
        delete process.env.ADZUNA_APP_KEY;
    });

    it('searches titles only, never the description', async () => {
        respond = () => Response.json({ count: 0, results: [] });
        await fetchAdzunaJobs(0);
        expect(calls).toHaveLength(ADZUNA_SEARCH_QUERIES.length);
        for (const url of calls) {
            expect(url.searchParams.get('title_only')).toBeTruthy();
            expect(url.searchParams.has('what')).toBe(false);
        }
    });

    it('stops at the per-run call budget even when every page is full', async () => {
        respond = (url) => {
            const page = Number(url.pathname.split('/').pop());
            return Response.json(fullPage(url.searchParams.get('title_only') ?? '', page));
        };
        const jobs = await fetchAdzunaJobs(0);
        expect(calls).toHaveLength(ADZUNA_MAX_CALLS_PER_RUN);
        const firstQueryCalls = calls.filter(
            (u) => u.searchParams.get('title_only') === ADZUNA_SEARCH_QUERIES[0],
        );
        expect(firstQueryCalls).toHaveLength(ADZUNA_MAX_PAGES_PER_QUERY);
        expect(jobs).toHaveLength(ADZUNA_MAX_CALLS_PER_RUN * 50);
    });

    it('makes no further request once Adzuna refuses the quota', async () => {
        respond = (url) => {
            const page = Number(url.pathname.split('/').pop());
            if (calls.length >= 3) return new Response('too many', { status: 429 });
            return Response.json(fullPage(url.searchParams.get('title_only') ?? '', page));
        };
        const jobs = await fetchAdzunaJobs(0);
        expect(calls).toHaveLength(3);
        expect(jobs).toHaveLength(100);
    });
});
