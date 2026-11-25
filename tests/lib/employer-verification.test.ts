/**
 * /admin/verify-employers is the only way an account comes to speak for a
 * business: confirming it gives the account's posts the Verified employer
 * check and lets its paid post hide that business's free listings. So a
 * confirmation is limited to a name the account itself posted under, every
 * verified account stays on the page so it can be revoked, and the queue
 * shows the operator what they need to judge it.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    employerJob: { findMany: vi.fn() },
    userProfile: { findUnique: vi.fn(), findMany: vi.fn() },
    company: { findMany: vi.fn() },
    job: { findMany: vi.fn(), groupBy: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/paid-post-twins-sync', () => ({
  syncPaidPostTwins: vi.fn(async () => ({
    livePaidPosts: 1, candidates: 2, shadowed: 0, newlyShadowed: 0, released: 0, linkedToCompany: 0, unlinkedFromCompany: 0,
    awaitingVerification: [{ paidJobId: 'job-paid', employerName: 'Example Behavioral Health', copies: 2 }],
    badgesGranted: 0, badgesRemoved: 0, changedPostSlugs: [],
  })),
}));

import { loadVerificationQueue, setEmployerVerification } from '@/lib/admin/employer-verification';

const OWN_POST = {
  userId: 'acct-1',
  quotaDomain: 'examplebh.example',
  employerName: 'Example Behavioral Health, PLLC',
  job: { employer: 'Example Behavioral Health, PLLC' },
};

const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setEmployerVerification', () => {
  it('confirms a name the account posted under with one atomic append that never duplicates it', async () => {
    db.userProfile.findUnique
      .mockResolvedValueOnce({ id: 'profile-1', email: 'owner@examplebh.example' })
      .mockResolvedValueOnce({ verifiedEmployerOrgKeys: ['examplebehavioralhealth'] });
    db.employerJob.findMany.mockResolvedValue([OWN_POST]);
    const result = await setEmployerVerification('acct-1', 'examplebehavioralhealth', true);
    expect(result).toEqual({ ok: true, verifiedEmployerOrgKeys: ['examplebehavioralhealth'] });
    const [call] = db.$executeRaw.mock.calls;
    expect(sqlOf(call)).toContain('array_append(verified_employer_org_keys');
    expect(sqlOf(call)).toContain('NOT (? = ANY(verified_employer_org_keys))');
  });

  it('refuses a name the account never posted under', async () => {
    db.userProfile.findUnique.mockResolvedValueOnce({ id: 'profile-1', email: 'owner@examplebh.example' });
    db.employerJob.findMany.mockResolvedValue([OWN_POST]);
    const result = await setEmployerVerification('acct-1', 'rivalclinic', true);
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not count a post another account made that was attached to this one at sign-in', async () => {
    db.userProfile.findUnique.mockResolvedValueOnce({ id: 'profile-1', email: 'owner@examplebh.example' });
    db.employerJob.findMany.mockResolvedValue([{ ...OWN_POST, quotaDomain: 'rival-clinic.example' }]);
    const result = await setEmployerVerification('acct-1', 'examplebehavioralhealth', true);
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('cannot confirm an account that signs in with a free mail provider, which proves nothing', async () => {
    db.userProfile.findUnique.mockResolvedValueOnce({ id: 'profile-1', email: 'owner@gmail.com' });
    db.employerJob.findMany.mockResolvedValue([{ ...OWN_POST, quotaDomain: 'gmail.com' }]);
    const result = await setEmployerVerification('acct-1', 'examplebehavioralhealth', true);
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('reads only live posts, never an unpaid checkout or a refunded post', async () => {
    db.userProfile.findUnique.mockResolvedValueOnce({ id: 'profile-1', email: 'owner@examplebh.example' });
    db.employerJob.findMany.mockResolvedValue([]);
    await setEmployerVerification('acct-1', 'examplebehavioralhealth', true);
    const { where } = db.employerJob.findMany.mock.calls[0][0] as { where: { userId: string; paymentStatus: { in: string[] } } };
    expect(where.userId).toBe('acct-1');
    expect(where.paymentStatus.in).toEqual(expect.arrayContaining(['paid', 'pack', 'promo', 'free']));
    for (const status of ['pending', 'expired', 'refunded', 'disputed']) expect(where.paymentStatus.in).not.toContain(status);
  });

  it('revokes one name with one atomic removal and keeps the others', async () => {
    db.userProfile.findUnique
      .mockResolvedValueOnce({ id: 'profile-1', email: 'owner@examplebh.example' })
      .mockResolvedValueOnce({ verifiedEmployerOrgKeys: ['examplekids'] });
    const result = await setEmployerVerification('acct-1', 'examplebehavioralhealth', false);
    expect(result).toEqual({ ok: true, verifiedEmployerOrgKeys: ['examplekids'] });
    expect(sqlOf(db.$executeRaw.mock.calls[0])).toContain('array_remove(verified_employer_org_keys');
  });

  it('answers 404 for an account that no longer exists', async () => {
    db.userProfile.findUnique.mockResolvedValue(null);
    expect(await setEmployerVerification('gone', 'examplebehavioralhealth', true)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('loadVerificationQueue', () => {
  function seed(options: { verifiedOnly?: boolean } = {}) {
    db.employerJob.findMany
      .mockResolvedValueOnce(options.verifiedOnly ? [] : [
        { userId: 'acct-1', quotaDomain: 'examplebh.example', employerName: 'Example Behavioral Health', paymentStatus: 'paid', job: { id: 'job-paid', employer: 'Example Behavioral Health' } },
        { userId: 'acct-2', quotaDomain: 'quiet.example', employerName: 'Quiet Clinic', paymentStatus: 'promo', job: { id: 'job-free', employer: 'Quiet Clinic' } },
      ])
      .mockResolvedValueOnce(options.verifiedOnly ? [] : [{ jobId: 'job-paid' }]);
    db.userProfile.findMany
      .mockResolvedValueOnce(options.verifiedOnly ? [{ supabaseId: 'acct-3' }] : [])
      .mockResolvedValueOnce(options.verifiedOnly
        ? [{ supabaseId: 'acct-3', email: 'owner@gone.example', company: 'Gone Clinic', verifiedEmployerOrgKeys: ['goneclinic'] }]
        : [
            { supabaseId: 'acct-1', email: 'owner@examplebh.example', company: 'Example Behavioral Health', verifiedEmployerOrgKeys: [] },
            { supabaseId: 'acct-2', email: 'owner@quiet.example', company: null, verifiedEmployerOrgKeys: [] },
          ]);
    db.job.groupBy.mockResolvedValue([]);
    db.company.findMany.mockResolvedValue([]);
    db.job.findMany.mockResolvedValue(options.verifiedOnly ? [] : [
      { title: 'NP Outpatient', employer: 'Example Behavioral Health', location: 'Austin, TX', applyLink: 'https://jobs.example-ats.test/examplebh/1' },
      { title: 'NP Telehealth', employer: 'Example Behavioral Health, PLLC', location: 'Remote', applyLink: null },
    ]);
  }

  it('shows each name an account posted under with its listings, what would be hidden and where the account signs in from', async () => {
    seed();
    const queue = await loadVerificationQueue(new Date('2026-11-26T12:00:00.000Z'));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ supabaseId: 'acct-1', accountDomain: 'examplebh.example' });
    expect(queue[0].identities).toEqual([
      expect.objectContaining({
        orgKey: 'examplebehavioralhealth',
        verified: false,
        livePaidPosts: 1,
        copies: 2,
        feedListings: 2,
        samples: [
          { title: 'NP Outpatient', location: 'Austin, TX', applyHost: 'jobs.example-ats.test' },
          { title: 'NP Telehealth', location: 'Remote', applyHost: null },
        ],
      }),
    ]);
  });

  it('keeps a verified account on the page after its posts are gone, so the verification can be revoked', async () => {
    seed({ verifiedOnly: true });
    const queue = await loadVerificationQueue(new Date('2026-11-26T12:00:00.000Z'));
    expect(queue).toEqual([expect.objectContaining({
      supabaseId: 'acct-3',
      identities: [expect.objectContaining({ orgKey: 'goneclinic', verified: true, names: [] })],
    })]);
  });

  it('leaves out an account whose only post another domain made', async () => {
    seed();
    db.employerJob.findMany.mockReset();
    db.employerJob.findMany
      .mockResolvedValueOnce([
        { userId: 'acct-1', quotaDomain: 'rival-clinic.example', employerName: 'Example Behavioral Health', paymentStatus: 'paid', job: { id: 'job-paid', employer: 'Example Behavioral Health' } },
      ])
      .mockResolvedValueOnce([{ jobId: 'job-paid' }]);
    const queue = await loadVerificationQueue(new Date('2026-11-26T12:00:00.000Z'));
    expect(queue).toEqual([]);
  });

  it('is empty, with no further reads, when no account has posted', async () => {
    db.employerJob.findMany.mockResolvedValueOnce([]);
    db.userProfile.findMany.mockResolvedValueOnce([]);
    expect(await loadVerificationQueue()).toEqual([]);
    expect(db.job.findMany).not.toHaveBeenCalled();
  });
});
