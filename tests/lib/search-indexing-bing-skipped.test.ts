/**
 * Without BING_WEBMASTER_API_KEY the Bing Webmaster channel is skipped, not
 * failed (register 2.30).
 *
 * The key is optional: IndexNow already reaches Bing (PENDING_WORK 1.5), and
 * production runs without it. pingBing and pingBingBatch answered every URL
 * with a failure in that state, so the daily index-urls cron reported each
 * Bing submission as failed. A result for a channel that was never asked now
 * says so (skipped: true, with the reason in error), while a key that is set
 * and a Bing answer that is not OK stay failures. IndexNow is unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BING_NOT_CONFIGURED, pingAllSearchEnginesBatch, pingBing, pingBingBatch, resetGoogleIndexingBudget } from '@/lib/search-indexing';

const URLS = [
    'https://nphiring.com/jobs/family-nurse-practitioner-00000000-0000-4000-8000-000000000001',
    'https://nphiring.com/jobs/family-nurse-practitioner-00000000-0000-4000-8000-000000000002',
];

const fetchMock = vi.fn();

beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubEnv('BING_WEBMASTER_API_KEY', '');
    vi.stubEnv('GOOGLE_INDEXING_CREDENTIALS', '');
    vi.stubEnv('INDEXNOW_KEY', '');
    vi.stubEnv('INDEXNOW_API_KEY', '');
    resetGoogleIndexingBudget();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const bingCalls = (): unknown[][] => fetchMock.mock.calls.filter((call) => String(call[0]).includes('ssl.bing.com'));

describe('no Bing Webmaster key: skipped, and Bing is never called', () => {
    it('pingBingBatch marks every URL skipped with the reason', async () => {
        const results = await pingBingBatch(URLS);

        expect(results).toEqual(URLS.map((url) => ({ engine: 'Bing', url, success: false, skipped: true, error: BING_NOT_CONFIGURED })));
        expect(BING_NOT_CONFIGURED).toBe('BING_WEBMASTER_API_KEY not set');
        expect(bingCalls()).toEqual([]);
    });

    it('pingBing marks the URL skipped too', async () => {
        expect(await pingBing(URLS[0])).toEqual({ engine: 'Bing', url: URLS[0], success: false, skipped: true, error: BING_NOT_CONFIGURED });
        expect(bingCalls()).toEqual([]);
    });

    it('the batch helper the cron calls carries the skip through, and leaves IndexNow as it was', async () => {
        const { bing, indexNow } = await pingAllSearchEnginesBatch(URLS, 'new-content');

        expect(bing.every((result) => result.skipped === true && !result.success)).toBe(true);
        // IndexNow without its key is still reported as it always was.
        expect(indexNow).toEqual(URLS.map((url) => ({ engine: 'IndexNow', url, success: false, error: 'INDEXNOW_KEY / INDEXNOW_API_KEY not set' })));
        expect(indexNow.some((result) => 'skipped' in result)).toBe(false);
    });
});

describe('with the key set, a Bing answer is a submission or a failure', () => {
    beforeEach(() => {
        vi.stubEnv('BING_WEBMASTER_API_KEY', 'bing-test-key');
    });

    it('a 200 is submitted', async () => {
        const results = await pingBingBatch(URLS);

        expect(results.every((result) => result.success && result.skipped === undefined)).toBe(true);
        expect(bingCalls()).toHaveLength(1);
    });

    it('an error answer is a failure, not a skip', async () => {
        fetchMock.mockResolvedValue(new Response('quota exceeded', { status: 400 }));

        const results = await pingBingBatch(URLS);

        expect(results).toEqual(URLS.map((url) => ({ engine: 'Bing', url, success: false, error: 'quota exceeded' })));
    });

    it('a network error is a failure, not a skip', async () => {
        fetchMock.mockRejectedValue(new Error('socket hang up'));

        expect(await pingBing(URLS[0])).toEqual({ engine: 'Bing', url: URLS[0], success: false, error: 'Error: socket hang up' });
    });
});
