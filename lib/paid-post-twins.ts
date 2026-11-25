import { STATE_CODE_TO_NAME } from '@/lib/us-states';
import { DOMAIN_KEY_PREFIX, employerOrgKeys } from '@/lib/admin/employer-org-keys';

/**
 * Paid-post twins: a free aggregated listing that duplicates a role the same
 * employer is paying to feature.
 *
 * WHY THIS EXISTS
 * An employer who paid for a post on a role we already list from their
 * careers page was competing with its own free copies. Applicants who came
 * through a copy applied on the careers page, so the paid post's dashboard
 * never saw them, and that dashboard is what the employer reads when deciding
 * whether to renew. While a paid post is live its copies are hidden from every
 * listing predicate and their detail URLs redirect to it
 * (lib/paid-post-twins-sync.ts writes the marks, middleware.ts redirects).
 *
 * WHO MAY HIDE A LISTING
 * Only an account an operator has confirmed speaks for that employer
 * (UserProfile.verifiedEmployerOrgKeys, set from /admin/verify-employers).
 * A paid post's company name is whatever the account typed, and checkout
 * publishes on payment, so trusting the name would let anyone who pays take
 * a rival's listings off the board and redirect their traffic.
 *
 * WHAT COUNTS AS A COPY is deliberately narrow. Large telehealth employers
 * reuse one title for dozens of per-state openings, so a title match alone
 * would hide real openings in states the employer never paid for. A copy has
 * the same employer name once legal suffixes are set aside (never a company
 * row reached through the ingest's looser normalizer, which files different
 * practices under one key), the same title, the same job type when both say,
 * and the same place:
 *   - on-site: the same city and state, both named, and not another site in
 *     that city: a copy naming a different site than the paid post's is a
 *     different opening, and so are copies naming several sites when the
 *     paid post names none (see sameOpening);
 *   - remote: the same state, or a title that names the paid post's state
 *     ("CA Virtual"). Remote listings often carry a hub city that says
 *     nothing about where the role is licensed.
 */

export interface TwinJob {
  id: string;
  title: string;
  employer: string;
  /** The listing's location as written, which can name a site within a city. */
  location: string | null;
  city: string | null;
  stateCode: string | null;
  isRemote: boolean;
  jobType: string | null;
}

export interface PaidTwinSource extends TwinJob {
  /** EmployerJob.employerName, which can differ from Job.employer. */
  employerName: string;
  /** The posting account's UserProfile.verifiedEmployerOrgKeys. */
  verifiedOrgKeys: readonly string[];
}

/** Payment statuses of a post the employer paid for: a checkout, a bought pack credit, or the retired plan. */
export const PAID_POST_STATUSES: readonly string[] = ['paid', 'pack', 'plan'];

/**
 * Payment statuses of a post that went live on the board, free or paid. Not
 * 'pending' or 'expired' (a checkout never paid), nor 'refunded' or
 * 'disputed' (the money went back).
 */
export const LIVE_POST_STATUSES: readonly string[] = [
  'free', 'free_renewed', 'free_upgraded', 'promo', 'pack', 'plan', 'paid',
];

/** Legal suffixes and articles that never tell two employers apart. */
const LEGAL_TOKENS: ReadonlySet<string> = new Set([
  'llc', 'inc', 'incorporated', 'pc', 'pllc', 'plc', 'corp', 'corporation', 'co',
  'ltd', 'limited', 'llp', 'lp', 'pa', 'group', 'the',
]);

/**
 * The identity a name reduces to: lowercased, punctuation and legal suffixes
 * dropped ("Acme Behavioral Health, PLLC" and "Acme Behavioral Health" agree),
 * descriptive words kept ("Summit Ridge Health" and "Summit Ridge Medical Group" do
 * not). Null for a blank name. These keys are what
 * UserProfile.verifiedEmployerOrgKeys stores.
 */
export function employerOrgKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const joined = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '' && !LEGAL_TOKENS.has(token))
    .join('');
  return joined === '' ? null : joined;
}

/** The account a post's authorship is checked against. */
export interface PostingAccount {
  supabaseId: string;
  email: string;
}

