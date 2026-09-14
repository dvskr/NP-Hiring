import { prisma } from '@/lib/prisma';

/**
 * Single source of truth for token-based unsubscribe / resubscribe writes.
 *
 * Every marketing send-gate checks isEmailSuppressed() (EmailLead.isSuppressed
 * or UserProfile.emailSuppressed), NOT isSubscribed. So every opt-out path
 * (human GET, RFC 8058 one-click POST, preferences toggle) must set suppression
 * on the lead with reason 'unsubscribe' and mirror it onto the profile, and the
 * resubscribe path must lift exactly that suppression. Bounce and complaint
 * suppression (set by the Resend webhook) is never overwritten or lifted here.
 */

export const UNSUBSCRIBE_REASON = 'unsubscribe';

export const LEAD_SUPPRESSION_SELECT = {
  email: true,
  isSuppressed: true,
  suppressionReason: true,
} as const;

export interface LeadSuppressionState {
  email: string;
  isSuppressed?: boolean | null;
  suppressionReason?: string | null;
}

/** True when the lead is suppressed for a reason other than an explicit opt-out. */
function hasDeliverabilitySuppression(lead: LeadSuppressionState): boolean {
  return !!lead.isSuppressed && !!lead.suppressionReason && lead.suppressionReason !== UNSUBSCRIBE_REASON;
}

export function buildUnsubscribeLeadData(lead: LeadSuppressionState, now: Date) {
  const base = { isSubscribed: false, newsletterOptIn: false, isSuppressed: true } as const;
  // Keep a bounce/complaint reason intact: relabelling it 'unsubscribe' would
  // let a later resubscribe resurrect an undeliverable address.
  if (hasDeliverabilitySuppression(lead)) return { ...base };
  return { ...base, suppressedAt: now, suppressionReason: UNSUBSCRIBE_REASON };
}

export function canLiftSuppression(lead: LeadSuppressionState): boolean {
  return !hasDeliverabilitySuppression(lead);
}

/** Suppress the lead identified by token and mirror onto the registered profile. */
export async function unsubscribeLead(token: string, lead: LeadSuppressionState): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.emailLead.update({
      where: { unsubscribeToken: token },
      data: buildUnsubscribeLeadData(lead, now),
    }),
    prisma.userProfile.updateMany({
      where: { email: lead.email },
      data: { emailSuppressed: true, emailSuppressedAt: now },
    }),
  ]);
}

/**
 * Resubscribe the lead identified by token. Lifts suppression (lead and profile)
 * only when it came from an explicit unsubscribe, or when the lead carries an
 * isSuppressed flag with no recorded reason (legacy one-click writes, which only
 * ever came from an opt-out; bounce and complaint always record a reason).
 *
 * Returns false and writes nothing when the address carries a bounce or
 * complaint suppression: the caller must report that the resubscribe did not
 * take effect instead of telling the user they are subscribed again.
 */
export async function resubscribeLead(token: string, lead: LeadSuppressionState): Promise<boolean> {
  if (!canLiftSuppression(lead)) return false;
  await prisma.$transaction([
    prisma.emailLead.update({
      where: { unsubscribeToken: token },
      data: { isSubscribed: true, isSuppressed: false, suppressedAt: null, suppressionReason: null },
    }),
    prisma.userProfile.updateMany({
      // Never lift the suppression a soft-deleted account carries.
      where: { email: lead.email, deletedAt: null },
      data: { emailSuppressed: false, emailSuppressedAt: null },
    }),
  ]);
  return true;
}

/** User-facing reason a resubscribe could not take effect. */
export const UNDELIVERABLE_MESSAGE =
  'We cannot resubscribe this address because earlier emails to it could not be delivered. Please contact support.';

/** Known per-category opt-out keys stored in EmailLead.preferences. */
export const PREFERENCE_KEYS = ['profileNudge', 'savedJobReminder'] as const;
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];
export type EmailPreferences = Partial<Record<PreferenceKey, boolean>>;

/**
 * Validate a client-supplied preferences payload: a plain flat object whose keys
 * are all known and whose values are all booleans. Returns null when invalid.
 */
export function parsePreferences(input: unknown): EmailPreferences | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  if (Object.getPrototypeOf(input) !== Object.prototype) return null;
  const entries = Object.entries(input as Record<string, unknown>);
  const known = new Set<string>(PREFERENCE_KEYS);
  const result: EmailPreferences = {};
  for (const [key, value] of entries) {
    if (!known.has(key) || typeof value !== 'boolean') return null;
    result[key as PreferenceKey] = value;
  }
  return result;
}
