/**
 * Whether a conversation shows a job seeker's surname to an employer.
 *
 * The talent pool shows an employer first name and last initial. The full
 * name comes with an unlock (a ProfileView row, which spends a credit) or an
 * application to one of the employer's own jobs, which the applicants view
 * names in full. A thread shows no more: until one of those holds, or the
 * candidate writes in that conversation, the employer sees "Anna N." and no
 * company. A new thread already needs an unlock or an application
 * (mayOpenThreadWith in app/api/employer/messages/route.ts); a thread opened
 * before that check may have neither. The candidate's own view, an admin's,
 * and every other pairing are unchanged.
 * tests/api/conversation-surname-disclosure.test.ts
 */
import { prisma } from '@/lib/prisma';
import { employerJobOwnershipBranches, type EmployerJobOwner } from '@/lib/employer-ownership';

export interface Counterpart {
    /** user_profiles.id, the sender id on messages. */
    readonly id: string;
    /** The Supabase id, held by ProfileView.candidateId and JobApplication.userId. */
    readonly supabaseId: string;
    readonly role: string;
}

export interface SurnameEvidence {
    /** The counterpart has sent a message in this conversation. */
    readonly counterpartHasWritten: boolean;
    /** The viewer has unlocked the counterpart's profile. */
    readonly viewerUnlocked: boolean;
    /** The counterpart applied to one of the viewer's own jobs. */
    readonly counterpartApplied: boolean;
}

const NO_EVIDENCE: SurnameEvidence = { counterpartHasWritten: false, viewerUnlocked: false, counterpartApplied: false };

export function showsSurname(viewerRole: string, counterpartRole: string, evidence: SurnameEvidence): boolean {
    if (viewerRole !== 'employer' || counterpartRole !== 'job_seeker') return true;
    return evidence.counterpartHasWritten || evidence.viewerUnlocked || evidence.counterpartApplied;
}

export type SurnameCheck = (conversationId: string | null, counterpart: Counterpart) => boolean;

const writerKey = (conversationId: string, senderId: string): string => `${conversationId}:${senderId}`;
const unique = (values: readonly string[]): string[] => [...new Set(values)];

async function unlockedCandidates(viewerId: string, candidateIds: string[]): Promise<Set<string>> {
    const rows = await prisma.profileView.findMany({
        where: { viewerId, candidateId: { in: candidateIds } },
        select: { candidateId: true },
    });
    return new Set(rows.map((row) => row.candidateId));
}

/** Applicants to the viewer's jobs, owned as the applicants view and mayOpenThreadWith own them. */
async function applicantsOf(user: EmployerJobOwner, candidateIds: string[]): Promise<Set<string>> {
    const rows = await prisma.jobApplication.findMany({
        where: { userId: { in: candidateIds }, job: { employerJobs: { OR: employerJobOwnershipBranches(user) } } },
        select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
}

async function writersByConversation(conversationIds: string[], senderIds: string[]): Promise<Set<string>> {
    if (conversationIds.length === 0) return new Set();
    const rows = await prisma.employerMessage.groupBy({
        by: ['conversationId', 'senderId'],
        where: { conversationId: { in: conversationIds }, senderId: { in: senderIds } },
    });
    return new Set(rows.flatMap((row) => (row.conversationId ? [writerKey(row.conversationId, row.senderId)] : [])));
}

/**
 * Everything showsSurname needs for a page of conversations, in three
 * queries, run only when an employer has a job seeker on the page. A message
 * with no conversation (legacy rows) counts no candidate message as written.
 */
export async function loadSurnameCheck(
    viewer: { readonly user: EmployerJobOwner; readonly role: string },
    threads: ReadonlyArray<{ readonly conversationId: string | null; readonly counterpart: Counterpart }>,
): Promise<SurnameCheck> {
    const limited = threads.filter((t) => !showsSurname(viewer.role, t.counterpart.role, NO_EVIDENCE));
    if (limited.length === 0) return () => true;

    const candidateIds = unique(limited.map((t) => t.counterpart.supabaseId));
    const [unlocked, applied, writers] = await Promise.all([
        unlockedCandidates(viewer.user.id, candidateIds),
        applicantsOf(viewer.user, candidateIds),
        writersByConversation(
            unique(limited.flatMap((t) => (t.conversationId ? [t.conversationId] : []))),
            unique(limited.map((t) => t.counterpart.id)),
        ),
    ]);

    return (conversationId, counterpart) => showsSurname(viewer.role, counterpart.role, {
        counterpartHasWritten: conversationId !== null && writers.has(writerKey(conversationId, counterpart.id)),
        viewerUnlocked: unlocked.has(counterpart.supabaseId),
        counterpartApplied: applied.has(counterpart.supabaseId),
    });
}
