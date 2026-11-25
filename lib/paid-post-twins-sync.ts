import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { feedListingsWhere } from '@/lib/employer-feed-listings';
import {
  PAID_POST_STATUSES,
  actingOrgKeys,
  computeTwinTargets,
  employerOrgKey,
  postedByItsAccount,
  type AuthoredPost,
  type PaidTwinSource,
} from '@/lib/paid-post-twins';

type Db = typeof prisma;

/** A live paid post that would hide listings once its account is verified. */
export interface TwinAwaitingVerification {
  /** The paid post's Job.id. */
  paidJobId: string;
  /** The company name the account typed. */
  employerName: string;
  /** Listings it would hide. */
  copies: number;
}

export interface TwinSyncResult {
  /** Paid posts that are live right now. */
  livePaidPosts: number;
  /** Published free listings from those employers that were checked. */
  candidates: number;
  /** Free listings hidden as copies after this run. */
  shadowed: number;
  /** Of those, how many this run newly pointed at a paid post. */
  newlyShadowed: number;
  /** Listings whose mark this run cleared. */
  released: number;
  /** Paid posts this run filed under the company their copies were listed under. */
  linkedToCompany: number;
  /** Paid posts this run took off a company page after their verification ended. */
  unlinkedFromCompany: number;
  /** Paid posts with copies that wait for /admin/verify-employers. */
  awaitingVerification: TwinAwaitingVerification[];
  /** Employer posts that gained or lost the "Verified employer" check this run. */
  badgesGranted: number;
  badgesRemoved: number;
  /** Slugs of employer posts whose page this run changed (the check or the company), for revalidation. */
  changedPostSlugs: string[];
}

const TWIN_FIELDS = {
  id: true,
  slug: true,
  title: true,
  employer: true,
  location: true,
  companyId: true,
  city: true,
  stateCode: true,
  isRemote: true,
  jobType: true,
} as const;

/** A paid post's columns: TWIN_FIELDS, and when the sync filed it under a company. */
const PAID_POST_FIELDS = { ...TWIN_FIELDS, twinCompanyLinkedAt: true } as const;

/**
 * Most ids one statement binds. PostgreSQL takes at most 32767 bind
 * parameters in a statement, and a verification revoked for a large employer
 * releases every copy of its posts at once, so every id list is written in
 * statements of this many, all inside the one transaction.
 */
export const ID_CHUNK_SIZE = 1000;

interface PostingAccountRow {
  supabaseId: string;
  email: string;
  verifiedEmployerOrgKeys: string[];
}

type PaidPost = PaidTwinSource & { companyId: string | null; slug: string | null; twinCompanyLinkedAt: Date | null };

interface Candidate {
  id: string;
  title: string;
  employer: string;
  location: string | null;
  companyId: string | null;
  city: string | null;
  stateCode: string | null;
  isRemote: boolean;
  jobType: string | null;
  shadowedByJobId: string | null;
}

interface BadgeRow extends AuthoredPost {
  employerName: string;
  job: { id: string; slug: string | null; employer: string; isVerifiedEmployer: boolean };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** `items` in consecutive runs of at most `size`; none for an empty list. */
export function chunked<T>(items: readonly T[], size: number = ID_CHUNK_SIZE): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

/** The company most of these copies are listed under, or null when none has one. */
function commonCompanyId(companyIds: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const id of companyIds) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = id;
  return best;
}

async function loadAccounts(db: Db, rows: readonly AuthoredPost[]): Promise<Map<string, PostingAccountRow>> {
  const ids = unique(rows.map((row) => row.userId ?? ''));
  if (ids.length === 0) return new Map();
  const accounts = await db.userProfile.findMany({
    where: { supabaseId: { in: ids } },
    select: { supabaseId: true, email: true, verifiedEmployerOrgKeys: true },
  });
  return new Map(accounts.map((account) => [account.supabaseId, account]));
}

