import { NextRequest, NextResponse, after } from 'next/server';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { sendEmployerMessageNotification } from '@/lib/email-service';
import { canSendInMail, getEmployerTier } from '@/lib/tier-limits';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeText } from '@/lib/sanitize';
import { employerJobOwnershipBranches, type EmployerJobOwner } from '@/lib/employer-ownership';
import { readJsonObject, validateEmployerSendPayload } from '@/app/api/conversations/_lib/message-payload';

/** What the send path reads about a recipient to decide whether it is in reach. */
interface RecipientReach {
    readonly role: string;
    readonly profileVisible: boolean;
    readonly openToOffers: boolean;
}

/**
 * Whether this employer may open a NEW thread with the recipient, through one
 * of the two places the dashboard offers it:
 *   - the candidate pool: a job seeker visible to employers and open to
 *     offers (the filter GET /api/employer/candidates applies) whose profile
 *     this employer opened. The Message button lives on that profile page,
 *     and the page records the ProfileView before it renders.
 *   - the applicants view: anyone who applied to one of this employer's own
 *     jobs, whatever their pool settings.
 * A reply in an existing thread never comes through here.
 */
async function mayOpenThreadWith(
    user: EmployerJobOwner,
    recipientSupabaseId: string,
    recipient: RecipientReach,
): Promise<boolean> {
    if (recipient.role === 'job_seeker' && recipient.profileVisible && recipient.openToOffers) {
        const opened = await prisma.profileView.findUnique({
            where: { viewerId_candidateId: { viewerId: user.id, candidateId: recipientSupabaseId } },
            select: { id: true },
        });
        if (opened) return true;
    }
    const application = await prisma.jobApplication.findFirst({
        where: {
            userId: recipientSupabaseId,
            job: { employerJobs: { OR: employerJobOwnershipBranches(user) } },
        },
        select: { id: true },
    });
    return application !== null;
}

/**
 * GET /api/employer/messages — List sent messages for the employer
 * POST /api/employer/messages — Send a new message to a candidate
 */
