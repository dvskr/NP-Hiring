/**
 * lib/applications/withdraw.ts, behind DELETE /api/applications/withdraw and
 * the AI app's withdraw_application: ownership, the scrub the My
 * Applications dialog describes, and the knockout record it keeps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: { jobApplication: { findUnique: h.findUnique, update: h.update } } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { withdrawApplication } from '@/lib/applications/withdraw';
import { AUTO_REJECT_NOTE_PREFIX } from '@/lib/applications/auto-reject';

const ME = 'user-me';

beforeEach(() => {
  h.findUnique.mockReset();
  h.update.mockReset().mockResolvedValue({});
});

describe('withdrawApplication', () => {
  it('refuses a missing id, a missing row and another person\'s row, writing nothing', async () => {
    expect(await withdrawApplication(ME, undefined)).toEqual({ ok: false, status: 400, error: 'applicationId is required' });
    h.findUnique.mockResolvedValueOnce(null);
    expect(await withdrawApplication(ME, 'app-1')).toEqual({ ok: false, status: 404, error: 'Application not found' });
    h.findUnique.mockResolvedValueOnce({ userId: 'someone-else', jobId: 'job-1', status: 'applied', notes: null });
    expect(await withdrawApplication(ME, 'app-1')).toEqual({ ok: false, status: 403, error: 'You can only withdraw your own applications' });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('clears the cover letter text, the resume link and the notes, and keeps an uploaded cover letter file and the answers', async () => {
    h.findUnique.mockResolvedValue({ userId: ME, jobId: 'job-1', status: 'interview', notes: 'Employer notes' });
    expect(await withdrawApplication(ME, 'app-1')).toEqual({ ok: true });
    const { data } = h.update.mock.calls[0][0];
    expect(data).toMatchObject({ coverLetter: null, resumeUrl: null, status: 'withdrawn', notes: null });
    expect(data.withdrawnAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('coverLetterUrl');
    expect(data).not.toHaveProperty('screeningAnswers');
  });

  it('keeps the bare knockout record on an application a knockout rejected', async () => {
    h.findUnique.mockResolvedValue({ userId: ME, jobId: 'job-1', status: 'rejected', notes: `${AUTO_REJECT_NOTE_PREFIX}Does not meet requirement: x\nprivate` });
    await withdrawApplication(ME, 'app-1');
    expect(h.update.mock.calls[0][0].data.notes).toBe(AUTO_REJECT_NOTE_PREFIX);
  });
});