/** The post fields that say which account made it. */
export interface AuthoredPost {
  userId: string | null;
  quotaDomain: string | null;
}

function domainKeys(keys: readonly string[]): string[] {
  return keys.filter((key) => key.startsWith(DOMAIN_KEY_PREFIX));
}

/**
 * True when the account on a post is the account that made it. The sign-in
 * callback attaches unclaimed posts to whoever signs in with the post's
 * contact email (app/auth/callback/route.ts), a field the poster typed, so an
 * attached post may have been paid for by someone else, and an account's
 * verification must not reach it.
 *
 * NP Hiring proves authorship with EmployerJob.quotaDomain, the signup domain
 * written once when the post is created and never updated: the post counts
 * when that domain gives the same business key (lib/admin/employer-org-keys.ts)
 * as the email the account signs in with. lib/auth/email-change-policy.ts
 * stops an account changing its email domain once it has posted, so the two
 * stay equal for every post the account made. A free mail domain gives no
 * key, so a post made from one never counts as proof.
 */
export function postedByItsAccount(post: AuthoredPost, account: PostingAccount | null | undefined): boolean {
  if (!account || post.userId === null || post.userId !== account.supabaseId) return false;
  const postKeys = domainKeys(employerOrgKeys({ accountId: post.userId, quotaDomain: post.quotaDomain }));
  if (postKeys.length === 0) return false;
  const accountKeys = domainKeys(employerOrgKeys({ accountId: account.supabaseId, signupEmail: account.email }));
  return postKeys.some((key) => accountKeys.includes(key));
}

/** Org keys of these names that the account has been verified for. */
export function actingOrgKeys(
  names: readonly (string | null | undefined)[],
  verifiedOrgKeys: readonly string[],
): string[] {
  const keys = names.map(employerOrgKey).filter((key): key is string => key !== null);
  return [...new Set(keys)].filter((key) => verifiedOrgKeys.includes(key));
}

