/**
 * What an employer sees of a job seeker before the job seeker is disclosed to
 * them, decided here for every employer surface.
 *
 * Disclosure is an unlock (a ProfileView row, which spends a credit), an
 * application to one of the employer's own jobs (the applicants view names
 * an applicant in full), or, in a conversation, a message the candidate
 * wrote in it. Until one holds:
 *   - showsSurname: a conversation names the candidate by first name and last
 *     initial, as the talent pool does, with no company. A new thread already
 *     needs an unlock or an application (mayOpenThreadWith in
 *     app/api/employer/messages/route.ts); a thread opened before that check
 *     may have neither.
 *   - showsPhoto (owner, 2026-11-25): no surface shows the photo. The talent
 *     pool, the AI talent search, saved candidates, a candidate's page, the
 *     inbox and a thread send avatarUrl null, and the employer UI draws
 *     initials. The applicants view is unchanged: everyone in it applied. Any
 *     new employer surface that shows a candidate, an employer email or
 *     connector included, takes the photo through this rule.
 *   - showsConversationLicenseStates (owner, 2026-11-25): a conversation
 *     carries license states, posting-tier data in the talent pool
 *     (lib/candidate-pool.ts), only to an employer with an active posting.
 * The candidate's own view, an admin's, and every other pairing are
 * unchanged.
 * tests/api/conversation-surname-disclosure.test.ts,
 * tests/api/candidate-photo-disclosure.test.ts
 */
import { prisma } from '@/lib/prisma';
import { employerJobOwnershipBranches, type EmployerJobOwner } from '@/lib/employer-ownership';
import { getEmployerActivePostings } from '@/lib/tier-limits';

export interface Counterpart {
    /** user_profiles.id, the sender id on messages. */
    readonly id: string;
    /** The Supabase id, held by ProfileView.candidateId and JobApplication.userId. */
    readonly supabaseId: string;
    readonly role: string;
}

export interface DisclosureEvidence {
    /** The counterpart has sent a message in this conversation. */
    readonly counterpartHasWritten: boolean;
    /** The viewer has unlocked the counterpart's profile. */
    readonly viewerUnlocked: boolean;
    /** The counterpart applied to one of the viewer's own jobs. */
    readonly counterpartApplied: boolean;
}

const NO_EVIDENCE: DisclosureEvidence = { counterpartHasWritten: false, viewerUnlocked: false, counterpartApplied: false };

/** Every talent pool read is of job seekers (talentPoolWhere in lib/candidate-pool.ts). */
const POOL_MEMBER_ROLE = 'job_seeker';

/** The one pairing these rules limit: an employer looking at a job seeker. */
function isLimitedPairing(viewerRole: string, counterpartRole: string): boolean {
    return viewerRole === 'employer' && counterpartRole === POOL_MEMBER_ROLE;
}

function isDisclosed(evidence: DisclosureEvidence): boolean {
    return evidence.counterpartHasWritten || evidence.viewerUnlocked || evidence.counterpartApplied;
}

export function showsSurname(viewerRole: string, counterpartRole: string, evidence: DisclosureEvidence): boolean {
    return !isLimitedPairing(viewerRole, counterpartRole) || isDisclosed(evidence);
}

/** PHOTOS ARE LOCKED UNTIL UNLOCK: the photo needs the evidence the surname needs. */
export function showsPhoto(viewerRole: string, counterpartRole: string, evidence: DisclosureEvidence): boolean {
    return !isLimitedPairing(viewerRole, counterpartRole) || isDisclosed(evidence);
}

/** The avatarUrl a response carries: the photo once shown, else null, which the employer UI draws as initials. */
export function disclosedPhoto(avatarUrl: string | null | undefined, shown: boolean): string | null {
    return shown && avatarUrl ? avatarUrl : null;
}

/**
 * License states in a conversation. Threads opened before the reach check of
 * 2026-10-20 carried them to any employer, whatever the employer's access.
 */
export function showsConversationLicenseStates(
    viewerRole: string,
    counterpartRole: string,
    evidence: DisclosureEvidence,
    viewerHasActivePosting: boolean,
): boolean {
    return !isLimitedPairing(viewerRole, counterpartRole) || viewerHasActivePosting || isDisclosed(evidence);
}

