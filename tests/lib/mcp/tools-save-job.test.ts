/**
 * save_job and unsave_job.
 *
 * Saving and removing were one tool, save_job with saved: false, marked as
 * not destructive. OpenAI's directory scan flagged it (2026-11-22): its
 * guidelines keep destructiveHint false for additive writes only, and
 * deletion is destructive (a closed job cannot be saved again). Each
 * operation is also its own tool there. So save_job only adds, and
 * unsave_job removes, marked destructive.
 *
 * A saved row holds the id of the job the person saved. save_job saves the
 * live job's own id, and unsave_job deletes the row by the id it is given,
 * open or closed: a job that has closed since it was saved still comes off
 * the list.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/config/brand';

const POST = '11111111-2222-4333-8444-555555555555';

const { db } = vi.hoisted(() => ({
  db: {
    job: { findFirst: vi.fn() },
    savedJob: { deleteMany: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { saveJob, unsaveJob } from '@/lib/mcp/tools/candidate-account';
import type { ToolContext } from '@/lib/mcp/server/types';

const ctx: ToolContext = {
  endpoint: 'candidate',
  access: {
    userId: 'user-1',
    email: 'person@example.test',
    role: 'job_seeker',
    scopes: ['candidate'],
    resource: `${brand.baseUrl}/mcp`,
  } as ToolContext['access'],
  baseUrl: brand.baseUrl,
  ip: '203.0.113.9',
  requestMeta: undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.savedJob.deleteMany.mockResolvedValue({ count: 1 });
  db.savedJob.upsert.mockResolvedValue({});
});

describe('save_job only adds', () => {
  it('takes only a job, never deletes, and is marked as the additive write it is', async () => {
    db.job.findFirst.mockResolvedValue({ id: POST, title: 'Psychiatric Nurse Practitioner', employer: 'Sample Clinic' });

    const out = await saveJob.run({ job_id: POST }, ctx);

    expect(Object.keys(saveJob.input)).toEqual(['job_id']);
    expect(db.savedJob.deleteMany).not.toHaveBeenCalled();
    expect(db.savedJob.upsert).toHaveBeenCalledTimes(1);
    // The live job's own id, for the signed-in account.
    expect(db.savedJob.upsert.mock.calls[0][0].create).toEqual({ userId: 'user-1', jobId: POST });
    expect(out.text).toContain('Saved Psychiatric Nurse Practitioner at Sample Clinic.');
    expect(saveJob.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });
});

describe('unsave_job', () => {
  it('is marked destructive, so hosts can confirm before a saved job is lost', () => {
    expect(unsaveJob.name).toBe('unsave_job');
    expect(unsaveJob.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
  });

  it('removes the saved row by the id it is given, whether or not the job is still open', async () => {
    db.job.findFirst.mockResolvedValue(null);

    const out = await unsaveJob.run({ job_id: `${brand.baseUrl}/jobs/psychiatric-nurse-practitioner-${POST}` }, ctx);

    expect(db.savedJob.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.savedJob.deleteMany.mock.calls[0][0].where).toEqual({ userId: 'user-1', jobId: POST });
    expect(out.text).toBe('Removed from saved jobs.');
  });

  it('only ever deletes the signed-in account\'s rows, and says when there was nothing to remove', async () => {
    db.job.findFirst.mockResolvedValue(null);
    db.savedJob.deleteMany.mockResolvedValue({ count: 0 });

    const out = await unsaveJob.run({ job_id: POST }, ctx);

    expect(db.savedJob.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.savedJob.deleteMany.mock.calls[0][0].where).toEqual({ userId: 'user-1', jobId: POST });
    expect(out.text).toBe('That job was not in the saved jobs.');
  });
});