/** Title identity: case, spacing and punctuation never make two roles different. */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function nameKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cityKey(city: string | null): string {
  return (city ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Full state names, longest first so "West Virginia" is read before "Virginia". */
const STATE_NAMES_LONGEST_FIRST: readonly [RegExp, string][] = Object.entries(STATE_CODE_TO_NAME)
  .sort(([, a], [, b]) => b.length - a.length)
  .map(([code, name]) => [new RegExp(`\\b${name.toLowerCase().replace(/\s+/g, '\\s+')}\\b`, 'g'), code.toLowerCase()]);

/**
 * A place as written, reduced to what tells two places apart: case,
 * punctuation, ZIP codes and a trailing country never do, and a state reads
 * the same by name or code ("Houston, Texas 77001, USA" is "Houston, TX").
 */
function placeKey(text: string): string {
  let key = text.toLowerCase()
    .replace(/\b\d{5}(?:-\d{4})?\b/g, ' ')
    .replace(/\b(?:united states(?: of america)?|usa|u\.s\.a\.?)\b/g, ' ');
  for (const [name, code] of STATE_NAMES_LONGEST_FIRST) key = key.replace(name, code);
  return key.replace(/[^a-z0-9]+/g, '');
}

function locationKey(job: Pick<TwinJob, 'location'>): string {
  return placeKey(job.location ?? '');
}

/** True when the listing's location says no more than its city and state. */
function isBareLocation(job: Pick<TwinJob, 'location' | 'city' | 'stateCode'>): boolean {
  const key = locationKey(job);
  return key === '' || key === placeKey(`${job.city ?? ''} ${job.stateCode ?? ''}`);
}

function stateKey(code: string | null): string {
  return (code ?? '').trim().toUpperCase();
}

/**
 * Codes that mean something else in a job title, so only the full state name
 * counts for them: MD the degree, PA the profession, MA and MS the degrees,
 * VA the Veterans Affairs, MI as in SMI, LA the city, and short words that
 * turn up in upper-case titles.
 */
const AMBIGUOUS_TITLE_CODES: ReadonlySet<string> = new Set([
  'MD', 'PA', 'MA', 'MS', 'VA', 'MI', 'LA', 'OR', 'IN', 'ME', 'OK', 'HI', 'DE', 'CO', 'NE', 'ID', 'CT', 'DC',
]);

/** Longer place names that contain a state's name as a whole word. */
const NAME_CONTAINERS: Readonly<Record<string, RegExp>> = {
  VA: /west\s+virginia/gi,
  WA: /washington,?\s*d\.?\s*c\.?/gi,
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when the title names this state by its full name or, unambiguously, its code. */
export function titleNamesState(title: string, stateCode: string): boolean {
  const code = stateKey(stateCode);
  const name = STATE_CODE_TO_NAME[code];
  if (!name) return false;
  const container = NAME_CONTAINERS[code];
  const text = container ? title.replace(container, ' ') : title;
  if (new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text)) return true;
  if (AMBIGUOUS_TITLE_CODES.has(code)) return false;
  return new RegExp(`(?:^|[^A-Za-z])${code}(?:[^A-Za-z]|$)`).test(text);
}

function sameEmployer(paid: PaidTwinSource, copy: TwinJob): boolean {
  const copyKey = employerOrgKey(copy.employer);
  return copyKey !== null && actingOrgKeys([paid.employerName, paid.employer], paid.verifiedOrgKeys).includes(copyKey);
}

/** Different job types (full-time vs PRN) are different openings. */
function sameJobType(paid: PaidTwinSource, copy: TwinJob): boolean {
  const paidType = nameKey(paid.jobType);
  const copyType = nameKey(copy.jobType);
  return paidType === '' || copyType === '' || paidType === copyType;
}

function samePlace(paid: PaidTwinSource, copy: TwinJob): boolean {
  if (paid.isRemote !== copy.isRemote) return false;
  const paidState = stateKey(paid.stateCode);

  if (!paid.isRemote) {
    const city = cityKey(paid.city);
    return paidState !== '' && city !== ''
      && paidState === stateKey(copy.stateCode) && city === cityKey(copy.city);
  }

  if (paidState === '') return false;
  return paidState === stateKey(copy.stateCode) || titleNamesState(paid.title, paidState);
}

export function isPaidPostTwin(paid: PaidTwinSource, copy: TwinJob): boolean {
  if (copy.id === paid.id) return false;
  const key = titleKey(paid.title);
  if (key === '' || key !== titleKey(copy.title)) return false;
  return sameEmployer(paid, copy) && sameJobType(paid, copy) && samePlace(paid, copy);
}

/**
 * Two same-titled on-site openings in one city can be different sites
 * ("Houston, TX: Medical Center" and "Houston, TX: Clear Lake").
 *   - A paid post that names its site hides copies at that site and copies
 *     that give only the city; a copy naming another site is another opening.
 *   - A paid post that gives only the city cannot tell sites apart. Copies
 *     that all give one location are one opening listed by several sources;
 *     when they name different sites, only those that also give just the
 *     city are hidden.
 * Remote copies differ only in a hub city that says nothing about the role.
 */
function sameOpening(paid: PaidTwinSource, copies: readonly TwinJob[]): readonly TwinJob[] {
  if (paid.isRemote) return copies;
  const own = locationKey(paid);
  if (!isBareLocation(paid)) return copies.filter((copy) => isBareLocation(copy) || locationKey(copy) === own);
  if (new Set(copies.map(locationKey)).size <= 1) return copies;
  return copies.filter((copy) => locationKey(copy) === own);
}

/**
 * Maps each copy's id to the paid post it duplicates. `paidPosts` must be
 * ordered newest first: a listing that duplicates two live paid posts points
 * at the newer one, which stays up longer. A copy the newer post leaves
 * (another site) is still open to an older post at that site.
 */
export function computeTwinTargets(
  paidPosts: readonly PaidTwinSource[],
  candidates: readonly TwinJob[],
): Map<string, string> {
  const paidIds = new Set(paidPosts.map((paid) => paid.id));
  const open = candidates.filter((copy) => !paidIds.has(copy.id));
  const targets = new Map<string, string>();
  for (const paid of paidPosts) {
    const copies = open.filter((copy) => !targets.has(copy.id) && isPaidPostTwin(paid, copy));
    for (const copy of sameOpening(paid, copies)) targets.set(copy.id, paid.id);
  }
  return targets;
}
