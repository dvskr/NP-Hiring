/**
 * PSEO-B blocker: a crawlable ?page value that does not parse answered 500.
 * The setting x state and category x city wrappers parsed the page with a
 * bare `parseInt(sp.page || '1')` and `Math.max(1, parseInt(...))`, so
 * ?page=abc (or ?page=%20) gave NaN, Math.max(1, NaN) is NaN, and the NaN
 * reached Prisma as `skip: NaN`, which throws (confirmed live on
 * /jobs/remote/california?page=abc). Every wrapper now reads the shared
 * parseListingPage for both the metadata and the page, and pageOffset
 * treats a page that is not a finite number as page 1.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    LISTING_PAGE_SIZE,
    MAX_LISTING_PAGE,
    isPageOutOfRange,
    pageOffset,
    parseListingPage,
} from '@/lib/pseo/listing-pagination';

/** Prisma's `skip` is a 64-bit signed integer; an offset at or above 2^63 throws before any query. */
const INT64_LIMIT = 2 ** 63;

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir: string): string[] {
    return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = path.posix.join(dir, entry.name);
        return entry.isDirectory() ? walk(rel) : [rel];
    });
}

/** Every listing wrapper that takes ?page: app/jobs/{x}/[state] and app/jobs/{x}/city/[slug]. */
const WRAPPERS = walk('app/jobs').filter((rel) =>
    /^app\/jobs\/[^/]+\/\[state\]\/page\.tsx$/.test(rel) || /^app\/jobs\/[^/]+\/city\/\[slug\]\/page\.tsx$/.test(rel),
).filter((rel) => !rel.startsWith('app/jobs/locations/'));

/** Every server or client file that reads a listing's ?page. */
const PAGE_READERS = [
    ...walk('app/jobs').filter((rel) => /\.(tsx|ts)$/.test(rel) && !rel.startsWith('app/jobs/[slug]/')),
    'app/blog/page.tsx',
    'app/companies/page.tsx',
];

describe('pageOffset never hands Prisma a NaN', () => {
    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -3])('page %s skips nothing', (page) => {
        expect(pageOffset(page)).toBe(0);
        expect(Number.isFinite(pageOffset(page, 50))).toBe(true);
    });

    it('a fractional page reads as its whole page', () => {
        expect(pageOffset(2.9)).toBe(LISTING_PAGE_SIZE);
        expect(pageOffset(3)).toBe(2 * LISTING_PAGE_SIZE);
    });
});

describe('parseListingPage reads any ?page value as a page number', () => {
    it.each([
        [undefined, 1],
        ['', 1],
        ['abc', 1],
        [' ', 1],
        ['%20', 1],
        ['NaN', 1],
        ['Infinity', 1],
        ['-2', 1],
        ['0', 1],
        ['1', 1],
        ['2', 2],
        ['7abc', 7],
        ['100000', MAX_LISTING_PAGE],
        ['100001', MAX_LISTING_PAGE],
    ] as const)('%j is page %i', (raw, page) => {
        expect(parseListingPage(raw)).toBe(page);
    });
});

/**
 * Reviewer blocker: ?page=1000000000000000000 parsed to 1e18, which is
 * finite and above 1, so it passed the NaN guard. pageOffset(1e18) was 3e19,
 * above int64, and Prisma threw "Unable to fit value ... into a 64-bit
 * signed integer for field `skip`" from the state hub's listing query, which
 * ran before its range check: the page answered 500.
 */
