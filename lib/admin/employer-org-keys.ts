import { FREE_EMAIL_DOMAINS } from '@/lib/pricing';

/**
 * Identity keys that group employer accounts and posts into one organization
 * on the admin pages (the Employers overview and Verify Employers).
 *
 *   acct:<account id>   the posting account (UserProfile.supabaseId, which is
 *                       what EmployerJob.userId stores)
 *   dom:<domain>        a business mail domain: the post's quotaDomain when it
 *                       has one, else the domain of the signup email
 *
 * Two accounts or posts that share any key are one organization. A free mail
 * domain (lib/pricing.ts FREE_EMAIL_DOMAINS, the list every posting gate
 * uses) never gives a dom: key, so two strangers on the same free mailbox
 * provider never merge. Everything is lowercased; a domain loses surrounding
 * dots and must contain a dot to count.
 *
 * Pure: no database access, so the grouping is testable on plain objects.
 */

export const ACCOUNT_KEY_PREFIX = 'acct:';
export const DOMAIN_KEY_PREFIX = 'dom:';

export interface EmployerOrgKeyInput {
  /** UserProfile.supabaseId of the account (EmployerJob.userId on a post). */
  readonly accountId: string;
  /** The account's signup email. Only its domain is read. */
  readonly signupEmail?: string | null;
  /** EmployerJob.quotaDomain: the signup domain snapshot taken at posting. */
  readonly quotaDomain?: string | null;
}

const FREE_DOMAINS: ReadonlySet<string> = new Set(FREE_EMAIL_DOMAINS.map((domain) => domain.toLowerCase()));

/** A bare domain, lowercased and trimmed of whitespace, a leading "@" and surrounding dots; null when it is not one. */
export function normalizeOrgDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const domain = raw.trim().toLowerCase().replace(/^@+/, '').replace(/^\.+|\.+$/g, '');
  if (!domain.includes('.') || domain.includes('/') || /[\s@\\]/.test(domain)) return null;
  return domain;
}

/** The domain of an email address, normalized; null when the address is malformed. */
function emailDomain(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const parts = email.trim().split('@');
  if (parts.length !== 2 || !parts[0].trim()) return null;
  return normalizeOrgDomain(parts[1]);
}

/**
 * The business domain behind an account or post: quotaDomain when it holds a
 * usable domain, else the signup email's domain. Null for a free mail domain
 * or when neither gives a domain.
 */
export function businessDomain(input: Pick<EmployerOrgKeyInput, 'signupEmail' | 'quotaDomain'>): string | null {
  const domain = normalizeOrgDomain(input.quotaDomain) ?? emailDomain(input.signupEmail);
  if (!domain || FREE_DOMAINS.has(domain)) return null;
  return domain;
}

/**
 * 'acct:<accountId>' plus 'dom:<domain>' for a business domain, lowercased,
 * without duplicates. A blank account id gives no acct: key, so rows without
 * an account never merge on an empty id.
 */
export function employerOrgKeys(input: EmployerOrgKeyInput): string[] {
  const keys: string[] = [];
  const accountId = typeof input.accountId === 'string' ? input.accountId.trim().toLowerCase() : '';
  if (accountId) keys.push(`${ACCOUNT_KEY_PREFIX}${accountId}`);
  const domain = businessDomain(input);
  if (domain) keys.push(`${DOMAIN_KEY_PREFIX}${domain}`);
  return keys;
}
