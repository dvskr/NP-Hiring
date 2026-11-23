/**
 * The record an automatic knockout rejection leaves on an application.
 *
 * A knockout writes its reason at the top of the application's notes, under
 * a fixed prefix. Notes are also where the employer types, so the prefix is
 * the only part the site treats as its own: the reason given back to a
 * candidate is rebuilt from the job's own questions, never read out of the
 * notes.
 *
 * Withdrawing scrubs the notes (the candidate's right to erasure), but keeps
 * the bare prefix on a row a knockout rejected: without it, withdrawing and
 * applying again evaluated the answers afresh, so a candidate could try
 * answers until one passed. The prefix is system text and says nothing of
 * the candidate or the employer.
 */

export const AUTO_REJECT_NOTE_PREFIX = 'Auto-rejected: ';

/** Told to a candidate when the stored reason can no longer be vouched for. */
export const GENERIC_AUTO_REJECT_REASON = 'Does not meet a requirement for this role';

export function requirementReason(questionText: string): string {
  return `Does not meet requirement: ${questionText}`;
}

/** True when the notes carry a knockout's record. */
export function hasAutoRejectRecord(notes: string | null | undefined): boolean {
  return (notes ?? '').startsWith(AUTO_REJECT_NOTE_PREFIX);
}

/**
 * The reason to give a candidate who applies again after a knockout: the
 * longest of the job's own requirement reasons the stored record begins with
 * (one question's text may begin another's), or the general reason when the
 * record names none any more. Anything an employer added, on the same line
 * or below it, stays private.
 */
export function storedAutoRejectReason(notes: string, questions: readonly { questionText: string }[]): string {
  const stored = notes.slice(AUTO_REJECT_NOTE_PREFIX.length);
  const reasons = questions
    .map((question) => requirementReason(question.questionText))
    .filter((reason) => stored.startsWith(reason))
    .sort((a, b) => b.length - a.length);
  return reasons[0] ?? GENERIC_AUTO_REJECT_REASON;
}

/**
 * What a withdrawal leaves in the notes: the bare prefix where a knockout
 * rejected the application and it is still rejected, nothing otherwise. A
 * rejection the employer has since overturned (the row moved on) leaves
 * nothing either.
 */
export function notesAfterWithdrawal(application: { status: string; notes: string | null }): string | null {
  return application.status === 'rejected' && hasAutoRejectRecord(application.notes) ? AUTO_REJECT_NOTE_PREFIX : null;
}
