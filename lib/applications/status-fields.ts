/**
 * Status fields written by an Easy Apply submission
 * (lib/applications/submit-direct-application.ts, used by
 * POST /api/applications/apply-direct and the AI app's submit_application).
 *
 *  - A knockout answer auto-rejects the application (create and update).
 *  - Re-applying after a withdrawal returns the application to 'applied'.
 *    The withdraw route writes status 'withdrawn' + withdrawnAt; a submission
 *    clears withdrawnAt, so it must also clear the status, otherwise the row
 *    reads "withdrawn" forever (P10 apply-flow defect 2).
 *  - Re-submitting an application that is still active leaves the status
 *    alone, so a resubmit never rolls back an employer's pipeline progress
 *    (screening, interview, offered).
 *  - A brand new application takes the schema default ('applied').
 *
 * decideSubmission adds what an earlier submission already settled: a
 * knockout it recorded, and whether the employer already has the application.
 */
import { AUTO_REJECT_NOTE_PREFIX, hasAutoRejectRecord, storedAutoRejectReason } from './auto-reject';

export interface ApplicationStatusFields {
    status?: 'applied' | 'rejected';
    statusUpdatedAt?: Date;
    notes?: string;
}

export interface ExistingApplicationState {
    status: string;
    withdrawnAt: Date | null;
    /** Private employer text, and where a knockout leaves its record. */
    notes?: string | null;
    consentGiven?: boolean;
    /** 'platform' for an Easy Apply row; the apply link or null for a row the candidate only tracked. */
    sourceUrl?: string | null;
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
        // The knockout record goes on top of the notes, never in their place:
        // notes is also where the employer types, and a row the candidate only
        // tracked can already carry them.
        const record = `${AUTO_REJECT_NOTE_PREFIX}${autoRejectReason}`;
        return {
            status: 'rejected',
            notes: existing?.notes ? `${record}\n${existing.notes}` : record,
            statusUpdatedAt: now,
        };
    }
    if (isWithdrawnApplication(existing)) {
        return { status: 'applied', statusUpdatedAt: now };
    }
    return {};
}

export interface SubmissionDecision {
    autoReject: boolean;
    autoRejectReason: string;
    /**
     * A knockout an earlier submission recorded decides this one: the stored
     * answers stay, and no new answer is evaluated or stored.
     */
    priorAutoReject: boolean;
    /** Whether the employer and the candidate are emailed: a new application, not a knockout or a repeat. */
    isNewSubmission: boolean;
    statusFields: ApplicationStatusFields;
}

/**
 * What a submission does, given the row it lands on (null for a first one)
 * and what its own answers decided.
 *
 *  - An application the employer already has is past the intake screening.
 *    Submitting it again refreshes what was sent, and a knockout answer in
 *    the refresh is not an automatic rejection: it would turn an interview
 *    into 'rejected' and write over the employer's notes. Nothing different
 *    is reported to the candidate, so a resubmission cannot be used to find
 *    out which answer a rule turns down.
 *  - An application a knockout already turned down keeps the answers that
 *    did it. Overwriting them, and reporting the new answers' outcome, let a
 *    candidate resubmit until an answer passed and so learn the rule.
 *    Withdrawing does not undo it: the withdrawal keeps the knockout's bare
 *    record (lib/applications/auto-reject.ts notesAfterWithdrawal), and
 *    applying again after it is the same knockout, with no answer evaluated.
 *  - A row the candidate only tracked ("I applied", no consent) was never
 *    sent to the employer, so submitting over it is a first submission.
 */
export function decideSubmission(
    existing: ExistingApplicationState | null,
    fresh: { autoReject: boolean; autoRejectReason: string },
    questions: readonly { questionText: string }[],
    now: Date = new Date(),
): SubmissionDecision {
    const wasWithdrawn = isWithdrawnApplication(existing);
    const wasSubmitted = !!existing && (existing.consentGiven === true || existing.sourceUrl === 'platform');

    let { autoReject, autoRejectReason } = fresh;
    if (autoReject && wasSubmitted && !wasWithdrawn) {
        autoReject = false;
        autoRejectReason = '';
    }

    const priorAutoReject =
        !!existing && hasAutoRejectRecord(existing.notes) && (existing.status === 'rejected' || wasWithdrawn);
    if (priorAutoReject) {
        autoReject = true;
        autoRejectReason = storedAutoRejectReason(existing!.notes!, questions);
    }

    let statusFields: ApplicationStatusFields;
    if (priorAutoReject) {
        // A withdrawn knockout comes back as what it was; a rejected one stays as it is.
        statusFields = wasWithdrawn ? { status: 'rejected', statusUpdatedAt: now } : {};
    } else {
        statusFields = buildApplicationStatusFields(existing, autoReject, autoRejectReason, now);
    }

    return {
        autoReject,
        autoRejectReason,
        priorAutoReject,
        isNewSubmission: !autoReject && (!wasSubmitted || wasWithdrawn),
        statusFields,
    };
}
