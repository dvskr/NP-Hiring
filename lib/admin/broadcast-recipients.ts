import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    MAILABLE_PROFILES,
    MAILING_LIST_LEADS,
    NEWSLETTER_LEADS,
    OPTED_OUT_LEADS,
    UNMAILABLE_PROFILES,
    type BroadcastSegment,
} from '@/lib/admin/broadcast-audience';

export interface BroadcastRecipient {
    email: string;
    firstName?: string | null;
}

type AccountRole = 'job_seeker' | 'employer';

/** Lower-cased addresses that unsubscribed by hand or are suppressed. */
async function loadOptedOutEmails(): Promise<Set<string>> {
    const rows = await prisma.emailLead.findMany({
        where: OPTED_OUT_LEADS,
        select: { email: true },
    });
    return new Set(rows.map((row) => row.email.toLowerCase()));
}

/** Account holders (all roles, or one), less every opted-out address. */
async function accountHolders(role?: AccountRole): Promise<BroadcastRecipient[]> {
    const where: Prisma.UserProfileWhereInput = role ? { ...MAILABLE_PROFILES, role } : MAILABLE_PROFILES;
    const [profiles, optedOut] = await Promise.all([
        prisma.userProfile.findMany({
            where,
            select: { email: true, firstName: true },
            orderBy: { createdAt: 'desc' },
        }),
        loadOptedOutEmails(),
    ]);
    return profiles
        .filter((profile) => !optedOut.has(profile.email.toLowerCase()))
        .map((profile) => ({ email: profile.email, firstName: profile.firstName }));
}

/** Lower-cased addresses of accounts that must not be mailed: suppressed or deleted. */
async function loadUnmailableAccountEmails(): Promise<Set<string>> {
    const rows = await prisma.userProfile.findMany({
        where: UNMAILABLE_PROFILES,
        select: { email: true },
    });
    return new Set(rows.map((row) => row.email.toLowerCase()));
}

/**
 * Mailing list entries matching `where`, less every entry whose address
 * belongs to a suppressed or deleted account: the list entry of a person who
 * deleted their account, or whose mail bounced, keeps its own flags, and
 * without this they were counted and mailed through it.
 */
async function mailingList(where: Prisma.EmailLeadWhereInput): Promise<BroadcastRecipient[]> {
    const [leads, unmailable] = await Promise.all([
        prisma.emailLead.findMany({
            where,
            select: { email: true },
            orderBy: { createdAt: 'desc' },
        }),
        loadUnmailableAccountEmails(),
    ]);
    return leads
        .filter((lead) => !unmailable.has(lead.email.toLowerCase()))
        .map((lead) => ({ email: lead.email }));
}

/** One entry per address (case-insensitive); the first list to name it wins. */
function mergeByEmail(lists: ReadonlyArray<readonly BroadcastRecipient[]>): BroadcastRecipient[] {
    const seen = new Set<string>();
    return lists.flat().filter((recipient) => {
        const key = recipient.email.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * The people a named broadcast audience reaches. The audience count shown
 * before sending and the recipient rows the send creates are both built
 * here, so the number the admin approves is the list that is sent.
 *
 *  - job_seekers / employers: accounts of that role, not suppressed or
 *    deleted, less anyone who unsubscribed by hand.
 *  - subscribers: mailing list entries that asked for mail (MAILING_LIST_LEADS).
 *  - newsletter: newsletter opt-ins, subscribed and not suppressed.
 *  - all: every mailable account, then the mailing list, one row per address.
 *
 * Every list entry whose address belongs to a suppressed or deleted account
 * is left out of the three that read the mailing list (UNMAILABLE_PROFILES).
 */
export async function buildSegmentRecipients(segment: BroadcastSegment): Promise<BroadcastRecipient[]> {
    switch (segment) {
        case 'job_seekers':
            return accountHolders('job_seeker');
        case 'employers':
            return accountHolders('employer');
        case 'subscribers':
            return mailingList(MAILING_LIST_LEADS);
        case 'newsletter':
            return mailingList(NEWSLETTER_LEADS);
        case 'all': {
            const [accounts, leads] = await Promise.all([accountHolders(), mailingList(MAILING_LIST_LEADS)]);
            return mergeByEmail([accounts, leads]);
        }
        default: {
            // Callers check the name with isBroadcastSegment first; a value
            // that slips past must fail, never fall through to everyone.
            const unexpected: never = segment;
            throw new Error(`Unknown broadcast audience: ${String(unexpected)}`);
        }
    }
}
