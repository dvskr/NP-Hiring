/**
 * /api/og/city printed every salary value under "Salary Range", but the metro
 * guide sends one gated median (formatK(benchmark.median)), and a median is
 * not a range. The route now takes `?label=` from a small allow-list
 * (app/api/og/city/salary-label.ts), defaults to the old label so the city
 * and category pages' URLs render as before, and the metro guide asks for
 * "Median Posted Pay".
 *
 * The median label was first written as "Median Salary". The figure is the
 * median of the pay employers posted, not of what NPs earn, and the metro
 * page's own hero stat already calls it "median posted pay", so the card
 * named one number a second way. The old wording is off the allow-list (the
 * param never reached production, so no URL carries it), and the label is
 * pinned to the hero's words.
 *
 * The route is run for real with next/og's ImageResponse replaced by a stub
 * that keeps the element tree, which is rendered to markup to read the tile.
 * The logo fetch is stubbed, and the metro page's facts loader is mocked, so
 * nothing here touches the network or a database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

const captured = vi.hoisted(() => ({
    element: null as unknown,
    init: null as { width?: number; height?: number; headers?: Record<string, string> } | null,
}));

vi.mock('next/og', () => ({
    ImageResponse: class {
        constructor(element: unknown, init: { width?: number; height?: number; headers?: Record<string, string> }) {
            captured.element = element;
            captured.init = init;
        }
    },
}));

vi.mock('@/lib/pseo/listing-facts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/pseo/listing-facts')>();
    return { ...actual, getListingFacts: vi.fn() };
});

import { GET } from '@/app/api/og/city/route';
import { OG_CACHE_HEADERS, OG_SIZE } from '@/app/api/og/og-theme';
import { OG_CITY_SALARY_LABELS, resolveOgCitySalaryLabel } from '@/app/api/og/city/salary-label';
import { generateMetadata as metroMetadata } from '@/app/jobs/metro/[slug]/page';
import { getListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import type { BenchmarkRow } from '@/components/tools/benchmark-model';

/** The first import of the metro page pulls its whole component tree. */
const IMPORT_TIMEOUT_MS = 60_000;

const RANGE = OG_CITY_SALARY_LABELS.range;
const MEDIAN = OG_CITY_SALARY_LABELS.median;

/** The label this branch first gave the median tile; rejected now. */
const RETIRED_MEDIAN_LABEL = 'Median Salary';

const METRO_PAGE = 'app/jobs/metro/[slug]/page.tsx';

/**
 * A card query string, encoded the way the callers build theirs
 * (URLSearchParams), so no test types a label by hand.
 */
const cardQuery = (params: Record<string, string>): string => new URLSearchParams(params).toString();

/** Render the card for a query string and return its markup. */
async function renderCard(query: string): Promise<string> {
    captured.element = null;
    await GET(new NextRequest(`https://nphiring.com/api/og/city?${query}`));
    expect(captured.element, 'the route built no image').not.toBeNull();
    return renderToStaticMarkup(captured.element as ReactElement);
}

/** The text of the tile's small uppercase label line, wherever it sits in the markup. */
const hasText = (html: string, text: string): boolean => html.includes(`>${text}<`);

beforeEach(() => {
    // The route fetches its logo from the fixed origin; answer it offline so
    // the card falls back to the wordmark.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('resolveOgCitySalaryLabel: an allow-list, not free text', () => {
    it('names the range and the median of posted pay', () => {
        // Typed out on purpose: these two strings are share-card copy.
        expect(RANGE).toBe('Salary Range');
        expect(MEDIAN).toBe('Median Posted Pay');
    });

    it('keeps an allowed label exactly as sent', () => {
        expect(resolveOgCitySalaryLabel(MEDIAN)).toBe(MEDIAN);
        expect(resolveOgCitySalaryLabel(RANGE)).toBe(RANGE);
    });

    it('falls back to the range label when the param is missing, unknown, retired or a near miss', () => {
        for (const raw of [null, '', MEDIAN.toLowerCase(), ` ${MEDIAN}`, RETIRED_MEDIAN_LABEL, 'Guaranteed Pay', '<b>Median</b>']) {
            expect(resolveOgCitySalaryLabel(raw), String(raw)).toBe(RANGE);
        }
    });

    it('names the median the way the metro hero does, so card and page agree', () => {
        // The hero stat that prints the same gated median (buildHeroStats).
        const page = fs.readFileSync(path.join(process.cwd(), METRO_PAGE), 'utf8');
        const heroLabel = page.match(/value: formatK\(facts\.benchmark\.median\), label: '([^']+)'/)?.[1];
        expect(heroLabel, `${METRO_PAGE} no longer prints the median as a hero stat`).toBeDefined();
        expect(MEDIAN.toLowerCase()).toBe(heroLabel);
    });
});

