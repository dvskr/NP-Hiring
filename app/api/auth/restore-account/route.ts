import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { verifyCsrf } from '@/lib/csrf';

/** EmailSend statuses the Resend webhook writes for an address that cannot or must not be mailed. */
const UNDELIVERABLE_SEND_STATUSES = ['bounced', 'complained'];

/**
 * Whether the address carries a suppression of its own, apart from the one
 * the deletion set: its mailing list entry is suppressed (a bounce, a
 * complaint or an unsubscribe, which the Resend webhook and the unsubscribe
 * routes record there with a reason), or an email to it bounced or drew a
 * complaint (EmailSend status, which also covers an address with no entry).
 *
 * The profile's own flag cannot tell: the deletion sets emailSuppressed and
 * overwrites emailSuppressedAt whatever they were. The address is matched as
 * stored and lowercased, the form every suppression writer uses.
 */
async function hasSuppressionOfItsOwn(email: string): Promise<boolean> {
    const addresses = [...new Set([email, email.toLowerCase()])];
    const [suppressedLead, undeliverableSend] = await Promise.all([
        prisma.emailLead.findFirst({ where: { email: { in: addresses }, isSuppressed: true }, select: { id: true } }),
        prisma.emailSend.findFirst({
            where: { to: { in: addresses }, status: { in: UNDELIVERABLE_SEND_STATUSES } },
            select: { id: true },
        }),
    ]);
    return suppressedLead !== null || undeliverableSend !== null;
}

/**
 * POST /api/auth/restore-account — undo a soft-delete during the
 * 30-day grace window. The user must have a valid Supabase session
 * (we don't destroy auth identities until the hard-purge cron runs)
 * and the profile must still have `deleted_at` set.
 *
 * The deletion suppressed the profile's email. A restore lifts only that:
 * an address that bounced, drew a complaint or unsubscribed before or
 * during the window stays suppressed, so a restore never mails it again.
 */
export async function POST(request: NextRequest) {
    const rateLimited = await rateLimit(request, 'restore-account', {
        limit: 5,
        windowSeconds: 3600,
    });
    if (rateLimited) return rateLimited;

    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    try {
        const supabase = await createClient();
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const profile = await prisma.userProfile.findUnique({
            where: { supabaseId: user.id },
            select: { id: true, email: true, deletedAt: true, purgeAt: true },
        });
        if (!profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }
        if (!profile.deletedAt) {
            return NextResponse.json({ error: 'Account is not in a deleted state' }, { status: 400 });
        }
        if (profile.purgeAt && profile.purgeAt.getTime() < Date.now()) {
            return NextResponse.json(
                { error: 'Grace period has lapsed; account cannot be restored' },
                { status: 410 },
            );
        }

        const keepSuppression = await hasSuppressionOfItsOwn(profile.email);
        await prisma.userProfile.update({
            where: { id: profile.id },
            data: {
                deletedAt: null,
                purgeAt: null,
                profileVisible: true,
                openToOffers: true,
                ...(keepSuppression ? {} : { emailSuppressed: false, emailSuppressedAt: null }),
            },
        });

        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
        await logAudit({
            action: 'account.restore',
            actorType: 'user',
            actorId: profile.id,
            targetType: 'user',
            targetId: profile.id,
            ip,
            userAgent: request.headers.get('user-agent'),
            metadata: { emailSuppressionKept: keepSuppression },
        });

        return NextResponse.json({ success: true, message: 'Account restored' });
    } catch (err) {
        logger.error('Restore account error', err);
        return NextResponse.json({ error: 'Failed to restore account' }, { status: 500 });
    }
}
