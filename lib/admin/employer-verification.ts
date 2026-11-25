import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { domainOf } from '@/lib/pricing';
import { feedListingsWhere } from '@/lib/employer-feed-listings';
import { LIVE_POST_STATUSES, PAID_POST_STATUSES, employerOrgKey, postedByItsAccount } from '@/lib/paid-post-twins';
import { syncPaidPostTwins } from '@/lib/paid-post-twins-sync';

/**
 * /admin/verify-employers: confirm that an employer account speaks for the
 * business it named.
 *
 * Two things wait for this: the "Verified employer" check on the account's
 * posts, and hiding the business's free feed listings behind the account's
 * paid post (both kept by lib/paid-post-twins-sync.ts). The account's company
 * name was typed by the account, so the operator confirms it from what the
 * page shows: the domain the account signs in with next to the employer's own
 * listings and where they send applicants.
 *
 * Only posts the account itself made count as names it posted under
 * (postedByItsAccount): the sign-in callback can attach someone else's post
 * to an account by its typed contact email.
 *
 * This is not Profile Claims (/admin/company-claims), which verifies a claim
 * on a company profile and sets Company.claimVerifiedAt. The two stay apart.
 */

const SAMPLE_LISTINGS = 3;
const LISTING_SCAN_LIMIT = 5000;

export interface VerificationSample {
  title: string;
  location: string | null;
  /** Where the listing sends applicants: the employer's site or its ATS. */
  applyHost: string | null;
}

/** One employer an account has posted as, or is verified for. */
export interface VerificationIdentity {
  orgKey: string;
  /** The names the account's own posts used for it, as typed. */
  names: string[];
  verified: boolean;
  /** The account's paid posts under this name that are live now. */
  livePaidPosts: number;
  /** Free listings those posts hide now (verified) or would hide (not yet). */
  copies: number;
  /** Free feed listings published under this name. */
  feedListings: number;
  samples: VerificationSample[];
}

export interface VerificationAccount {
  supabaseId: string;
  email: string;
  /** The domain of the email the account signs in with, proven by signing in. */
  accountDomain: string | null;
  profileCompany: string | null;
  identities: VerificationIdentity[];
}

interface QueuePost {
  userId: string | null;
  quotaDomain: string | null;
  employerName: string;
  paymentStatus: string;
  job: { id: string; employer: string };
}

interface QueueProfile {
  supabaseId: string;
  email: string;
  company: string | null;
  verifiedEmployerOrgKeys: string[];
}

interface FeedListing {
  title: string;
  employer: string;
  location: string;
  applyLink: string | null;
}

interface QueueContext {
  liveIds: ReadonlySet<string>;
  awaitingCopies: ReadonlyMap<string, number>;
  hiddenCopies: ReadonlyMap<string, number>;
  listingsByKey: ReadonlyMap<string, readonly FeedListing[]>;
}

