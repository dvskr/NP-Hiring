import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { participantDisplay } from './_lib/participant-name';
import { disclosedPhoto, loadConversationDisclosure } from './_lib/surname-disclosure';
import { signAvatarUrls } from '@/lib/avatar-url';

/**
 * GET /api/conversations
 * List all conversations for the logged-in user (employer OR candidate).
 * Returns conversations with the other participant's info, last message preview, and unread count.
 */
export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const profile = await prisma.userProfile.findUnique({
            where: { supabaseId: user.id },
            select: { id: true, role: true },
        });
        if (!profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        // Find all conversations where this user is either participantA or participantB
        const conversations = await prisma.conversation.findMany({
            where: {
                OR: [
                    { participantA: profile.id, deletedByA: false },
                    { participantB: profile.id, deletedByB: false },
                ],
            },
            include: {
                userA: { select: { id: true, supabaseId: true, firstName: true, lastName: true, company: true, role: true, avatarUrl: true, headline: true, specialties: true, licenseStates: true } },
                userB: { select: { id: true, supabaseId: true, firstName: true, lastName: true, company: true, role: true, avatarUrl: true, headline: true, specialties: true, licenseStates: true } },
                job: { select: { id: true, title: true, slug: true } },
                messages: {
                    orderBy: { sentAt: 'desc' },
                    take: 1,
                    select: { body: true, sentAt: true, senderId: true },
                },
            },
            orderBy: { lastMessageAt: 'desc' },
        });

        // Get unread counts per conversation
        const unreadCounts = await prisma.employerMessage.groupBy({
            by: ['conversationId'],
            where: {
                recipientId: profile.id,
                readAt: null,
                conversationId: { not: null },
            },
            _count: { id: true },
        });

        const unreadMap = new Map(unreadCounts.map(u => [u.conversationId, u._count.id]));

        const otherOf = (conv: (typeof conversations)[number]) => (conv.participantA === profile.id ? conv.userB : conv.userA);
        // SECURITY: an employer sees a job seeker's surname, company, photo
        // and license states only once they are disclosed
        // (_lib/surname-disclosure.ts). No query for anyone else.
        const disclosure = await loadConversationDisclosure(
            { user, role: profile.role },
            conversations.map(conv => ({ conversationId: conv.id, counterpart: otherOf(conv) })),
        );
        // Both sides: only a photo the rule shows is signed, as a link that
        // expires (lib/avatar-url.ts).
        const photos = await signAvatarUrls(conversations.map(conv => {
            const otherUser = otherOf(conv);
            return {
                stored: disclosedPhoto(otherUser.avatarUrl, disclosure(conv.id, otherUser).photo),
                ownerId: otherUser.supabaseId,
            };
        }));

        const formatted = conversations.map((conv, i) => {
            const otherUser = otherOf(conv);
            const lastMsg = conv.messages[0] || null;
            const shown = disclosure(conv.id, otherUser);
            // Named without the email address (_lib/participant-name.ts).
            const { name: otherName, initials } = participantDisplay(otherUser, { showSurname: shown.surname });

            return {
                id: conv.id,
                otherUser: {
                    id: otherUser.id,
                    supabaseId: otherUser.supabaseId,
                    name: otherName,
                    // A job seeker's company names them as surely as a surname.
                    company: shown.surname ? otherUser.company : null,
                    role: otherUser.role,
                    avatarUrl: photos[i],
                    headline: otherUser.headline || null,
                    specialties: otherUser.specialties || null,
                    licenseStates: shown.licenseStates ? otherUser.licenseStates || null : null,
                    initials,
                },
                subject: conv.subject,
                jobTitle: conv.job?.title || null,
                jobSlug: conv.job?.slug || null,
                lastMessage: lastMsg ? {
                    preview: lastMsg.body.substring(0, 120) + (lastMsg.body.length > 120 ? '…' : ''),
                    sentAt: lastMsg.sentAt.toISOString(),
                    isFromMe: lastMsg.senderId === profile.id,
                } : null,
                unreadCount: unreadMap.get(conv.id) || 0,
                lastMessageAt: conv.lastMessageAt.toISOString(),
                createdAt: conv.createdAt.toISOString(),
            };
        });

        const totalUnread = Array.from(unreadMap.values()).reduce((sum, c) => sum + c, 0);

        return NextResponse.json({ conversations: formatted, totalUnread });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
