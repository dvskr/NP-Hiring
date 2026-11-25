/**
 * The twin rule decides which free listings disappear while an employer's
 * paid post is live. Too loose and it hides real openings the employer never
 * paid for (large telehealth employers reuse one title in dozens of states);
 * too tight and the paid post keeps competing with copies of itself. And it
 * must never let an account that merely typed a business's name hide that
 * business's listings: only an operator-verified identity can, and only for a
 * post the account made itself.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  actingOrgKeys,
  computeTwinTargets,
  employerOrgKey,
  isPaidPostTwin,
  postedByItsAccount,
  titleKey,
  titleNamesState,
  type PaidTwinSource,
  type TwinJob,
} from '@/lib/paid-post-twins';
import { ID_CHUNK_SIZE, chunked, syncPaidPostTwins, verificationDigest } from '@/lib/paid-post-twins-sync';
import { buildCategoryWhereClause, buildWhereClause, CATEGORY_FILTERS } from '@/lib/filters';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { canonicalActiveJobWhere } from '@/lib/canonical-counts';
import { DEFAULT_FILTERS } from '@/types/filters';

const CA_VIRTUAL = 'Nurse Practitioner - CA Virtual (FT)';
const EXAMPLE_KEY = 'examplehealth';
const ACCOUNT = { supabaseId: 'acct-1', email: 'owner@example-health.test' };

function paid(overrides: Partial<PaidTwinSource> = {}): PaidTwinSource {
  return {
    id: 'paid-1',
    title: CA_VIRTUAL,
    employer: 'Example Health',
    employerName: 'Example Health',
    location: 'Remote',
    city: null,
    stateCode: 'CA',
    isRemote: true,
    jobType: null,
    verifiedOrgKeys: [EXAMPLE_KEY],
    ...overrides,
  };
}

function copy(overrides: Partial<TwinJob> = {}): TwinJob {
  return {
    id: 'copy-1',
    title: CA_VIRTUAL,
    employer: 'Example Health',
    location: 'Phoenix, Arizona',
    city: 'Phoenix',
    stateCode: 'AZ',
    isRemote: true,
    jobType: null,
    ...overrides,
  };
}

describe('titleKey', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(titleKey('NP: Telehealth (Remote)')).toBe(titleKey('np  telehealth remote'));
  });

  it('keeps different roles different', () => {
    expect(titleKey('NP Outpatient')).not.toBe(titleKey('NP Inpatient'));
  });
});

describe('titleNamesState', () => {
  it('finds an unambiguous code standing alone', () => {
    expect(titleNamesState(CA_VIRTUAL, 'CA')).toBe(true);
  });

  it('finds a full state name in any case', () => {
    expect(titleNamesState('Nurse Practitioner with CALIFORNIA License', 'CA')).toBe(true);
  });

  it('ignores a code inside a word', () => {
    expect(titleNamesState('Nurse Practitioner, Cardiac Care Unit', 'CA')).toBe(false);
  });

  it('does not read degrees, professions or clinical terms as states', () => {
    expect(titleNamesState('Physician (MD/DO) Telehealth', 'MD')).toBe(false);
    expect(titleNamesState('NP or PA Remote', 'PA')).toBe(false);
    expect(titleNamesState('NP, VA Medical Center', 'VA')).toBe(false);
    expect(titleNamesState('NP, SMI/MI Outpatient', 'MI')).toBe(false);
    expect(titleNamesState('NP, Maryland Telehealth', 'MD')).toBe(true);
  });

  it('does not read West Virginia as Virginia or Washington, DC as Washington', () => {
    expect(titleNamesState('NP, West Virginia Remote', 'VA')).toBe(false);
    expect(titleNamesState('NP, Washington, DC', 'WA')).toBe(false);
    expect(titleNamesState('NP, Washington State Remote', 'WA')).toBe(true);
  });
});

describe('employer identity', () => {
  it('sets legal suffixes aside and keeps descriptive words', () => {
    expect(employerOrgKey('Example Health, PLLC')).toBe(EXAMPLE_KEY);
    expect(employerOrgKey('The Example Health Group')).toBe(EXAMPLE_KEY);
    expect(employerOrgKey('Summit Ridge Health')).not.toBe(employerOrgKey('Summit Ridge Medical Group'));
    expect(employerOrgKey('  ')).toBeNull();
  });

  it('acts only for names the account is verified for', () => {
    expect(actingOrgKeys(['Example Health', 'Example Health, LLC'], [EXAMPLE_KEY])).toEqual([EXAMPLE_KEY]);
    expect(actingOrgKeys(['Example Health'], [])).toEqual([]);
    expect(actingOrgKeys(['Rival Clinic'], [EXAMPLE_KEY])).toEqual([]);
  });
});

describe('postedByItsAccount', () => {
  const post = { userId: 'acct-1', quotaDomain: 'example-health.test' };

  it('counts a post made from the business domain the account signs in with', () => {
    expect(postedByItsAccount(post, ACCOUNT)).toBe(true);
    expect(postedByItsAccount({ ...post, quotaDomain: 'EXAMPLE-HEALTH.TEST' }, ACCOUNT)).toBe(true);
  });

  it('does not count a post attached at sign-in that another domain made', () => {
    expect(postedByItsAccount({ ...post, quotaDomain: 'rival-clinic.test' }, ACCOUNT)).toBe(false);
  });

  it('never takes a free mail domain or a missing snapshot as proof', () => {
    const gmail = { supabaseId: 'acct-1', email: 'owner@gmail.com' };
    expect(postedByItsAccount({ ...post, quotaDomain: 'gmail.com' }, gmail)).toBe(false);
    expect(postedByItsAccount({ ...post, quotaDomain: null }, ACCOUNT)).toBe(false);
  });

  it('needs the post to sit on that account', () => {
    expect(postedByItsAccount({ ...post, userId: 'acct-2' }, ACCOUNT)).toBe(false);
    expect(postedByItsAccount({ ...post, userId: null }, ACCOUNT)).toBe(false);
    expect(postedByItsAccount(post, undefined)).toBe(false);
  });
});

describe('isPaidPostTwin', () => {
  it('hides remote copies of a role whose title names the paid state, whatever hub city they carry', () => {
    for (const stateCode of ['AZ', 'TX', 'FL', 'NV', 'UT', 'NC']) {
      expect(isPaidPostTwin(paid(), copy({ stateCode }))).toBe(true);
    }
  });

  it('keeps a multi-state employer\'s same-titled openings in other states', () => {
    const generic = 'Nurse Practitioner (NP), Telehealth';
    const paidTexas = paid({ title: generic, stateCode: 'TX' });
    expect(isPaidPostTwin(paidTexas, copy({ title: generic, stateCode: 'OH' }))).toBe(false);
    expect(isPaidPostTwin(paidTexas, copy({ title: generic, stateCode: 'TX' }))).toBe(true);
  });

  it('matches on-site roles only in the same named city and state', () => {
    const paidOnSite = paid({ title: 'NP Outpatient', isRemote: false, city: 'Austin', stateCode: 'TX' });
    const onSite = { title: 'NP Outpatient', isRemote: false, stateCode: 'TX' };
    expect(isPaidPostTwin(paidOnSite, copy({ ...onSite, city: 'Austin' }))).toBe(true);
    expect(isPaidPostTwin(paidOnSite, copy({ ...onSite, city: 'Dallas' }))).toBe(false);
    expect(isPaidPostTwin(paid({ ...onSite, city: null }), copy({ ...onSite, city: null }))).toBe(false);
  });

  it('keeps a different job type at the same place', () => {
    const paidOnSite = paid({ title: 'NP Outpatient', isRemote: false, city: 'Austin', stateCode: 'TX', jobType: 'Full-Time' });
    const onSite = { title: 'NP Outpatient', isRemote: false, city: 'Austin', stateCode: 'TX' };
    expect(isPaidPostTwin(paidOnSite, copy({ ...onSite, jobType: 'Per Diem' }))).toBe(false);
    expect(isPaidPostTwin(paidOnSite, copy({ ...onSite, jobType: 'full-time' }))).toBe(true);
    expect(isPaidPostTwin(paidOnSite, copy({ ...onSite, jobType: null }))).toBe(true);
  });

  it('never pairs a remote role with an on-site one', () => {
    expect(isPaidPostTwin(paid(), copy({ isRemote: false, stateCode: 'CA' }))).toBe(false);
  });

  it('needs the copy to carry the paid post\'s employer name, legal suffixes aside', () => {
    expect(isPaidPostTwin(paid(), copy({ employer: 'Example Health, PLLC' }))).toBe(true);
    expect(isPaidPostTwin(paid({ employerName: 'example health ' }), copy())).toBe(true);
    expect(isPaidPostTwin(paid(), copy({ employer: 'Another Clinic' }))).toBe(false);
    expect(isPaidPostTwin(paid(), copy({ employer: 'Example Health Partners' }))).toBe(false);
  });

  it('hides nothing for an account that is not verified as that employer', () => {
    expect(isPaidPostTwin(paid({ verifiedOrgKeys: [] }), copy())).toBe(false);
    expect(isPaidPostTwin(paid({ verifiedOrgKeys: ['someoneelse'] }), copy())).toBe(false);
  });

  it('does not let a verification for one employer cover another name the account typed', () => {
    const rival = { employer: 'Rival Clinic', employerName: 'Rival Clinic' };
    expect(isPaidPostTwin(paid({ ...rival, verifiedOrgKeys: [EXAMPLE_KEY] }), copy({ employer: 'Rival Clinic' }))).toBe(false);
  });

  it('never matches through the ingest\'s company key, which files different practices under one key', () => {
    const summit = paid({ employer: 'Summit Ridge Health', employerName: 'Summit Ridge Health', verifiedOrgKeys: ['summitridgehealth'] });
    expect(isPaidPostTwin(summit, copy({ employer: 'Summit Ridge Medical Group' }))).toBe(false);
  });

  it('needs the same title', () => {
    expect(isPaidPostTwin(paid(), copy({ title: 'Nurse Practitioner - TX Virtual (FT)' }))).toBe(false);
  });

  it('does not guess for a remote paid post with no state at all', () => {
    expect(isPaidPostTwin(paid({ stateCode: null }), copy())).toBe(false);
  });

  it('never marks the paid post itself', () => {
    expect(isPaidPostTwin(paid(), copy({ id: 'paid-1' }))).toBe(false);
  });
});

describe('computeTwinTargets', () => {
  it('points a copy at the newest matching paid post', () => {
    expect(computeTwinTargets([paid({ id: 'paid-new' }), paid({ id: 'paid-old' })], [copy()]).get('copy-1')).toBe('paid-new');
  });

  it('leaves listings that match nothing unmarked', () => {
    expect(computeTwinTargets([paid()], [copy({ title: 'Something Else' })]).size).toBe(0);
  });

  it('cannot be used to take a rival\'s listing: the impostor hides nothing and the real employer keeps its copy', () => {
    const impostor = paid({ id: 'impostor', verifiedOrgKeys: [] });
    const real = paid({ id: 'real' });
    expect(computeTwinTargets([impostor, real], [copy()]).get('copy-1')).toBe('real');
    expect(computeTwinTargets([impostor], [copy()]).size).toBe(0);
  });

  describe('same-titled on-site openings in one city', () => {
    const onSite = { title: 'NP Outpatient', isRemote: false, city: 'Houston', stateCode: 'TX' };

    it('hides only the copy at the paid post\'s own site when the copies name different sites', () => {
      const targets = computeTwinTargets(
        [paid({ ...onSite, location: 'Houston, TX - Clear Lake' })],
        [
          copy({ ...onSite, id: 'clear-lake', location: 'Houston, TX - Clear Lake' }),
          copy({ ...onSite, id: 'medical-center', location: 'Houston, TX - Medical Center' }),
        ],
      );
      expect([...targets.keys()]).toEqual(['clear-lake']);
    });

    it('hides none when the copies name different sites and none is the paid post\'s', () => {
      const targets = computeTwinTargets(
        [paid({ ...onSite, location: 'Houston, TX' })],
        [
          copy({ ...onSite, id: 'clear-lake', location: 'Houston, TX - Clear Lake' }),
          copy({ ...onSite, id: 'medical-center', location: 'Houston, TX - Medical Center' }),
        ],
      );
      expect(targets.size).toBe(0);
    });

    it('hides every copy that gives the same site, which is one opening listed by several sources', () => {
      const targets = computeTwinTargets(
        [paid({ ...onSite, location: 'Houston, TX' })],
        [
          copy({ ...onSite, id: 'feed-a', location: 'Houston, TX - Clear Lake' }),
          copy({ ...onSite, id: 'feed-b', location: 'Houston, TX: Clear Lake' }),
        ],
      );
      expect(targets.size).toBe(2);
    });

    it('still hides a copy that gives only the city when the paid post names its site', () => {
      const targets = computeTwinTargets(
        [paid({ ...onSite, location: 'Houston, TX - Clear Lake' })],
        [copy({ ...onSite, id: 'bare', location: 'Houston, TX' })],
      );
      expect(targets.size).toBe(1);
    });

    it('reads a state by name or code and ignores ZIP codes and a trailing country', () => {
      const targets = computeTwinTargets(
        [paid({ ...onSite, location: 'Houston, TX - Clear Lake' })],
        [
          copy({ ...onSite, id: 'spelled-out', location: 'Houston, Texas 77058 - Clear Lake, USA' }),
          copy({ ...onSite, id: 'other-site', location: 'Houston, Texas - Medical Center' }),
        ],
      );
      expect([...targets.keys()]).toEqual(['spelled-out']);
    });

    it('gives a copy the newest post leaves to an older post at that copy\'s own site', () => {
      const targets = computeTwinTargets(
        [
          paid({ ...onSite, id: 'paid-clear-lake', location: 'Houston, TX - Clear Lake' }),
          paid({ ...onSite, id: 'paid-medical-center', location: 'Houston, TX - Medical Center' }),
        ],
        [
          copy({ ...onSite, id: 'clear-lake', location: 'Houston, TX - Clear Lake' }),
          copy({ ...onSite, id: 'medical-center', location: 'Houston, TX - Medical Center' }),
        ],
      );
      expect(Object.fromEntries(targets)).toEqual({ 'clear-lake': 'paid-clear-lake', 'medical-center': 'paid-medical-center' });
    });

    it('leaves remote copies with different hub cities alone, since the hub says nothing about the role', () => {
      const targets = computeTwinTargets(
        [paid()],
        [copy({ id: 'az', location: 'Phoenix, Arizona' }), copy({ id: 'tx', stateCode: 'TX', location: 'Houston, Texas' })],
      );
      expect(targets.size).toBe(2);
    });
  });
});

describe('every listing builder hides marked copies', () => {
  const NOW = new Date('2026-11-26T12:00:00.000Z');

  it('activeIndexableJobWhere, so sitemaps, feeds, the assistant and the canonical counts skip copies', () => {
    expect(activeIndexableJobWhere(NOW).shadowedByJobId).toBeNull();
    expect(canonicalActiveJobWhere(NOW).shadowedByJobId).toBeNull();
  });

  it('the /jobs search, with and without filters', () => {
    expect(buildWhereClause({ ...DEFAULT_FILTERS }).shadowedByJobId).toBeNull();
    expect(buildWhereClause({ ...DEFAULT_FILTERS, workMode: ['remote'], search: 'telehealth' }).shadowedByJobId).toBeNull();
  });

  it.each(Object.keys(CATEGORY_FILTERS))('the legacy %s category clause, even when a caller passes extras', (slug) => {
    expect(buildCategoryWhereClause(slug, {}).shadowedByJobId).toBeNull();
    expect(buildCategoryWhereClause(slug, { shadowedByJobId: 'x', isRemote: { not: true } }).shadowedByJobId).toBeNull();
  });
});

describe('syncPaidPostTwins', () => {
  const NOW = new Date('2026-11-26T12:00:00.000Z');

  /** When this sync filed the paid post under its company, for the fixtures that say it did. */
  const LINKED_BY_SYNC_AT = new Date('2026-11-20T12:00:00.000Z');

  function fakeDb(state: {
    marked: string[];
    verified?: string[];
    paidCompanyId?: string | null;
    /** Whether this sync filed the paid post under paidCompanyId (twinCompanyLinkedAt), or another writer did. */
    linkedBySync?: boolean;
    /** The post's write-once signup domain; another business domain means another account made it. */
    quotaDomain?: string;
    /** The post's current "Verified employer" check; defaults to what it deserves, so no badge write. */
    badge?: boolean;
  }) {
    const verified = state.verified ?? [EXAMPLE_KEY];
    const quotaDomain = state.quotaDomain ?? 'example-health.test';
    const ownsPost = quotaDomain === 'example-health.test';
    const badgeRow = {
      employerName: 'Example Health',
      userId: 'acct-1',
      quotaDomain,
      job: { id: 'paid-1', slug: 'nurse-practitioner-paid-1', employer: 'Example Health', isVerifiedEmployer: state.badge ?? (ownsPost && verified.includes(EXAMPLE_KEY)) },
    };
    const paidRow = {
      employerName: 'Example Health',
      userId: 'acct-1',
      quotaDomain,
      job: {
        id: 'paid-1', slug: 'nurse-practitioner-paid-1', title: CA_VIRTUAL, employer: 'Example Health', location: 'Remote',
        companyId: state.paidCompanyId ?? null, city: null, stateCode: 'CA', isRemote: true, jobType: null,
        twinCompanyLinkedAt: state.linkedBySync ? LINKED_BY_SYNC_AT : null,
      },
    };
    const candidates = [
      { ...copy({ id: 'copy-1' }), slug: 'copy-1', companyId: 'company-1', shadowedByJobId: null },
      { ...copy({ id: 'copy-2', stateCode: 'TX' }), slug: 'copy-2', companyId: 'company-1', shadowedByJobId: 'paid-1' },
      { ...copy({ id: 'other', title: 'Something Else' }), slug: 'other', companyId: 'company-1', shadowedByJobId: null },
    ];
    const executeRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values }));
    const db = {
      // The live paid posts are asked for with a where clause; the badge pass reads every post.
      employerJob: { findMany: vi.fn(async (args?: { where?: unknown }) => (args?.where ? [paidRow] : [badgeRow])) },
      userProfile: { findMany: vi.fn(async () => [{ ...ACCOUNT, verifiedEmployerOrgKeys: verified }]) },
      company: { findMany: vi.fn(async () => [{ id: 'company-1' }]) },
      job: {
        findMany: vi.fn(async (args: { where: Record<string, unknown> }) =>
          ('shadowedByJobId' in args.where ? state.marked.map((id) => ({ id })) : candidates)),
      },
      $executeRaw: executeRaw,
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    };
    return { db, executeRaw };
  }

  const writesOf = (executeRaw: ReturnType<typeof fakeDb>['executeRaw']): string[] =>
    executeRaw.mock.calls.map(([strings]) => strings.join('?'));

  it('marks new copies, keeps existing marks and releases stale ones in one transaction', async () => {
    const { db, executeRaw } = fakeDb({ marked: ['copy-2', 'stale-1'] });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result).toMatchObject({ livePaidPosts: 1, candidates: 3, shadowed: 2, newlyShadowed: 1, released: 1, awaitingVerification: [] });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const writes = writesOf(executeRaw);
    expect(writes[0]).toContain('SET shadowed_by_job_id = NULL');
    expect(writes[1]).toContain('SET shadowed_by_job_id = ?');
  });

  it('only reads live posts the employer paid for: a checkout, a pack credit or the retired plan', async () => {
    const { db } = fakeDb({ marked: [] });
    await syncPaidPostTwins({ db: db as never, now: NOW });
    const paidQuery = db.employerJob.findMany.mock.calls.map(([args]) => args).find((args) => args?.where) as { where: { paymentStatus: { in: string[] } } };
    expect([...paidQuery.where.paymentStatus.in].sort()).toEqual(['pack', 'paid', 'plan']);
  });

  it('files the paid post under the company its copies were listed under, so the company page keeps the role', async () => {
    const { db, executeRaw } = fakeDb({ marked: [] });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result.linkedToCompany).toBe(1);
    const link = executeRaw.mock.calls.find(([strings]) => strings.join('?').includes('SET company_id'));
    expect(link?.[0].join('?')).toContain('company_id IS NULL');
    // ...and records that this sync filed it there, which is what lets it undo the link.
    expect(link?.[0].join('?')).toContain('twin_company_linked_at = ?');
    expect(link?.slice(1)).toEqual(['company-1', NOW, 'paid-1']);
    expect(result.changedPostSlugs).toEqual(['nurse-practitioner-paid-1']);
  });

  it('reads when the sync filed each paid post, beside the twin columns', async () => {
    const { db } = fakeDb({ marked: [] });
    await syncPaidPostTwins({ db: db as never, now: NOW });
    const paidQuery = db.employerJob.findMany.mock.calls.map(([args]) => args).find((args) => args?.where) as { select: { job: { select: Record<string, boolean> } } };
    expect(paidQuery.select.job.select).toMatchObject({ companyId: true, twinCompanyLinkedAt: true });
  });

  it('leaves a paid post already filed under a company alone', async () => {
    const { db, executeRaw } = fakeDb({ marked: [], paidCompanyId: 'company-9' });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result.linkedToCompany).toBe(0);
    expect(writesOf(executeRaw).some((sql) => sql.includes('SET company_id'))).toBe(false);
  });

  it('hides nothing for an unverified account, releases its old marks and queues it for verification', async () => {
    const { db, executeRaw } = fakeDb({ marked: ['copy-2'], verified: [] });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result.shadowed).toBe(0);
    expect(result.released).toBe(1);
    expect(result.awaitingVerification).toEqual([{ paidJobId: 'paid-1', employerName: 'Example Health', copies: 2 }]);
    const writes = writesOf(executeRaw);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('SET shadowed_by_job_id = NULL');
  });

  it('does not lend a verification to a post another account made, such as one attached at sign-in', async () => {
    const { db } = fakeDb({ marked: [], quotaDomain: 'elsewhere.test' });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result.shadowed).toBe(0);
    expect(result.awaitingVerification).toEqual([{ paidJobId: 'paid-1', employerName: 'Example Health', copies: 2 }]);
  });

  it('takes a post off the company page it filed it under once its verification is revoked', async () => {
    const { db, executeRaw } = fakeDb({ marked: [], verified: [], paidCompanyId: 'company-1', linkedBySync: true });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result.unlinkedFromCompany).toBe(1);
    const unlink = executeRaw.mock.calls.find(([strings]) => strings.join('?').includes('SET company_id = NULL'));
    expect(unlink?.slice(1)).toEqual([expect.objectContaining({ values: ['paid-1'] })]);
    // The record goes with the link, and the WHERE undoes only a link this sync made.
    expect(unlink?.[0].join('?')).toContain('twin_company_linked_at = NULL');
    expect(unlink?.[0].join('?')).toContain('AND twin_company_linked_at IS NOT NULL');
    expect(result.changedPostSlugs).toEqual(['nurse-practitioner-paid-1']);
  });

  it('keeps a company link it did not make, such as one scripts/link-all-jobs.ts set before this sync existed', async () => {
    const { db, executeRaw } = fakeDb({ marked: [], verified: [], paidCompanyId: 'company-1', linkedBySync: false });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result.unlinkedFromCompany).toBe(0);
    expect(writesOf(executeRaw).some((sql) => sql.includes('SET company_id'))).toBe(false);
  });

  it('keeps a link it made while the account stays verified', async () => {
    const { db, executeRaw } = fakeDb({ marked: [], paidCompanyId: 'company-1', linkedBySync: true });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result.unlinkedFromCompany).toBe(0);
    expect(writesOf(executeRaw).some((sql) => sql.includes('SET company_id = NULL'))).toBe(false);
  });

  it('gives the "Verified employer" check to a confirmed employer\'s post and reports its page', async () => {
    const { db, executeRaw } = fakeDb({ marked: [], badge: false, paidCompanyId: 'company-9' });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result.badgesGranted).toBe(1);
    expect(writesOf(executeRaw).some((sql) => sql.includes('SET is_verified_employer = true'))).toBe(true);
    expect(result.changedPostSlugs).toEqual(['nurse-practitioner-paid-1']);
  });

  it('takes the check off a post whose employer only paid and was never confirmed', async () => {
    const { db, executeRaw } = fakeDb({ marked: [], verified: [], badge: true });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result.badgesRemoved).toBe(1);
    expect(writesOf(executeRaw).some((sql) => sql.includes('SET is_verified_employer = false'))).toBe(true);
  });

  it('takes the check off a post attached to a confirmed account that the account did not make', async () => {
    const { db } = fakeDb({ marked: [], quotaDomain: 'elsewhere.test', badge: true });
    expect((await syncPaidPostTwins({ db: db as never, now: NOW })).badgesRemoved).toBe(1);
  });

  it('asks for candidates the listings would show but for a mark', async () => {
    const { db } = fakeDb({ marked: [] });
    await syncPaidPostTwins({ db: db as never, now: NOW });
    const candidateQuery = db.job.findMany.mock.calls.map(([args]) => args).find((args) => 'AND' in args.where);
    const [visible] = (candidateQuery?.where as { AND: Record<string, unknown>[] }).AND;
    expect(visible).toMatchObject({ isPublished: true });
    expect(Object.prototype.hasOwnProperty.call(visible, 'shadowedByJobId')).toBe(true);
    expect(visible.shadowedByJobId).toBeUndefined();
    expect(visible.NOT).toBeDefined();
  });

  it('writes nothing on a dry run', async () => {
    const { db, executeRaw } = fakeDb({ marked: ['stale-1'] });
    const result = await syncPaidPostTwins({ db: db as never, now: NOW, dryRun: true });
    expect(result.released).toBe(1);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('writes nothing when every mark is already right', async () => {
    const { db } = fakeDb({ marked: [] });
    db.job.findMany = vi.fn(async () => []);
    const result = await syncPaidPostTwins({ db: db as never, now: NOW });
    expect(result.shadowed).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  describe('long id lists go out in statements of at most ID_CHUNK_SIZE ids, all in one transaction', () => {
    const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

    /** How many ids each write whose SQL contains `marker` binds, in order. */
    const boundIds = (executeRaw: ReturnType<typeof fakeDb>['executeRaw'], marker: string): number[] =>
      executeRaw.mock.calls
        .filter(([strings]) => strings.join('?').includes(marker))
        .map((call) => (call.slice(1).find((value) => typeof value === 'object' && value !== null && 'values' in value) as { values: unknown[] }).values.length);

    it('splits a list into runs of the chunk size, the last one shorter, and an empty list into none', () => {
      expect(ID_CHUNK_SIZE).toBe(1000);
      expect(chunked(ids('a', 2500)).map((run) => run.length)).toEqual([1000, 1000, 500]);
      expect(chunked(ids('a', 1000)).map((run) => run.length)).toEqual([1000]);
      expect(chunked([])).toEqual([]);
      expect(chunked(ids('a', 5), 2)).toEqual([['a-0', 'a-1'], ['a-2', 'a-3'], ['a-4']]);
    });

    it('releases thousands of stale marks without one statement binding them all', async () => {
      const { db, executeRaw } = fakeDb({ marked: ids('stale', 2500) });

      const result = await syncPaidPostTwins({ db: db as never, now: NOW });

      expect(result.released).toBe(2500);
      expect(boundIds(executeRaw, 'SET shadowed_by_job_id = NULL')).toEqual([1000, 1000, 500]);
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect((db.$transaction.mock.calls[0][0] as unknown[]).length).toBe(executeRaw.mock.calls.length);
    });

    it('points thousands of copies at one paid post in several statements', async () => {
      const { db, executeRaw } = fakeDb({ marked: [] });
      const many = ids('copy', 1500).map((id) => ({ ...copy({ id }), slug: id, companyId: 'company-1', shadowedByJobId: null }));
      db.job.findMany = vi.fn(async (args: { where: Record<string, unknown> }) => ('shadowedByJobId' in args.where ? [] : many)) as never;

      const result = await syncPaidPostTwins({ db: db as never, now: NOW });

      expect(result.newlyShadowed).toBe(1500);
      expect(boundIds(executeRaw, 'SET shadowed_by_job_id = ?')).toEqual([1000, 500]);
      expect(db.$transaction).toHaveBeenCalledTimes(1);
    });

    it('takes the check off thousands of posts in several statements', async () => {
      const { db, executeRaw } = fakeDb({ marked: [], verified: [] });
      const rows = ids('post', 1001).map((id) => ({
        employerName: 'Example Health', userId: 'acct-1', quotaDomain: 'example-health.test',
        job: { id, slug: id, employer: 'Example Health', isVerifiedEmployer: true },
      }));
      const paidRow = (await db.employerJob.findMany({ where: {} }))[0];
      db.employerJob.findMany = vi.fn(async (args?: { where?: unknown }) => (args?.where ? [paidRow] : rows)) as never;

      const result = await syncPaidPostTwins({ db: db as never, now: NOW });

      expect(result.badgesRemoved).toBe(1001);
      expect(boundIds(executeRaw, 'SET is_verified_employer = false')).toEqual([1000, 1]);
      expect(db.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});

describe('verificationDigest', () => {
  const URL_ = 'https://example.com/admin/verify-employers';

  it('says nothing when nothing is waiting', () => {
    expect(verificationDigest([], URL_)).toBeNull();
  });

  it('lists the waiting posts with a link to review them', () => {
    const text = verificationDigest([{ paidJobId: 'p1', employerName: 'Example Health', copies: 7 }], URL_)!;
    expect(text).toContain('1 paid post is waiting');
    expect(text).toContain('Example Health: 7 free listings would be hidden');
    expect(text).toContain(URL_);
  });

  it('strips mentions and markup from typed company names', () => {
    const text = verificationDigest([{ paidJobId: 'p1', employerName: '@everyone <@123> **Bold**', copies: 1 }], URL_)!;
    expect(text).not.toMatch(/[@<>*]/);
  });

  it('caps the list and says how many more are waiting', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ paidJobId: `p${i}`, employerName: `Clinic ${i}`, copies: 1 }));
    const text = verificationDigest(many, URL_)!;
    expect(text).toContain('and 3 more');
    expect(text.split('\n').filter((line) => line.startsWith('- Clinic'))).toHaveLength(10);
  });

  it('writes no en or em dash', () => {
    const text = verificationDigest([{ paidJobId: 'p1', employerName: 'Example Health', copies: 2 }], URL_)!;
    expect(text).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
  });
});
