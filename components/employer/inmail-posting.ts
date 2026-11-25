/**
 * The InMail figures the compose dialog shows, and the posting the candidate
 * page names in a new message.
 *
 * POST /api/employer/messages spends a named job's credit on that job's own
 * posting, never another's (canSendInMail in lib/tier-limits.ts). So the
 * dialog shows the named posting's count, not the total across postings, and
 * the candidate page names a posting that still has credit.
 * tests/components/inmail-posting.test.ts
 */

/** One posting as GET /api/employer/usage lists it; -1 is unlimited. */
export interface PostingUsage {
    readonly id: string;
    readonly jobId: string;
    readonly jobTitle: string;
    readonly inmails: { readonly used: number; readonly limit: number; readonly remaining: number };
}

export interface InMailUsage {
    readonly used: number;
    readonly limit: number | null;
    readonly unlimited: boolean;
    /** The figures are the named job's posting's, not the employer's total. */
    readonly forPosting: boolean;
}

interface UsageResponse {
    readonly usage?: { readonly inmails?: { readonly used: number; readonly limit: number | null; readonly unlimited: boolean } };
    readonly postings?: readonly PostingUsage[];
}

const UNLIMITED = -1;

/**
 * The named job's posting's figures when GET /api/employer/usage lists it,
 * else the employer's total (no job named, or a job that is no active
 * posting, which the send then refuses on its own).
 */
export function inMailUsageFor(data: UsageResponse | null | undefined, jobId: string | undefined): InMailUsage | null {
    const posting = jobId ? data?.postings?.find((p) => p.jobId === jobId) : undefined;
    if (posting) {
        const unlimited = posting.inmails.limit === UNLIMITED;
        return { used: posting.inmails.used, limit: unlimited ? null : posting.inmails.limit, unlimited, forPosting: true };
    }
    const total = data?.usage?.inmails;
    return total ? { used: total.used, limit: total.limit, unlimited: total.unlimited, forPosting: false } : null;
}

/**
 * The posting a message from the candidate page names: the one selected in
 * the talent pool while it has InMail credit left, else the first listed that
 * has some, else the selected one (or the first), whose limit the dialog shows.
 */
export function postingForMessage<T extends PostingUsage>(postings: readonly T[], selectedId: string | null): T | undefined {
    const selected = selectedId ? postings.find((p) => p.id === selectedId) : undefined;
    const hasCredit = (p: T | undefined): p is T => p !== undefined && p.inmails.remaining !== 0;
    return [selected, ...postings].find(hasCredit) ?? selected ?? postings[0];
}
