import type { Prisma } from '@prisma/client';

/**
 * The source getOrCreateUnsubToken (lib/email-service.ts) writes on a mailing
 * list entry it creates only to hold an unsubscribe token for a marketing
 * mail.
 */
export const AUTO_LEAD_SOURCE = 'auto';

/**
 * The audiences a broadcast can name. 'custom' is not one of them: it is a
 * list the admin types, checked by the send route itself.
 */
export const BROADCAST_SEGMENTS = ['all', 'job_seekers', 'employers', 'subscribers', 'newsletter'] as const;

export type BroadcastSegment = (typeof BROADCAST_SEGMENTS)[number];

export function isBroadcastSegment(value: unknown): value is BroadcastSegment {
    return typeof value === 'string' && (BROADCAST_SEGMENTS as readonly string[]).includes(value);
}

/**
 * Mailing list entries a broadcast to "subscribers", and the list half of
 * "all", may reach: subscribed, not suppressed, and asked for mail somewhere.
 *
 * An entry created automatically never asked for marketing mail: source
 * 'auto' (getOrCreateUnsubToken) or no source at all (what receipts and other
 * side effects write). It counts only once the person has opted into the
 * newsletter or holds a job alert.
 *
 * The null case is written out. A bare `not: 'auto'` is `source <> 'auto'` in
 * SQL, which is unknown, not true, for a null source, so whether those
 * entries fell in or out would rest on how the filter happened to be phrased.
 *
 * The audience count (/api/admin/email/audience), the recipient list the send
 * builds (/api/admin/email/send) and the admin analytics subscriber figures
 * all read this, so the number the operator approves is the list that is
 * sent.
 */
export const MAILING_LIST_LEADS: Prisma.EmailLeadWhereInput = {
    isSubscribed: true,
    isSuppressed: false,
    OR: [
        { AND: [{ source: { not: null } }, { source: { not: AUTO_LEAD_SOURCE } }] },
        { newsletterOptIn: true },
        { jobAlerts: { some: {} } },
    ],
};

/** Newsletter opt-ins a "newsletter" broadcast reaches: subscribed and not suppressed. */
export const NEWSLETTER_LEADS: Prisma.EmailLeadWhereInput = {
    isSubscribed: true,
    isSuppressed: false,
    newsletterOptIn: true,
};

/**
 * Addresses left out of every audience, account holders included: a hand
 * unsubscribe (isSubscribed=false) or a suppression (bounce, complaint,
 * unsubscribe, deleted account). The account segments are built from
 * UserProfile, which does not carry the hand unsubscribe, so this list is
 * what keeps such a person out of the next "job seekers", "employers" or
 * "all" broadcast.
 */
export const OPTED_OUT_LEADS: Prisma.EmailLeadWhereInput = {
    OR: [{ isSubscribed: false }, { isSuppressed: true }],
};

/**
 * Accounts a broadcast may reach: not suppressed (bounce, complaint, deleted
 * account) and not deleted. There is no automated sender profile on this
 * board, so no role is left out.
 */
export const MAILABLE_PROFILES: Prisma.UserProfileWhereInput = {
    emailSuppressed: false,
    deletedAt: null,
};

/**
 * Accounts no broadcast may reach, the complement of MAILABLE_PROFILES:
 * suppressed (bounce, complaint, unsubscribe, deleted account) or deleted.
 * The mailing list audiences leave out an entry whose address is one of these
 * accounts, as the account audiences leave the account out, so a person who
 * deleted their account or whose mail bounced is not reached through their
 * list entry instead, and the count the operator approves is what is sent.
 */
export const UNMAILABLE_PROFILES: Prisma.UserProfileWhereInput = {
    OR: [{ emailSuppressed: true }, { deletedAt: { not: null } }],
};