/** The posting account's verified keys, only for a post that account made itself. */
function verifiedKeysFor(row: AuthoredPost, accounts: ReadonlyMap<string, PostingAccountRow>): readonly string[] {
  const account = row.userId ? accounts.get(row.userId) : undefined;
  return account && postedByItsAccount(row, account) ? account.verifiedEmployerOrgKeys : [];
}

/**
 * Listings that would be shown but for a mark: hiding or counting a listing
 * nobody can see (expired, unpublished, or off-specialty) does nothing, and
 * /admin/verify-employers counts what it shows by this same predicate.
 */
async function loadCandidates(db: Db, paidPosts: readonly PaidPost[], now: Date): Promise<Candidate[]> {
  const listingsWhere = await feedListingsWhere(paidPosts.flatMap((paid) => [paid.employerName, paid.employer]), db);
  if (listingsWhere === null) return [];
  return db.job.findMany({
    where: { AND: [{ ...activeIndexableJobWhere(now), shadowedByJobId: undefined }, listingsWhere] },
    select: { ...TWIN_FIELDS, shadowedByJobId: true },
  });
}

/** What each post would hide if its account were verified for its own name: the /admin/verify-employers queue. */
function postsAwaitingVerification(
  paidPosts: readonly PaidPost[],
  candidates: readonly Candidate[],
  targets: ReadonlyMap<string, string>,
): TwinAwaitingVerification[] {
  const proposed = computeTwinTargets(
    paidPosts.map((paid) => ({
      ...paid,
      verifiedOrgKeys: unique([employerOrgKey(paid.employerName) ?? '', employerOrgKey(paid.employer) ?? '']),
    })),
    candidates,
  );
  const marked = new Set(targets.values());
  const counts = new Map<string, number>();
  for (const paidId of proposed.values()) counts.set(paidId, (counts.get(paidId) ?? 0) + 1);
  return paidPosts
    .filter((paid) => (counts.get(paid.id) ?? 0) > 0 && !marked.has(paid.id))
    .map((paid) => ({ paidJobId: paid.id, employerName: paid.employerName, copies: counts.get(paid.id) ?? 0 }));
}

function planMarks(candidates: readonly Candidate[], targets: ReadonlyMap<string, string>, markedIds: readonly string[]) {
  const release = markedIds.filter((id) => !targets.has(id));
  const pointAt = new Map<string, string[]>();
  for (const copy of candidates) {
    const target = targets.get(copy.id);
    if (target && copy.shadowedByJobId !== target) pointAt.set(target, [...(pointAt.get(target) ?? []), copy.id]);
  }
  return { release, pointAt };
}

/**
 * Checkout never files a paid post under a company, while ingest files its
 * copies. Hiding the copies would otherwise empty the employer's company page
 * of the very role they pay for (and 410 a page whose only listing it was),
 * so the paid post takes the company its copies were listed under, and
 * twinCompanyLinkedAt records that this sync filed it there. It files a post
 * only for a verified employer, so a post whose account is no longer verified
 * for its name gives that company page back.
 *
 * Only a link this sync made is undone. On this board an employer post can
 * also be filed under a company another way (scripts/link-all-jobs.ts files
 * every job without one, a company merge moves links), and every link older
 * than this sync was made that way: those carry no twinCompanyLinkedAt and
 * stay as they are, so the sync never undoes a link it did not make.
 */
function planCompanyLinks(paidPosts: readonly PaidPost[], candidates: readonly Candidate[], targets: ReadonlyMap<string, string>) {
  const marked = new Set(targets.values());
  const links = paidPosts
    .filter((paid) => paid.companyId === null && marked.has(paid.id))
    .map((paid) => ({
      paid,
      companyId: commonCompanyId(candidates.filter((copy) => targets.get(copy.id) === paid.id).map((copy) => copy.companyId)),
    }))
    .filter((link): link is { paid: PaidPost; companyId: string } => link.companyId !== null);
  const unlinks = paidPosts.filter((paid) => paid.companyId !== null
    && paid.twinCompanyLinkedAt instanceof Date
    && actingOrgKeys([paid.employerName, paid.employer], paid.verifiedOrgKeys).length === 0);
  return { links, unlinks };
}