export async function GET(req: NextRequest) {
    try {
        const rateLimitResponse = await rateLimit(req, 'employer:messages', RATE_LIMITS.employer);
        if (rateLimitResponse) return rateLimitResponse;

        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Look up profile by Supabase ID
        const profile = await prisma.userProfile.findUnique({
            where: { supabaseId: user.id },
            select: { id: true, role: true },
        });

        if (!profile || !['employer', 'admin'].includes(profile.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const messages = await prisma.employerMessage.findMany({
            where: { senderId: profile.id },
            orderBy: { sentAt: 'desc' },
            take: 50,
            include: {
                recipient: {
                    select: { firstName: true, lastName: true },
                },
                job: {
                    select: { id: true, title: true },
                },
            },
        });

        const formatted = messages.map(m => ({
            id: m.id,
            subject: m.subject,
            body: m.body,
            sentAt: m.sentAt.toISOString(),
            readAt: m.readAt?.toISOString() || null,
            // SECURITY: an unnamed recipient is "Candidate", never the raw
            // email address this list used to fall back to. The applicants
            // view never shows an applicant's email, and the pool shows one
            // only with full profile access.
            // tests/api/employer-messages-recipient.test.ts
            recipientName: [m.recipient.firstName, m.recipient.lastName].filter(Boolean).join(' ') || 'Candidate',
            jobTitle: m.job?.title || null,
        }));

        return NextResponse.json({ messages: formatted });
    } catch (error) {
        console.error('Error fetching employer messages:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const rateLimitResponse = await rateLimit(req, 'employer:messages', RATE_LIMITS.employer);
        if (rateLimitResponse) return rateLimitResponse;

        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Look up sender profile and verify employer role
        const senderProfile = await prisma.userProfile.findUnique({
            where: { supabaseId: user.id },
            select: { id: true, firstName: true, lastName: true, company: true, role: true },
        });

        if (!senderProfile || !['employer', 'admin'].includes(senderProfile.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Type-checked payload: object-valued recipientId / jobId (Prisma
        // operator injection), malformed JSON, and oversized subjects are all
        // rejected with 400. The returned subject is already sanitized and
        // capped, so both the Conversation and EmployerMessage rows get it.
        const payload = validateEmployerSendPayload(await readJsonObject(req));
        if (!payload.ok) {
            return NextResponse.json({ error: payload.error }, { status: 400 });
        }
        const { recipientId, subject, body: messageBody, jobId } = payload.value;

        // Look up recipient first (needed for conversation check)
        const recipient = await prisma.userProfile.findUnique({
            where: { supabaseId: recipientId },
            select: {
                id: true,
                email: true,
                firstName: true,
                role: true,
                profileVisible: true,
                openToOffers: true,
                deletedAt: true,
            },
        });

        // SECURITY: an account its owner deleted is never a recipient, not
        // even for a reply in an existing thread. Deletion hides the profile
        // and stops email (app/api/auth/delete-account), yet this route
        // stored the message and emailed the address anyway. It answers
        // exactly as an unknown id does.
        // tests/api/employer-messages-recipient.test.ts
        if (!recipient || recipient.deletedAt) {
            return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
        }

        // Replies are free ONLY when the message lands in an existing thread
        // for this exact (pair, job) key — the same key the find-or-create
        // below uses. Opening a NEW thread (e.g. a new job-scoped thread to a
        // previously-contacted candidate) is new outreach: an InMail is a
        // unique conversation (see getInMailsForPosting), so it must pass the
        // featured-job gate + credit check. Previously ANY prior conversation
        // with the candidate skipped the gate, letting an employer open
        // unlimited new job-scoped threads for free.
        const existingConversation = await prisma.conversation.findFirst({
            where: {
                jobId: jobId || null,
                OR: [
                    { participantA: senderProfile.id, participantB: recipient.id },
                    { participantA: recipient.id, participantB: senderProfile.id },
                ],
            },
            select: { id: true },
        });

        if (!existingConversation) {
            // SECURITY: new outreach reaches only someone this employer may
            // contact (mayOpenThreadWith above). The recipient was never
            // checked, so an employer past the featured gate could open a
            // thread with, and email, any profile id: a seeker who hid their
            // profile or switched off "Open to offers", another employer, an
            // admin. This runs before the featured gate, so anyone out of
            // reach answers exactly as an unknown id does and the answer
            // cannot be used to probe which ids exist.
            // tests/api/employer-messages-recipient.test.ts
            if (!(await mayOpenThreadWith(user, recipientId, recipient))) {
                return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
            }

            // NEW outreach — requires a featured job posting + InMail credit
            // Gate: messaging requires a featured job posting
            if (jobId) {
                const job = await prisma.job.findFirst({
                    where: {
                        id: jobId,
                        isFeatured: true,
                        employerJobs: {
                            OR: employerJobOwnershipBranches(user),
                        },
                    },
                    select: { id: true },
                });
                if (!job) {
                    return NextResponse.json({ error: 'Messaging is available for featured job postings only' }, { status: 403 });
                }
            } else {
                const featuredJob = await prisma.employerJob.findFirst({
                    where: {
                        OR: employerJobOwnershipBranches(user),
                        job: { isFeatured: true },
                    },
                    select: { id: true },
                });
                if (!featuredJob) {
                    return NextResponse.json({ error: 'Messaging is available for featured job postings only' }, { status: 403 });
                }
            }

            // Check InMail credits for new outreach
            const tier = await getEmployerTier(user.id);
            const inmailCheck = await canSendInMail(senderProfile.id, user.id, tier);
            if (!inmailCheck.allowed) {
                return NextResponse.json({
                    error: 'InMail limit reached for this posting',
                    used: inmailCheck.used,
                    limit: inmailCheck.limit,
                    tier,
                    upgradeRequired: true,
                }, { status: 403 });
            }
        }

        // Look up job title if jobId provided
        let jobTitle: string | null = null;
        if (jobId) {
            const job = await prisma.job.findUnique({
                where: { id: jobId },
                select: { title: true },
            });
            jobTitle = job?.title || null;
        }

        // Find or create a Conversation for this sender-recipient pair, then
        // write the message + bump lastMessageAt atomically. New conversations
        // store participants in sorted order so the (participantA,
        // participantB, jobId) unique key actually dedupes; finds still check
        // both orderings because legacy rows may be unnormalized.
        const sendMessage = async () => prisma.$transaction(async (tx) => {
            let conversation = await tx.conversation.findFirst({
                where: {
                    jobId: jobId || null,
                    OR: [
                        { participantA: senderProfile.id, participantB: recipient.id },
                        { participantA: recipient.id, participantB: senderProfile.id },
                    ],
                },
            });

            if (!conversation) {
                const [participantA, participantB] = [senderProfile.id, recipient.id].sort();
                conversation = await tx.conversation.create({
                    data: {
                        participantA,
                        participantB,
                        jobId: jobId || null,
                        subject,
                    },
                });
            }

            const message = await tx.employerMessage.create({
                data: {
                    senderId: senderProfile.id,
                    recipientId: recipient.id,
                    conversationId: conversation.id,
                    subject,
                    // Same sanitizer as the reply path (POST /api/conversations/[id])
                    body: sanitizeText(messageBody.trim(), 2000),
                    ...(jobId && { jobId }),
                },
            });

            // A new message restores the thread for anyone who deleted it,
            // matching the reply route (POST /api/conversations/[id]) and the
            // candidate send route. Without clearing both flags, a candidate
            // who deleted the thread would never see the employer's follow-up:
            // GET /api/conversations filters on deletedByA / deletedByB.
            await tx.conversation.update({
                where: { id: conversation.id },
                data: { lastMessageAt: new Date(), deletedByA: false, deletedByB: false },
            });

            return { conversation, message };
        });

        const result = await sendMessage().catch(async (err: unknown) => {
            // P2002 = a concurrent request created the same (pair, job) thread
            // between our find and create, aborting the transaction. Retry once:
            // the re-find now sees the winner's row and this lands as a reply.
            if ((err as { code?: string } | null)?.code !== 'P2002') {
                throw err;
            }
            return sendMessage();
        });
        const { conversation, message } = result;

        // Send email notification (non-blocking)
        const senderName = [senderProfile.firstName, senderProfile.lastName].filter(Boolean).join(' ') || 'An employer';

        if (recipient.email) {
            // after() keeps the invocation alive until the send completes —
            // a bare fire-and-forget can be frozen with the function once the
            // response returns, silently dropping the notification.
            after(
                sendEmployerMessageNotification(
                    recipient.email,
                    recipient.firstName,
                    senderName,
                    senderProfile.company,
                    subject,
                    message.body,
                    jobTitle
                ).catch(err => logger.error('Email notification error', err))
            );
        }

        return NextResponse.json({
            success: true,
            message: {
                id: message.id,
                sentAt: message.sentAt.toISOString(),
            },
            conversationId: conversation.id,
        });
    } catch (error) {
        console.error('Error sending employer message:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
