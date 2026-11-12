/**
 * Workable list paging (lib/aggregators/workable.ts).
 *
 * The board endpoint returns 10 postings a page, ignores limit/offset and
 * pages by a `nextPage` cursor sent back as `token`. Until 2026-11-12 the
 * adapter paged by offset and stopped at the first page shorter than 100, so
 * it read 10 postings per board. These tests drive the two-step read against
 * a fake board: no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
// No real tenants: fetchWorkableJobs() is called only to start a fresh run.
vi.mock('@/lib/aggregators/tenants/workable', () => ({ WORKABLE_TENANTS: [] }));

import {
    collectWorkablePostings,
    fetchWorkableJobs,
    WORKABLE_BROWSE_PAGES,
    WORKABLE_MAX_LIST_REQUESTS_PER_TENANT,
    WORKABLE_MAX_PAGES_PER_QUERY,
    WORKABLE_SEARCH_QUERIES,
} from '@/lib/aggregators/workable';

interface Posting { shortcode: string; title: string }
interface Call { query: string; token?: string }

const PAGE = 10;
const tenant = { slug: 'acme-health', name: 'Acme Health' };

/** A fake board: `postings` newest first; a query matches on the title. */
function fakeBoard(postings: Posting[], opts: { rateLimitAtCall?: number } = {}) {
    const calls: Call[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Call;
        calls.push({ query: body.query, token: body.token });
        if (opts.rateLimitAtCall !== undefined && calls.length >= opts.rateLimitAtCall) {
            return new Response('slow down', { status: 429 });
        }
        const matching = body.query
            ? postings.filter((p) => p.title.toLowerCase().includes(body.query.toLowerCase()))
            : postings;
        const start = body.token ? Number(body.token) : 0;
        const results = matching.slice(start, start + PAGE);
        const next = start + PAGE < matching.length ? String(start + PAGE) : undefined;
        return new Response(JSON.stringify({ total: matching.length, results, nextPage: next }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { calls };
}

const staff = (n: number, from = 0): Posting[] =>
    Array.from({ length: n }, (_, i) => ({ shortcode: `RN${from + i}`, title: `Registered Nurse ${from + i}` }));
const nps = (n: number): Posting[] =>
    Array.from({ length: n }, (_, i) => ({ shortcode: `NP${i}`, title: `Nurse Practitioner - Clinic ${i}` }));

beforeEach(async () => {
    // A run clears the rate-limit flag when it starts; start one (over the
    // empty tenant list mocked above) so each test begins clean.
    await fetchWorkableJobs();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('collectWorkablePostings', () => {
    it('reads past the first page by sending the cursor back as token', async () => {
        const { calls } = fakeBoard(staff(25));
        const postings = await collectWorkablePostings(tenant, 0);
        expect(postings).toHaveLength(25);
        expect(calls).toEqual([
            { query: '', token: undefined },
            { query: '', token: '10' },
            { query: '', token: '20' },
        ]);
    });

    it('reads a small board whole and runs no keyword search', async () => {
        const { calls } = fakeBoard([...nps(4), ...staff(8)]);
        const postings = await collectWorkablePostings(tenant, 0);
        expect(postings).toHaveLength(12);
        expect(calls.every((call) => call.query === '')).toBe(true);
        expect(calls).toHaveLength(2);
    });

    it('finds NP postings deep in a large board through the keyword searches', async () => {
        // 300 staff-nurse postings first, 40 NP postings after them: far past
        // the browse pages, which is where the old adapter never looked.
        const { calls } = fakeBoard([...staff(300), ...nps(40)]);
        const postings = await collectWorkablePostings(tenant, 0);
        const npFound = postings.filter((p) => p.shortcode.startsWith('NP'));
        expect(npFound).toHaveLength(40);
        expect(calls.filter((call) => call.query === '')).toHaveLength(WORKABLE_BROWSE_PAGES);
        expect(new Set(calls.map((call) => call.query))).toEqual(new Set(['', ...WORKABLE_SEARCH_QUERIES]));
    });

    it('never repeats a posting that several searches return', async () => {
        fakeBoard([...staff(40), { shortcode: 'X1', title: 'APRN Nurse Practitioner, Advanced Practice' }]);
        const postings = await collectWorkablePostings(tenant, 0);
        expect(postings.filter((p) => p.shortcode === 'X1')).toHaveLength(1);
    });

    it('caps the pages of one search and the requests to one tenant', async () => {
        const { calls } = fakeBoard([...staff(50), ...nps(500)]);
        await collectWorkablePostings(tenant, 0);
        expect(calls.filter((call) => call.query === 'nurse practitioner')).toHaveLength(WORKABLE_MAX_PAGES_PER_QUERY);
        expect(calls.length).toBeLessThanOrEqual(WORKABLE_MAX_LIST_REQUESTS_PER_TENANT);
    });

    it('stops at the first 429 and sends nothing more, to this tenant or the next', async () => {
        const { calls } = fakeBoard([...staff(300), ...nps(40)], { rateLimitAtCall: 2 });
        const postings = await collectWorkablePostings(tenant, 0);
        expect(postings).toHaveLength(10);
        expect(calls).toHaveLength(2);

        await collectWorkablePostings({ slug: 'other', name: 'Other' }, 0);
        expect(calls).toHaveLength(2);
    });
});