describe('an out-of-range page is capped, never an int64 overflow', () => {
    it('the cap sits far above any real listing, so a capped page is still past the end', () => {
        expect(MAX_LISTING_PAGE).toBe(100_000);
        expect(isPageOutOfRange(MAX_LISTING_PAGE, 638, 50)).toBe(true);
        expect(isPageOutOfRange(MAX_LISTING_PAGE, 65)).toBe(true);
    });

    it('parseListingPage caps a huge ?page at MAX_LISTING_PAGE', () => {
        expect(parseListingPage('1000000000000000000')).toBe(MAX_LISTING_PAGE);
        expect(parseListingPage('9'.repeat(19))).toBe(MAX_LISTING_PAGE);
        expect(parseListingPage('9'.repeat(400))).toBe(MAX_LISTING_PAGE);
        expect(parseListingPage(['1000000000000000000', '2'])).toBe(MAX_LISTING_PAGE);
    });

    it('a negative digit run too long for a double is still page 1', () => {
        expect(parseInt(`-${'9'.repeat(400)}`, 10)).toBe(Number.NEGATIVE_INFINITY);
        expect(parseListingPage(`-${'9'.repeat(400)}`)).toBe(1);
    });

    it('a huge ?page still 404s through isPageOutOfRange', () => {
        expect(isPageOutOfRange(parseListingPage('9'.repeat(19)), 500)).toBe(true);
        expect(isPageOutOfRange(parseListingPage('1000000000000000000'), 45, LISTING_PAGE_SIZE)).toBe(true);
    });

    it('pageOffset caps the page, so the offset is a safe integer inside int64', () => {
        expect(pageOffset(1e18)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
        expect(pageOffset(1e18)).toBe((MAX_LISTING_PAGE - 1) * LISTING_PAGE_SIZE);
        expect(pageOffset(Number.MAX_VALUE, 50)).toBe((MAX_LISTING_PAGE - 1) * 50);
        expect(Number.isSafeInteger(pageOffset(1e18, 50))).toBe(true);
        expect(pageOffset(1e18, 50)).toBeLessThan(INT64_LIMIT);
    });

    it('pages up to the cap keep their exact offset', () => {
        expect(pageOffset(MAX_LISTING_PAGE)).toBe((MAX_LISTING_PAGE - 1) * LISTING_PAGE_SIZE);
        expect(pageOffset(MAX_LISTING_PAGE - 1)).toBe((MAX_LISTING_PAGE - 2) * LISTING_PAGE_SIZE);
    });
});

describe('the state hub checks the range before its listing query', () => {
    const src = read('app/jobs/state/[state]/page.tsx');

    it('page 2 and later 404 past the end before getStateJobs runs', () => {
        const gate = src.indexOf('if (page > 1 && isPageOutOfRange(page, (await hubData).facts.total, PAGE_SIZE)) {');
        const query = src.indexOf('getStateJobs(stateName, stateCode, skip, PAGE_SIZE)');
        expect(gate).toBeGreaterThan(-1);
        expect(query).toBeGreaterThan(gate);
        // The gate and the parallel fetch share one request-cached hub promise.
        expect(src).toContain('const hubData = loadHubData(stateName, stateCode, stateSlug);');
        expect(src.slice(query, query + 200)).toContain('hubData,');
    });
});

describe('/jobs reads the shared capped page parser', () => {
    it('boardPage delegates to parseListingPage, so a huge ?page never renders the fallback board at 200', () => {
        const src = read('app/jobs/page.tsx');
        expect(src).toContain("import { parseListingPage } from '@/lib/pseo/listing-pagination';");
        expect(src).toMatch(/function boardPage\(raw: string \| string\[\] \| undefined\): number \{\s*return parseListingPage\(raw\);\s*\}/);
    });
});

describe('every listing wrapper parses ?page with parseListingPage', () => {
    it('finds the setting x state and category x city wrappers', () => {
        expect(WRAPPERS.length).toBeGreaterThanOrEqual(70);
    });

    it.each(WRAPPERS)('%s reads parseListingPage for the metadata and the page', (rel) => {
        const src = read(rel);
        expect(src).toMatch(/import \{[^}]*\bparseListingPage\b[^}]*\} from '@\/lib\/pseo\/listing-pagination'/);
        expect(src.match(/parseListingPage\(sp\.page\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(src).not.toContain('parseInt(');
    });
});

describe('no listing keeps a bare parseInt of the page', () => {
    /** Each parseInt( call with its argument list, balanced. */
    function parseIntCalls(src: string): Array<{ before: string; call: string; after: string }> {
        const calls: Array<{ before: string; call: string; after: string }> = [];
        let from = 0;
        for (;;) {
            const start = src.indexOf('parseInt(', from);
            if (start === -1) return calls;
            let depth = 0;
            let end = start + 'parseInt'.length;
            for (; end < src.length; end += 1) {
                if (src[end] === '(') depth += 1;
                if (src[end] === ')') depth -= 1;
                if (depth === 0) break;
            }
            calls.push({ before: src.slice(Math.max(0, start - 40), start), call: src.slice(start, end + 1), after: src.slice(end + 1, end + 8) });
            from = end + 1;
        }
    }

    it.each(PAGE_READERS)('%s: a page parseInt always falls back to 1', (rel) => {
        const src = read(rel);
        expect(src).not.toContain("parseInt(sp.page || '1')");
        expect(src).not.toMatch(/Math\.max\(1,\s*parseInt\((?:[^()]|\([^()]*\))*\)\)/);
        for (const { before, call, after } of parseIntCalls(src)) {
            if (!/page/i.test(call) && !/page/i.test(before)) continue;
            // The only page form left: Math.max(1, parseInt(...) || 1).
            expect(`${before}${call}${after}`, rel).toMatch(/Math\.max\(1, parseInt\([^\n]*\) \|\| 1\)/);
        }
    });
});
