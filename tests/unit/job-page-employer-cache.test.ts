import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record the arguments each cached reader receives: they are its cache key.
const calls: unknown[][] = [];
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
    calls.push(args);
    return fn(...args);
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/app/jobs/[slug]/employer-facts', () => ({
  getEmployerFacts: vi.fn(async () => ({ openRoles: 0, stateCount: 0, topStates: [], postedPay: null, companyPath: null })),
}));

import { getCachedEmployerFacts } from '@/app/jobs/[slug]/employer-cache';

describe('job page employer cache keys', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('two jobs with synthesized stand-ins from one employer share one key', async () => {
    const job = { employer: 'Acme Health', companyId: null };
    await getCachedEmployerFacts(job, { id: 'employer-job-1', name: 'Acme Health', normalizedName: 'acme health' });
    await getCachedEmployerFacts(job, { id: 'employer-job-2', name: 'Acme Health Inc', normalizedName: 'acme health' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    // The stand-in prefix is kept, so getEmployerFacts still treats it as no profile.
    expect((calls[0][2] as { id: string }).id).toBe('employer-');
  });

  it('a real company keeps its own id and names in the key', async () => {
    const job = { employer: 'One Medical', companyId: 'c1' };
    await getCachedEmployerFacts(job, { id: 'c1', name: 'One Medical', normalizedName: 'one medical' });
    expect(calls[0]).toEqual(['One Medical', 'c1', { id: 'c1', name: 'One Medical', normalizedName: 'one medical' }]);
  });

  it('no company keys on the employer alone', async () => {
    await getCachedEmployerFacts({ employer: 'Acme Health', companyId: null }, null);
    expect(calls[0]).toEqual(['Acme Health', null, null]);
  });
});
