/**
 * The middleware half of the paid-post twin redirect (lib/paid-post-twin-edge.ts):
 * a free copy's URL sends the visitor to its paid post only while that post is
 * a listing anyone could open, by the rule activeIndexableJobWhere applies,
 * and never to a URL built from anything but a clean slug or the post's id.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { brand } from '@/config/brand';
import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/dead-link-threshold';
import { fetchTwinRedirect, twinRedirectPath, twinRedirectUrl, type TwinGateRow } from '@/lib/paid-post-twin-edge';

const PAID_ID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-11-26T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

function paidRow(overrides: Partial<TwinGateRow> = {}): TwinGateRow {
  return {
    id: PAID_ID,
    slug: `nurse-practitioner-outpatient-${PAID_ID}`,
    title: `${brand.niche.short}, Outpatient`,
    employer: 'Example Wellness Group',
    profession_class: 'np_eligible',
    is_published: true,
    expires_at: new Date(NOW + 30 * 24 * HOUR_MS).toISOString(),
    health_consecutive_missing: 0,
    shadowed_by_job_id: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('twinRedirectPath', () => {
  it('sends a copy to a live, listed paid post by its slug', () => {
    expect(twinRedirectPath(paidRow(), NOW)).toBe(`/jobs/nurse-practitioner-outpatient-${PAID_ID}`);
  });

  it('treats a post with no expiry as live', () => {
    expect(twinRedirectPath(paidRow({ expires_at: null }), NOW)).not.toBeNull();
  });

  it('never sends anyone to a post that would answer 410', () => {
    expect(twinRedirectPath(undefined, NOW)).toBeNull();
    expect(twinRedirectPath(paidRow({ is_published: false }), NOW)).toBeNull();
    expect(twinRedirectPath(paidRow({ expires_at: new Date(NOW - HOUR_MS).toISOString() }), NOW)).toBeNull();
    expect(twinRedirectPath(paidRow({ health_consecutive_missing: DEAD_LINK_MISS_THRESHOLD }), NOW)).toBeNull();
  });

  it('needs the post to stay live past the ruling\'s cache window', () => {
    const endsSoon = paidRow({ expires_at: new Date(NOW + 30 * 1000).toISOString() });
    expect(twinRedirectPath(endsSoon, NOW)).not.toBeNull();
    expect(twinRedirectPath(endsSoon, NOW + 60 * 1000)).toBeNull();
  });

  it('never chains to another copy or to a row the listings quarantine', () => {
    expect(twinRedirectPath(paidRow({ shadowed_by_job_id: '22222222-2222-4222-8222-222222222222' }), NOW)).toBeNull();
    expect(twinRedirectPath(paidRow({ profession_class: 'physician' }), NOW)).toBeNull();
  });

  it('falls back to the id when the stored slug is not a plain slug', () => {
    expect(twinRedirectPath(paidRow({ slug: '/evil.example' }), NOW)).toBe(`/jobs/${PAID_ID}`);
    expect(twinRedirectPath(paidRow({ slug: null }), NOW)).toBe(`/jobs/${PAID_ID}`);
  });
});

describe('twinRedirectUrl', () => {
  it('keeps the origin and the query, so an apply link or campaign tag survives', () => {
    const url = twinRedirectUrl('/jobs/np-post-1', 'https://board.example/jobs/np-copy-2?apply=1&utm_source=mail');
    expect(url.toString()).toBe('https://board.example/jobs/np-post-1?apply=1&utm_source=mail');
  });
});

describe('fetchTwinRedirect', () => {
  const base = { supabaseUrl: 'https://db.example', supabaseKey: 'service-key-for-tests', validUntil: NOW };

  it('reads nothing for an id that is not a uuid', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchTwinRedirect({ ...base, twinId: 'abc&select=*' })).toBeNull();
    expect(await fetchTwinRedirect({ ...base, twinId: null })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rules on the row the REST read returns', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify([paidRow()]), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchTwinRedirect({ ...base, twinId: PAID_ID })).toBe(`/jobs/nurse-practitioner-outpatient-${PAID_ID}`);
    const [url] = fetchSpy.mock.calls[0] as unknown as [string];
    expect(url).toContain(`/rest/v1/jobs?id=eq.${PAID_ID}&select=`);
    expect(url).toContain('shadowed_by_job_id');
  });

  it('logs a failed read and lets the copy render', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    expect(await fetchTwinRedirect({ ...base, twinId: PAID_ID })).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await fetchTwinRedirect({ ...base, twinId: PAID_ID })).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});
