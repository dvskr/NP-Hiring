/**
 * Status fields written by POST /api/applications/apply-direct.
 *
 * Kept separate from route.ts (route modules may only export HTTP handlers)
 * so the rules can be unit tested.
 *
 *  - A knockout answer auto-rejects the application (create and update).
 *  - Re-applying after a withdrawal returns the application to 'applied'.
 *    The withdraw route writes status 'withdrawn' + withdrawnAt; apply-direct
 *    clears withdrawnAt, so it must also clear the status, otherwise the row
 *    reads "withdrawn" forever (P10 apply-flow defect 2).
 *  - Re-submitting an application that is still active leaves the status
 *    alone, so a resubmit never rolls back an employer's pipeline progress
 *    (screening, interview, offered).
 *  - A brand new application takes the schema default ('applied').
 */
export interface ApplicationStatusFields {
    status?: 'applied' | 'rejected';
    statusUpdatedAt?: Date;
    notes?: string;
}

export interface ExistingApplicationState {
    status: string;
    withdrawnAt: Date | null;
}

export function isWithdrawnApplication(existing: ExistingApplicationState | null): boolean {
    if (!existing) return false;
    return existing.withdrawnAt !== null || existing.status === 'withdrawn';
}

export function buildApplicationStatusFields(
    existing: ExistingApplicationState | null,
    autoReject: boolean,
    autoRejectReason: string,
    now: Date = new Date(),
): ApplicationStatusFields {
    if (autoReject) {
        return {
            status: 'rejected',
            notes: `Auto-rejected: ${autoRejectReason}`,
            statusUpdatedAt: now,
        };
    }
    if (isWithdrawnApplication(existing)) {
        return { status: 'applied', statusUpdatedAt: now };
    }
    return {};
}
