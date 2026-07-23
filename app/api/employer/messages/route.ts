import { NextRequest, NextResponse, after } from 'next/server';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { sendEmployerMessageNotification } from '@/lib/email-service';
import { canSendInMail, getEmployerTier } from '@/lib/tier-limits';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeText } from '@/lib/sanitize';

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
                    select: { firstName: true, lastName: true, email: true },
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
            recipientName: [m.recipient.firstName, m.recipient.lastName].filter(Boolean).join(' ') || m.recipient.email || 'Unknown',
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

        const body = await req.json();
        const { recipientId, subject, body: messageBody, jobId } = body;

        if (!recipientId || !subject || !messageBody
            || typeof subject !== 'string' || typeof messageBody !== 'string') {
            return NextResponse.json({ error: 'recipientId, subject, and body are required' }, { status: 400 });
        }

        if (messageBody.length > 2000) {
            return NextResponse.json({ error: 'Message body must be under 2000 characters' }, { status: 400 });
        }

        // Look up recipient first (needed for conversation check)
        const recipient = await prisma.userProfile.findUnique({
            where: { supabaseId: recipientId },
            select: { id: true, email: true, firstName: true },
        });

        if (!recipient) {
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
            // NEW outreach — requires a featured job posting + InMail credit
            // Gate: messaging requires a featured job posting
            if (jobId) {
                const job = await prisma.job.findFirst({
                    where: {
                        id: jobId,
                        isFeatured: true,
                        employerJobs: {
                            OR: [
                                { userId: user.id },
                                { userId: null, contactEmail: user.email! },
                            ],
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
                        OR: [
                            { userId: user.id },
                            { userId: null, contactEmail: user.email! },
                        ],
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

            await tx.conversation.update({
                where: { id: conversation.id },
                data: { lastMessageAt: new Date() },
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
                    messageBody,
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