describe('/api/og/city salary tile label', () => {
    it('prints "Salary Range" when no label is sent, as every caller got before', async () => {
        const html = await renderCard(cardQuery({ city: 'Austin, TX', jobs: '12', salary: '$118K' }));
        expect(hasText(html, RANGE)).toBe(true);
        expect(hasText(html, MEDIAN)).toBe(false);
        expect(html).toContain('$118K');
    });

    it('prints "Median Posted Pay" when the caller sends that label', async () => {
        const html = await renderCard(cardQuery({ city: 'Boston, MA', jobs: '40', salary: '$131K', label: MEDIAN }));
        expect(hasText(html, MEDIAN)).toBe(true);
        expect(hasText(html, RANGE)).toBe(false);
        expect(html).toContain('$131K');
    });

    it.each(['Guaranteed Pay', RETIRED_MEDIAN_LABEL])('never prints "%s", which is not on the allow-list', async (label) => {
        const html = await renderCard(cardQuery({ city: 'Boston, MA', jobs: '40', salary: '$131K', label }));
        expect(html).not.toContain(label);
        expect(hasText(html, RANGE)).toBe(true);
    });

    it('drops the tile, label and all, when no salary is sent', async () => {
        const html = await renderCard(cardQuery({ city: 'Boston, MA', jobs: '40', label: MEDIAN }));
        expect(hasText(html, MEDIAN)).toBe(false);
        expect(hasText(html, RANGE)).toBe(false);
    });

    it('keeps the shared size and edge cache headers', async () => {
        await renderCard(cardQuery({ city: 'Boston, MA', jobs: '40', salary: '$131K', label: MEDIAN }));
        expect(captured.init?.width).toBe(OG_SIZE.width);
        expect(captured.init?.height).toBe(OG_SIZE.height);
        expect(captured.init?.headers).toEqual({ ...OG_CACHE_HEADERS });
    });
});

describe('the metro guide asks for the median label', () => {
    const BOSTON = 'boston-ma';
    const benchmark: BenchmarkRow = { scope: 'Boston', median: 131_000, p25: 112_000, p75: 150_000, postings: 12, employers: 5 };
    const facts = (row: BenchmarkRow | null): ListingFacts =>
        ({ total: 40, distinctPostings: 38, recency: { last30: 9 }, benchmark: row }) as unknown as ListingFacts;

    async function cardUrl(): Promise<URL> {
        const meta = await metroMetadata({ params: Promise.resolve({ slug: BOSTON }) });
        const images = meta.openGraph?.images as Array<{ url: string }>;
        expect(meta.twitter?.images, 'og and twitter share one card URL').toEqual([images[0].url]);
        return new URL(images[0].url, 'https://nphiring.com');
    }

    it('sends the gated median under "Median Posted Pay", and the card prints it that way', async () => {
        vi.mocked(getListingFacts).mockResolvedValue(facts(benchmark));
        const url = await cardUrl();
        expect(url.pathname).toBe('/api/og/city');
        expect(url.searchParams.get('salary')).toBe('$131K');
        expect(url.searchParams.get('label')).toBe(MEDIAN);

        const html = await renderCard(url.searchParams.toString());
        expect(hasText(html, MEDIAN)).toBe(true);
        expect(hasText(html, RANGE)).toBe(false);
    }, IMPORT_TIMEOUT_MS);

    it('sends neither salary nor label below the benchmark gate', async () => {
        vi.mocked(getListingFacts).mockResolvedValue(facts(null));
        const url = await cardUrl();
        expect(url.searchParams.has('salary')).toBe(false);
        expect(url.searchParams.has('label')).toBe(false);
    }, IMPORT_TIMEOUT_MS);
});
