/**
 * /salary-guide/[state] indexes on the cited BLS state median (salary build
 * 2026-11, spec Item 1). Before it, a state page indexed only when its
 * posted-pay median cleared the publishing gate, so 50 of 51 pages were
 * noindex while every one of them can answer "NP salary in {State}" with a
 * cited BLS figure. Run through the page's own generateMetadata over mocked
 * data: the robots verdict, the title figure and the description.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/pseo/listing-facts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/pseo/listing-facts')>();
    return { ...actual, getListingFacts: vi.fn() };
});
vi.mock('@/lib/salary-analytics', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/salary-analytics')>();
    return { ...actual, getGatedLocationSalary: vi.fn() };
});

import { generateMetadata } from '@/app/salary-guide/[state]/page';
import { emptyListingFacts, getListingFacts } from '@/lib/pseo/listing-facts';
import { getGatedLocationSalary, type GatedSalary } from '@/lib/salary-analytics';
import { BLS_STATE_WAGES } from '@/lib/salary-guide-bls-states';

/** The first import of the page pulls its whole component tree. */
const IMPORT_TIMEOUT_MS = 60_000;

// Two employers: below the count tier (3), so nothing is published.
const BELOW_GATE: GatedSalary = {
    postings: 2,
    employers: 2,
    tier: 'none',
    gatePassed: false,
    median: null,
    p25: null,
    p75: null,
    medianK: null,
    p25K: null,
    p75K: null,
};

async function metadataFor(slug: string, total: number) {
    vi.mocked(getListingFacts).mockResolvedValue({ ...emptyListingFacts(new Date('2026-11-25T00:00:00Z')), total, distinctEmployers: Math.min(total, 3) });
    vi.mocked(getGatedLocationSalary).mockResolvedValue(BELOW_GATE);
    return generateMetadata({ params: Promise.resolve({ state: slug }) });
}

describe('salary guide state pages index on the BLS state median', () => {
    beforeEach(() => vi.clearAllMocks());

    it('a state with open roles and no posted median indexes, titled by its BLS figure', async () => {
        const meta = await metadataFor('texas', 3);
        expect(meta.robots).toEqual({ index: true, follow: true });
        const k = Math.round((BLS_STATE_WAGES.Texas.annualMedian.value as number) / 1000);
        expect(meta.title).toBe(`Nurse Practitioner Salary in Texas: $${k}K Median`);
        expect(String(meta.description)).toContain('BLS May 2025 median annual wage');
        expect(String(meta.description)).toContain('$131,670');
    }, IMPORT_TIMEOUT_MS);

    it('every one of the 51 jurisdictions indexes at one open role, with the figure in its title', async () => {
        for (const row of Object.values(BLS_STATE_WAGES)) {
            const meta = await metadataFor(row.slug, 1);
            expect(meta.robots, row.state).toEqual({ index: true, follow: true });
            expect(String(meta.title), row.state).toContain(`$${Math.round((row.annualMedian.value as number) / 1000)}K Median`);
        }
    }, IMPORT_TIMEOUT_MS);

    it('a state with no open roles stays noindex (the page itself 404s at zero)', async () => {
        const meta = await metadataFor('wyoming', 0);
        expect(meta.robots).toEqual({ index: false, follow: true });
    }, IMPORT_TIMEOUT_MS);
});