interface IdentityTally {
  names: readonly string[];
  livePaidPosts: number;
  copies: number;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function postKeys(post: { employerName: string; job: { employer: string } }): string[] {
  return unique([employerOrgKey(post.employerName) ?? '', employerOrgKey(post.job.employer) ?? '']);
}

/** Every live post with an account, kept only where that account made it, and the profiles they need. */
async function loadOwnPosts(): Promise<{ posts: QueuePost[]; profiles: QueueProfile[] }> {
  const [allPosts, verifiedProfiles] = await Promise.all([
    prisma.employerJob.findMany({
      where: { userId: { not: null }, paymentStatus: { in: [...LIVE_POST_STATUSES] } },
      select: { userId: true, quotaDomain: true, employerName: true, paymentStatus: true, job: { select: { id: true, employer: true } } },
    }),
    prisma.userProfile.findMany({
      where: { verifiedEmployerOrgKeys: { isEmpty: false } },
      select: { supabaseId: true },
    }),
  ]);
  const accountIds = unique([...allPosts.map((post) => post.userId ?? ''), ...verifiedProfiles.map((profile) => profile.supabaseId)]);
  if (accountIds.length === 0) return { posts: [], profiles: [] };
  const profiles = await prisma.userProfile.findMany({
    where: { supabaseId: { in: accountIds } },
    select: { supabaseId: true, email: true, company: true, verifiedEmployerOrgKeys: true },
  });
  const byId = new Map(profiles.map((profile) => [profile.supabaseId, profile]));
  const posts = allPosts.filter((post) => postedByItsAccount(post, post.userId ? byId.get(post.userId) : undefined));
  return { posts, profiles };
}

/** Copies already hidden behind each of these live paid posts. */
async function countHiddenCopies(liveIds: readonly string[]): Promise<Map<string, number>> {
  if (liveIds.length === 0) return new Map();
  const groups = await prisma.job.groupBy({
    by: ['shadowedByJobId'],
    where: { shadowedByJobId: { in: [...liveIds] } },
    _count: { _all: true },
  });
  return new Map(groups.map((row) => [row.shadowedByJobId ?? '', row._count._all]));
}

/** The free feed listings published under the names these posts used, by employer key. */
async function loadFeedListings(posts: readonly QueuePost[], now: Date): Promise<Map<string, FeedListing[]>> {
  const names = unique(posts.flatMap((post) => [post.employerName.trim(), post.job.employer.trim()]));
  const listingsWhere = await feedListingsWhere(names);
  if (listingsWhere === null) return new Map();
  const listings = await prisma.job.findMany({
    where: { AND: [activeIndexableJobWhere(now), listingsWhere] },
    select: { title: true, employer: true, location: true, applyLink: true },
    orderBy: { createdAt: 'desc' },
    take: LISTING_SCAN_LIMIT,
  });
  const byKey = new Map<string, FeedListing[]>();
  for (const listing of listings) {
    const key = employerOrgKey(listing.employer);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), listing]);
  }
  return byKey;
}

/** One post's names, live paid count and copies, added to its employer key's tally. */
function tallyPost(tallies: ReadonlyMap<string, IdentityTally>, post: QueuePost, ctx: QueueContext): Map<string, IdentityTally> {
  const isLivePaid = PAID_POST_STATUSES.includes(post.paymentStatus) && ctx.liveIds.has(post.job.id);
  const copies = (ctx.awaitingCopies.get(post.job.id) ?? 0) + (ctx.hiddenCopies.get(post.job.id) ?? 0);
  const next = new Map(tallies);
  for (const key of postKeys(post)) {
    const entry = next.get(key) ?? { names: [], livePaidPosts: 0, copies: 0 };
    const typed = [post.employerName, post.job.employer]
      .filter((name) => employerOrgKey(name) === key)
      .map((name) => name.trim());
    next.set(key, {
      names: unique([...entry.names, ...typed]),
      livePaidPosts: entry.livePaidPosts + (isLivePaid ? 1 : 0),
      copies: entry.copies + (isLivePaid ? copies : 0),
    });
  }
  return next;
}

function identitiesFor(profile: QueueProfile, own: readonly QueuePost[], ctx: QueueContext): VerificationIdentity[] {
  // A verified key keeps its row even after the posts behind it are gone.
  const seeded = new Map<string, IdentityTally>(
    profile.verifiedEmployerOrgKeys.map((key) => [key, { names: [], livePaidPosts: 0, copies: 0 }]),
  );
  const tallies = own.reduce((acc, post) => tallyPost(acc, post, ctx), seeded);
  return [...tallies]
    .map(([orgKey, tally]): VerificationIdentity => {
      const feed = ctx.listingsByKey.get(orgKey) ?? [];
      return {
        orgKey,
        names: [...tally.names],
        verified: profile.verifiedEmployerOrgKeys.includes(orgKey),
        livePaidPosts: tally.livePaidPosts,
        copies: tally.copies,
        feedListings: feed.length,
        samples: feed.slice(0, SAMPLE_LISTINGS).map((listing) => ({
          title: listing.title,
          location: listing.location,
          applyHost: hostOf(listing.applyLink),
        })),
      };
    })
    .filter((identity) => identity.verified || identity.feedListings > 0 || identity.copies > 0);
}

function waitingCopies(account: VerificationAccount): number {
  return account.identities
    .filter((identity) => !identity.verified)
    .reduce((total, identity) => total + identity.copies, 0);
}