type Viewer = { readonly user: EmployerJobOwner; readonly role: string };
type Thread = { readonly conversationId: string | null; readonly counterpart: Counterpart };
type EvidenceLookup = (conversationId: string | null, counterpart: Counterpart) => DisclosureEvidence;

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
 * The evidence for a page of conversations, in three queries, run only when
 * an employer has a job seeker on the page. A message with no conversation
 * (legacy rows) counts no candidate message as written.
 */
async function loadConversationEvidence(viewer: Viewer, threads: ReadonlyArray<Thread>): Promise<EvidenceLookup> {
    const limited = threads.filter((t) => isLimitedPairing(viewer.role, t.counterpart.role));
    if (limited.length === 0) return () => NO_EVIDENCE;

    const candidateIds = unique(limited.map((t) => t.counterpart.supabaseId));
    const [unlocked, applied, writers] = await Promise.all([
        unlockedCandidates(viewer.user.id, candidateIds),
        applicantsOf(viewer.user, candidateIds),
        writersByConversation(
            unique(limited.flatMap((t) => (t.conversationId ? [t.conversationId] : []))),
            unique(limited.map((t) => t.counterpart.id)),
        ),
    ]);

    return (conversationId, counterpart) => ({
        counterpartHasWritten: conversationId !== null && writers.has(writerKey(conversationId, counterpart.id)),
        viewerUnlocked: unlocked.has(counterpart.supabaseId),
        counterpartApplied: applied.has(counterpart.supabaseId),
    });
}

export type SurnameCheck = (conversationId: string | null, counterpart: Counterpart) => boolean;

/** The surname alone, for the employer's sent list, which shows no photo or license states. */
export async function loadSurnameCheck(viewer: Viewer, threads: ReadonlyArray<Thread>): Promise<SurnameCheck> {
    const evidenceFor = await loadConversationEvidence(viewer, threads);
    return (conversationId, counterpart) => showsSurname(viewer.role, counterpart.role, evidenceFor(conversationId, counterpart));
}

export interface ConversationDisclosure {
    /** Full name and company, else first name and last initial (participant-name.ts). */
    readonly surname: boolean;
    readonly photo: boolean;
    readonly licenseStates: boolean;
}

export type ConversationDisclosureCheck = (conversationId: string, counterpart: Counterpart) => ConversationDisclosure;

/**
 * What the inbox and a thread show of the other participant: the evidence
 * above and, when an employer has a job seeker on the page, whether the
 * employer has an active posting (the talent pool's posting tier).
 */
export async function loadConversationDisclosure(
    viewer: Viewer,
    threads: ReadonlyArray<Thread>,
): Promise<ConversationDisclosureCheck> {
    const limited = threads.some((t) => isLimitedPairing(viewer.role, t.counterpart.role));
    const [evidenceFor, hasActivePosting] = await Promise.all([
        loadConversationEvidence(viewer, threads),
        limited ? getEmployerActivePostings(viewer.user.id).then((postings) => postings.length > 0) : false,
    ]);
    return (conversationId, counterpart) => {
        const evidence = evidenceFor(conversationId, counterpart);
        return {
            surname: showsSurname(viewer.role, counterpart.role, evidence),
            photo: showsPhoto(viewer.role, counterpart.role, evidence),
            licenseStates: showsConversationLicenseStates(viewer.role, counterpart.role, evidence, hasActivePosting),
        };
    };
}

export type PhotoCheck = (candidateSupabaseId: string) => boolean;

/**
 * The photo rule where there is no conversation: the talent pool, the AI
 * talent search, saved candidates and a candidate's page. Two queries for an
 * employer's page of pool members, none for an admin.
 */
export async function loadPhotoCheck(viewer: Viewer, candidateSupabaseIds: readonly string[]): Promise<PhotoCheck> {
    if (!isLimitedPairing(viewer.role, POOL_MEMBER_ROLE)) return () => true;
    const candidateIds = unique(candidateSupabaseIds);
    if (candidateIds.length === 0) return () => false;

    const [unlocked, applied] = await Promise.all([
        unlockedCandidates(viewer.user.id, candidateIds),
        applicantsOf(viewer.user, candidateIds),
    ]);
    return (candidateSupabaseId) => showsPhoto(viewer.role, POOL_MEMBER_ROLE, {
        counterpartHasWritten: false,
        viewerUnlocked: unlocked.has(candidateSupabaseId),
        counterpartApplied: applied.has(candidateSupabaseId),
    });
}