/**
 * The "Verified employer" check says an operator confirmed the account is the
 * employer it named, never only that it paid, so a post carries it exactly
 * while its own account is verified for its name.
 */
function planBadges(rows: readonly BadgeRow[], accounts: ReadonlyMap<string, PostingAccountRow>) {
  const deserves = (row: BadgeRow): boolean =>
    actingOrgKeys([row.employerName, row.job.employer], verifiedKeysFor(row, accounts)).length > 0;
  return {
    on: rows.filter((row) => !row.job.isVerifiedEmployer && deserves(row)).map((row) => row.job),
    off: rows.filter((row) => row.job.isVerifiedEmployer && !deserves(row)).map((row) => row.job),
  };
}

type MarkPlan = ReturnType<typeof planMarks>;
type LinkPlan = ReturnType<typeof planCompanyLinks>;
type BadgePlan = ReturnType<typeof planBadges>;

function hasWrites(marks: MarkPlan, links: LinkPlan, badges: BadgePlan): boolean {
  return marks.release.length > 0 || marks.pointAt.size > 0 || links.links.length > 0
    || links.unlinks.length > 0 || badges.on.length > 0 || badges.off.length > 0;
}

const idsOf = (jobs: readonly { id: string }[]): string[] => jobs.map((job) => job.id);

/**
 * Raw SQL on purpose: a Prisma update bumps updated_at, which deindex-expired
 * reads as its cursor, and none of these marks is a content change. Every id
 * list goes out in statements of at most ID_CHUNK_SIZE ids, all in the one
 * transaction, so a run commits whole or not at all. The unlink is guarded
 * in its WHERE as well, so it can only undo a link this sync made.
 */
async function applyWrites(db: Db, plan: { marks: MarkPlan; links: LinkPlan; badges: BadgePlan }, now: Date): Promise<void> {
  const { marks, links, badges } = plan;
  await db.$transaction([
    ...chunked(marks.release).map((ids) =>
      db.$executeRaw`UPDATE jobs SET shadowed_by_job_id = NULL WHERE id IN (${Prisma.join(ids)})`),
    ...[...marks.pointAt].flatMap(([target, copyIds]) => chunked(copyIds).map((ids) =>
      db.$executeRaw`UPDATE jobs SET shadowed_by_job_id = ${target} WHERE id IN (${Prisma.join(ids)})`)),
    ...links.links.map(({ paid, companyId }) =>
      db.$executeRaw`UPDATE jobs SET company_id = ${companyId}, twin_company_linked_at = ${now} WHERE id = ${paid.id} AND company_id IS NULL`),
    ...chunked(idsOf(links.unlinks)).map((ids) =>
      db.$executeRaw`UPDATE jobs SET company_id = NULL, twin_company_linked_at = NULL WHERE id IN (${Prisma.join(ids)}) AND twin_company_linked_at IS NOT NULL`),
    ...chunked(idsOf(badges.on)).map((ids) =>
      db.$executeRaw`UPDATE jobs SET is_verified_employer = true WHERE id IN (${Prisma.join(ids)})`),
    ...chunked(idsOf(badges.off)).map((ids) =>
      db.$executeRaw`UPDATE jobs SET is_verified_employer = false WHERE id IN (${Prisma.join(ids)})`),
  ]);
}

function changedSlugs(links: LinkPlan, badges: BadgePlan): string[] {
  const posts = [...links.links.map((link) => link.paid), ...links.unlinks, ...badges.on, ...badges.off];
  return unique(posts.map((post) => post.slug ?? ''));
}

/**
 * Recomputes Job.shadowedByJobId for every free listing (see
 * lib/paid-post-twins.ts for what counts as a copy and who may hide one).
 * Idempotent: a run with nothing new writes nothing. A copy's mark clears on
 * the first run after its paid post expires, is paused or is deleted
 * (deletion also clears it through the foreign key), or after the account's
 * verification is revoked, and a revoked post leaves the company page this
 * sync filed it under (planCompanyLinks).
 *
 * It also keeps the "Verified employer" check honest on every employer post
 * (planBadges). This sync is the only writer for employer posts; a per-job
 * toggle in the admin jobs editor is overridden on the next run.
 *
 * `dryRun` computes the result without writing, for /admin/verify-employers.
 */
