/**
 * Review sandbox for the Claude and ChatGPT directory reviewers (owner
 * decision 2026-10-28).
 *
 * Reviewers must be able to search, apply and withdraw end to end without a
 * real employer receiving a test application. The sandbox is a handful of
 * Easy Apply jobs that NP Hiring itself owns:
 *   - stored with isPublished = false, so the website, the sitemaps, the job
 *     alerts and every listing query skip them as they skip any unpublished
 *     job;
 *   - marked with sourceProvider = REVIEW_SANDBOX_SOURCE_PROVIDER and
 *     created by scripts/mcp-review-sandbox.ts;
 *   - visible only to the accounts listed in MCP_REVIEWER_USER_IDS (Supabase
 *     auth ids, comma separated), and only through the MCP endpoints;
 *   - with no employer_jobs row, so an application to one emails no
 *     employer, and it is never AI scored.
 * Everyone else, signed in or not, gets exactly what they would get without
 * this file.
 */

export const REVIEW_SANDBOX_SOURCE_PROVIDER = 'nphiring-review-sandbox';

/** Supabase auth ids allowed to see the sandbox, read on every call (tests and deploys can change it). */
export function reviewerUserIds(): ReadonlySet<string> {
    const raw = process.env.MCP_REVIEWER_USER_IDS ?? '';
    return new Set(
        raw
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0),
    );
}

export function isReviewer(userId: string | null | undefined): boolean {
    return typeof userId === 'string' && userId.length > 0 && reviewerUserIds().has(userId);
}

/** True for a sandbox job: unpublished and marked with the sandbox provider. */
export function isSandboxJob(job: { isPublished: boolean; sourceProvider: string | null }): boolean {
    return !job.isPublished && job.sourceProvider === REVIEW_SANDBOX_SOURCE_PROVIDER;
}