/**
 * Every account that posted (free or paid) under a name with published feed
 * listings, plus every account already verified, so a verification can always
 * be revoked. Accounts with paid posts waiting on a decision come first.
 */
export async function loadVerificationQueue(now: Date = new Date()): Promise<VerificationAccount[]> {
  const { posts, profiles } = await loadOwnPosts();
  if (profiles.length === 0) return [];

  const [livePaid, twins] = await Promise.all([
    prisma.employerJob.findMany({
      where: { paymentStatus: { in: [...PAID_POST_STATUSES] }, userId: { not: null }, job: activeIndexableJobWhere(now) },
      select: { jobId: true },
    }),
    syncPaidPostTwins({ now, dryRun: true }),
  ]);
  const liveIds = new Set(livePaid.map((row) => row.jobId));
  const [hiddenCopies, listingsByKey] = await Promise.all([
    countHiddenCopies([...liveIds]),
    loadFeedListings(posts, now),
  ]);
  const ctx: QueueContext = {
    liveIds,
    awaitingCopies: new Map(twins.awaitingVerification.map((post) => [post.paidJobId, post.copies])),
    hiddenCopies,
    listingsByKey,
  };

  const accounts = profiles
    .map((profile): VerificationAccount => ({
      supabaseId: profile.supabaseId,
      email: profile.email,
      accountDomain: domainOf(profile.email),
      profileCompany: profile.company,
      identities: identitiesFor(profile, posts.filter((post) => post.userId === profile.supabaseId), ctx),
    }))
    .filter((account) => account.identities.length > 0);
  return [...accounts].sort((a, b) => waitingCopies(b) - waitingCopies(a) || a.email.localeCompare(b.email));
}

export type VerificationChange =
  | { ok: true; verifiedEmployerOrgKeys: string[] }
  | { ok: false; status: 404 | 422; error: string };

/** The employer keys an account may be confirmed for: names on posts it made itself. */
async function claimedOrgKeys(supabaseId: string, email: string): Promise<Set<string>> {
  const posts = await prisma.employerJob.findMany({
    where: { userId: supabaseId, paymentStatus: { in: [...LIVE_POST_STATUSES] } },
    select: { userId: true, quotaDomain: true, employerName: true, job: { select: { employer: true } } },
  });
  return new Set(posts
    .filter((post) => postedByItsAccount(post, { supabaseId, email }))
    .flatMap((post) => postKeys(post)));
}

/**
 * Confirm or revoke one employer identity for an account. Only a name the
 * account itself posted under can be confirmed, so this can never attach an
 * employer the account never claimed. Each change is one atomic array
 * update, so two operators acting at once cannot undo each other.
 */
export async function setEmployerVerification(
  supabaseId: string,
  orgKey: string,
  verified: boolean,
): Promise<VerificationChange> {
  const profile = await prisma.userProfile.findUnique({
    where: { supabaseId },
    select: { id: true, email: true },
  });
  if (!profile) return { ok: false, status: 404, error: 'That account no longer exists' };

  if (verified) {
    const claimed = await claimedOrgKeys(supabaseId, profile.email);
    if (!claimed.has(orgKey)) {
      return { ok: false, status: 422, error: 'This account has never posted under that employer name' };
    }
    await prisma.$executeRaw`
      UPDATE user_profiles
      SET verified_employer_org_keys = array_append(verified_employer_org_keys, ${orgKey}), updated_at = NOW()
      WHERE supabase_id = ${supabaseId} AND NOT (${orgKey} = ANY(verified_employer_org_keys))`;
  } else {
    await prisma.$executeRaw`
      UPDATE user_profiles
      SET verified_employer_org_keys = array_remove(verified_employer_org_keys, ${orgKey}), updated_at = NOW()
      WHERE supabase_id = ${supabaseId}`;
  }

  const after = await prisma.userProfile.findUnique({
    where: { supabaseId },
    select: { verifiedEmployerOrgKeys: true },
  });
  return { ok: true, verifiedEmployerOrgKeys: after?.verifiedEmployerOrgKeys ?? [] };
}