export async function syncPaidPostTwins(
  options: { db?: Db; now?: Date; dryRun?: boolean } = {},
): Promise<TwinSyncResult> {
  const db = options.db ?? prisma;
  const now = options.now ?? new Date();

  // Live means visible: the same predicate the listings use.
  const [paidRows, badgeRows] = await Promise.all([
    db.employerJob.findMany({
      where: { paymentStatus: { in: [...PAID_POST_STATUSES] }, job: activeIndexableJobWhere(now) },
      select: { employerName: true, userId: true, quotaDomain: true, job: { select: PAID_POST_FIELDS } },
      orderBy: { createdAt: 'desc' },
    }),
    db.employerJob.findMany({
      select: {
        employerName: true,
        userId: true,
        quotaDomain: true,
        job: { select: { id: true, slug: true, employer: true, isVerifiedEmployer: true } },
      },
    }),
  ]);

  const accounts = await loadAccounts(db, [...paidRows, ...badgeRows]);
  const paidPosts: PaidPost[] = paidRows.map((row) => ({
    ...row.job,
    employerName: row.employerName,
    verifiedOrgKeys: verifiedKeysFor(row, accounts),
  }));
  const candidates = await loadCandidates(db, paidPosts, now);
  const targets = computeTwinTargets(paidPosts, candidates);

  const markedNow = await db.job.findMany({ where: { shadowedByJobId: { not: null } }, select: { id: true } });
  const marks = planMarks(candidates, targets, markedNow.map((job) => job.id));
  const links = planCompanyLinks(paidPosts, candidates, targets);
  const badges = planBadges(badgeRows, accounts);

  if (!options.dryRun && hasWrites(marks, links, badges)) await applyWrites(db, { marks, links, badges }, now);

  return {
    livePaidPosts: paidPosts.length,
    candidates: candidates.length,
    shadowed: targets.size,
    newlyShadowed: [...marks.pointAt.values()].reduce((total, copyIds) => total + copyIds.length, 0),
    released: marks.release.length,
    linkedToCompany: links.links.length,
    unlinkedFromCompany: links.unlinks.length,
    awaitingVerification: postsAwaitingVerification(paidPosts, candidates, targets),
    badgesGranted: badges.on.length,
    badgesRemoved: badges.off.length,
    changedPostSlugs: changedSlugs(links, badges),
  };
}

/** Hour (UTC) of the one daily reminder about posts waiting for verification. */
export const VERIFICATION_DIGEST_UTC_HOUR = 14;

/** Most waiting posts named in one reminder; the rest are counted. */
const DIGEST_MAX_LINES = 10;

/** A typed company name made safe for a Discord message: no mentions or markup. */
function plainName(name: string): string {
  return name.replace(/[@<>`*_~|\\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Unnamed employer';
}

/** The daily Discord reminder, or null when nothing is waiting. */
export function verificationDigest(awaiting: readonly TwinAwaitingVerification[], adminUrl: string): string | null {
  if (awaiting.length === 0) return null;
  const lines = awaiting
    .slice(0, DIGEST_MAX_LINES)
    .map((post) => `- ${plainName(post.employerName)}: ${post.copies} free listing${post.copies === 1 ? '' : 's'} would be hidden`);
  const more = awaiting.length > DIGEST_MAX_LINES ? [`- and ${awaiting.length - DIGEST_MAX_LINES} more`] : [];
  return [
    `${awaiting.length} paid post${awaiting.length === 1 ? ' is' : 's are'} waiting for employer verification. Their free copies stay listed until you confirm the account is that employer.`,
    ...lines,
    ...more,
    `Review: ${adminUrl}`,
  ].join('\n');
}
