/**
 * Ashby's public job board API dates a posting with `publishedAt`. The adapter
 * read `publishedDate`, a field the API does not send, so every Ashby posting
 * reached the normalizer undated: it skipped the 30-day freshness gate and was
 * treated as new on every run. Found 2026-11-23 on the sister board while
 * verifying new boards; the same adapter code was here.
 *
 * Every name is fictional.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/aggregators/tenants/ashby', () => ({
    ASHBY_TENANTS: [{ slug: 'acme-primary-care', name: 'Acme Primary Care' }],
}));

import { fetchAshbyJobs } from '@/lib/aggregators/ashby';

afterEach(() => {
    vi.unstubAllGlobals();
});

function board(job: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        jobs: [{
            id: 'np1',
            title: 'Family Nurse Practitioner',
            location: 'Remote',
            isRemote: true,
            jobUrl: 'https://jobs.ashbyhq.com/acme-primary-care/np1',
            descriptionPlain: 'Telehealth primary care visits.',
            ...job,
        }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
}

describe('Ashby posting dates', () => {
    it('reads the publishedAt the API sends', async () => {
        board({ publishedAt: '2026-03-02T15:04:05.000+00:00' });
        const [job] = await fetchAshbyJobs();
        expect(job.postedDate).toBe('2026-03-02T15:04:05.000+00:00');
        expect(job.postedAt).toBe('2026-03-02T15:04:05.000+00:00');
    });

    it('still accepts the older publishedDate name', async () => {
        board({ publishedDate: '2026-01-15' });
        const [job] = await fetchAshbyJobs();
        expect(job.postedDate).toBe('2026-01-15');
    });

    it('falls back to publishedDate when publishedAt is empty', async () => {
        board({ publishedAt: '', publishedDate: '2026-01-15' });
        const [job] = await fetchAshbyJobs();
        expect(job.postedDate).toBe('2026-01-15');
    });

    it('prefers publishedAt when both are present', async () => {
        board({ publishedAt: '2026-04-01T00:00:00Z', publishedDate: '2026-01-15' });
        const [job] = await fetchAshbyJobs();
        expect(job.postedDate).toBe('2026-04-01T00:00:00Z');
    });
});
