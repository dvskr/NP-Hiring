/**
 * The end of an ingest run announces every new URL to search engines. A
 * listing that copies a confirmed employer's live paid post
 * (lib/paid-post-twins.ts) redirects to that post, so its URL must not spend
 * an Indexing API slot: withoutPaidPostCopies drops every URL whose job is
 * already marked, in one query, and a failure never stops the pings.
 *
 * It no longer runs the twin sync. The full sync (every live paid post, every
 * employer post, every listing of those employers) ran at the end of each of
 * the day's ingest runs; the hourly refresh-site-stats cron and the verify
 * route run it, and the ingest path only reads the marks already set.
 *
 * The where clause runs for real against fixture rows
 * (tests/helpers/fake-prisma-where.ts). Every name is fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, mocks } = vi.hoisted(() => ({
  db: { job: { findMany: vi.fn() } },
  mocks: {
    syncPaidPostTwins: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/paid-post-twins-sync', () => ({ syncPaidPostTwins: mocks.syncPaidPostTwins }));
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }));

import { fakeModel, type FakeTables, type Row } from '../helpers/fake-prisma-where';
import { withoutPaidPostCopies } from '@/lib/paid-post-copy-pings';
import { readCode } from '../helpers/source';

const PAID = '11111111-1111-4111-8111-111111111111';
const COPY = '22222222-2222-4222-8222-222222222222';
const LIVE = '33333333-3333-4333-8333-333333333333';
const NEW_COPY = '44444444-4444-4444-8444-444444444444';

const row = (id: string, overrides: Row = {}): Row => ({ id, slug: `np-role-${id}`, shadowedByJobId: null, ...overrides });

let tables: FakeTables;
const urlOf = (id: string) => `https://board.example/jobs/${tables.jobs.find((job) => job.id === id)!.slug}`;

beforeEach(() => {
  vi.clearAllMocks();
  // COPY was marked by an earlier hourly sync; NEW_COPY was inserted by this
  // run and waits for the next one.
  tables = { jobs: [row(PAID), row(COPY, { shadowedByJobId: PAID }), row(LIVE), row(NEW_COPY)] };
  db.job.findMany.mockImplementation((args) => fakeModel('job', tables).findMany(args));
});

describe('withoutPaidPostCopies', () => {
  it('drops every URL whose job is already marked, in one query', async () => {
    const kept = await withoutPaidPostCopies([urlOf(LIVE), urlOf(COPY), urlOf(PAID)]);

    expect(kept).toEqual([urlOf(LIVE), urlOf(PAID)]);
    expect(db.job.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('Skipping'), { skipped: 1 });
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it('never runs the twin sync: the hourly cron and the verify route do', async () => {
    await withoutPaidPostCopies([urlOf(LIVE), urlOf(NEW_COPY)]);

    expect(mocks.syncPaidPostTwins).not.toHaveBeenCalled();
    expect(readCode('lib/paid-post-copy-pings.ts')).not.toMatch(/syncPaidPostTwins|paid-post-twins-sync/);
  });

  it('keeps a copy this run inserted, which the next hourly sync marks', async () => {
    expect(await withoutPaidPostCopies([urlOf(LIVE), urlOf(NEW_COPY)])).toEqual([urlOf(LIVE), urlOf(NEW_COPY)]);
  });

  it('pings everything when the marks cannot be read, and logs why', async () => {
    db.job.findMany.mockRejectedValue(new Error('database unavailable'));
    const urls = [urlOf(LIVE), urlOf(COPY)];

    expect(await withoutPaidPostCopies(urls)).toEqual(urls);
    expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining('pinging all of them'), expect.any(Error), { urls: 2 });
  });

  it('does no work when the run added nothing', async () => {
    expect(await withoutPaidPostCopies([])).toEqual([]);
    expect(db.job.findMany).not.toHaveBeenCalled();
  });

  it('logs through the logger, never the console', () => {
    expect(readCode('lib/paid-post-copy-pings.ts')).not.toMatch(/console\./);
  });

  it('is the list ingestJobs pings', () => {
    const code = readCode('lib/ingestion-service.ts');
    const filtered = /const (\w+) = await withoutPaidPostCopies\(/.exec(code);
    expect(filtered).not.toBeNull();
    const pings = [...code.matchAll(/pingAllSearchEnginesBatch\((\w+)/g)].map((match) => match[1]);
    expect(pings).toEqual([filtered![1]]);
  });
});
