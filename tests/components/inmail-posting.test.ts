/**
 * The compose dialog's InMail figures, and the posting a message from the
 * candidate page names.
 *
 * POST /api/employer/messages spends a named job's credit on that job's own
 * posting, never another's (lib/tier-limits.ts canSendInMail). The dialog
 * showed the total across postings, so it could read "20 InMails remaining"
 * for a posting that had none left, and the candidate page named the posting
 * selected in the talent pool even once it had spent its credit, though
 * another posting had some. Every fixture is fictional.
 */
import { describe, expect, it } from 'vitest';
import { inMailUsageFor, postingForMessage, type PostingUsage } from '@/components/employer/inmail-posting';

function posting(id: string, remaining: number, limit = 25): PostingUsage {
    return {
        id,
        jobId: `job-${id}`,
        jobTitle: `Role ${id}`,
        inmails: { used: limit === -1 ? 0 : limit - remaining, limit, remaining },
    };
}

const USAGE = {
    usage: { inmails: { used: 30, limit: 50, unlimited: false } },
    postings: [posting('newest', 0), posting('older', 20)],
};

describe('inMailUsageFor: what the compose dialog shows', () => {
    it("shows the named job's posting, not the total across postings", () => {
        expect(inMailUsageFor(USAGE, 'job-newest')).toEqual({ used: 25, limit: 25, unlimited: false, forPosting: true });
        expect(inMailUsageFor(USAGE, 'job-older')).toEqual({ used: 5, limit: 25, unlimited: false, forPosting: true });
    });

    it('shows the total with no job named, or for a job that is no active posting', () => {
        const total = { used: 30, limit: 50, unlimited: false, forPosting: false };
        expect(inMailUsageFor(USAGE, undefined)).toEqual(total);
        expect(inMailUsageFor(USAGE, 'job-ended')).toEqual(total);
    });

    it('reads -1 as unlimited, and nothing as nothing', () => {
        expect(inMailUsageFor({ postings: [posting('open', -1, -1)] }, 'job-open')).toEqual({ used: 0, limit: null, unlimited: true, forPosting: true });
        expect(inMailUsageFor(null, 'job-newest')).toBeNull();
        expect(inMailUsageFor({}, undefined)).toBeNull();
    });
});

describe('postingForMessage: the job a message from the candidate page names', () => {
    const postings = [posting('newest', 0), posting('middle', 0), posting('older', 3)];

    it('names the posting selected in the talent pool while it has credit left', () => {
        expect(postingForMessage([posting('a', 2), posting('b', 9)], 'b')?.id).toBe('b');
    });

    it('names the first posting with credit once the selected one has none', () => {
        expect(postingForMessage(postings, 'newest')?.id).toBe('older');
        expect(postingForMessage(postings, null)?.id).toBe('older');
    });

    it('counts an unlimited posting as having credit', () => {
        expect(postingForMessage([posting('spent', 0), posting('open', -1, -1)], 'spent')?.id).toBe('open');
    });

    it('names the selected posting, or the first, when none has credit, so the dialog shows its limit', () => {
        const spent = [posting('newest', 0), posting('older', 0)];
        expect(postingForMessage(spent, 'older')?.id).toBe('older');
        expect(postingForMessage(spent, 'gone')?.id).toBe('newest');
        expect(postingForMessage([], 'newest')).toBeUndefined();
    });
});
