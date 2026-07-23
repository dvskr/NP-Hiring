import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { brand } from '@/config/brand';
import { rateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
    emailShellV2, headerBlockV2, primaryButtonV2,
    spacerV2, closeContentV2, noteCardV2,
    V2, SANS, SERIF,
} from '@/lib/email-templates-v2';
import { sendAndLog } from '@/lib/email-service';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

/**
 * POST /api/auth/forgot-password
 *
 * B72 (2026-07-18): previously this wrapped the anon-client
 * `resetPasswordForEmail`, which relies on Supabase's own email delivery —
 * the same delivery the confirmation flow already bypasses because it is
 * broken (see /api/auth/send-confirmation: "Bypasses Supabase's broken
 * email sending"). Reset emails silently never arrived and there was zero
 * observability. Now we mirror the confirmation flow:
 *   1. Supabase admin API `generateLink({ type: 'recovery' })` mints the
 *      recovery link WITHOUT sending any email.
 *   2. We deliver it ourselves via Resend through sendAndLog, which logs an
 *      EmailSend row (status tracked by the Resend webhook) and records
 *      status='failed' + throws on API-level failures — so delivery is
 *      observable end to end.
 *
 * The response is intentionally identical for "email exists" and "email
 * doesn't exist" — leaking the difference would let an attacker
 * enumerate valid accounts. Always returns 200 unless the request is
 * malformed or rate-limited.
 */
const bodySchema = z.object({
    email: z.string().email().max(254),
    redirectTo: z.string().url().optional(),
});

/**
 * Sec2 fix (2026-06-01): only allow first-party origins for the
 * password-reset redirect. Pre-fix the body's `redirectTo` was passed
 * straight to Supabase, which embedded it in the reset email link as
 * `?next=` — any URL was accepted, so an attacker could craft a reset
 * link that, after a successful login, bounced the user to
 * `https://evil.example.com?token=…` for phishing or session theft.
 *
 * Allow-list: production canonical + Vercel preview deployments + local
 * dev. Anything else is silently dropped (falls back to our own
 * /auth/confirm recovery handler).
 */
const ALLOWED_REDIRECT_HOSTS: ReadonlySet<string> = new Set([
    brand.domain,
    `www.${brand.domain}`,
    'localhost',
]);

function safeRedirectOrigin(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    try {
        const u = new URL(raw);
        if (u.hostname.endsWith('.vercel.app')) return raw;  // preview deploys
        if (ALLOWED_REDIRECT_HOSTS.has(u.hostname)) return raw;
        logger.warn('forgot-password: rejected redirectTo with unknown host', { host: u.hostname });
        return undefined;
    } catch {
        return undefined;
    }
}

function buildResetEmailHtml(resetUrl: string): string {
    return emailShellV2(`
      ${headerBlockV2('Reset Your Password', 'One click to choose a new one')}
      ${spacerV2(8)}
      <tr><td class="content-pad" style="padding:0 40px;">
        <p style="margin:0 0 24px;font-family:${SERIF};font-size:19px;color:${V2.textBody};line-height:1.6;">
          We received a request to reset the password for your ${brand.name} account. Click the button below to choose a new password.
        </p>
      </td></tr>
      <tr><td class="content-pad" style="padding:0 40px;text-align:center;">
        ${primaryButtonV2('Reset My Password', resetUrl)}
      </td></tr>
      ${spacerV2(24)}
      ${noteCardV2(`
        <p style="margin:0;font-family:${SANS};font-size:13px;color:${V2.textMuted};line-height:1.6;">
          This link can only be used once and expires shortly. If it has expired, you can request a new one from the forgot-password page.
        </p>
      `)}
      ${spacerV2(48)}
      ${closeContentV2()}`,
        `<p style="margin:0;font-family:${SANS};font-size:12px;color:${V2.textMuted};">
        If you didn’t request a password reset, you can safely ignore this email — your password won’t change.
      </p>`,
        `Reset your ${brand.name} password — one click to choose a new one.`
    );
}

export async function POST(request: NextRequest) {
    const limited = await rateLimit(request, 'forgot-password', {
        limit: 3,
        windowSeconds: 3600,
    });
    if (limited) return limited;

    let parsed: z.infer<typeof bodySchema>;
    try {
        parsed = bodySchema.parse(await request.json());
    } catch {
        return NextResponse.json(
            { error: 'Invalid request' },
            { status: 400 },
        );
    }

    // Identical 200 OK response shape regardless of outcome (enumeration-safe).
    const genericOk = () => NextResponse.json({
        ok: true,
        message: 'If an account exists for that email, a reset link has been sent.',
    });

    const normalizedEmail = parsed.email.toLowerCase();

    try {
        // Default to our own recovery handler: /auth/confirm parses both PKCE
        // (?code=) and implicit (#access_token) recovery redirects and routes
        // to /reset-password. The client normally sends exactly this URL; the
        // fallback covers a rejected/absent redirectTo.
        const redirectTo =
            safeRedirectOrigin(parsed.redirectTo)
            ?? `${BASE_URL}/auth/confirm?type=recovery`;

        const supabaseAdmin = createAdminClient();
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: 'recovery',
            email: normalizedEmail,
            options: { redirectTo },
        });

        if (error) {
            // "User not found" is the expected path for unknown emails — log at
            // info so it doesn't page anyone; anything else is a real failure.
            const notFound = error.status === 404
                || /not.*found/i.test(error.message || '');
            if (notFound) {
                logger.info('forgot-password: no account for requested email');
            } else {
                logger.error('forgot-password: generateLink failed', error);
            }
            return genericOk();
        }

        const resetUrl = data?.properties?.action_link;
        if (!resetUrl) {
            logger.error('forgot-password: no action_link in generateLink response');
            return genericOk();
        }

        // Never log the action_link itself — it is a live one-click
        // password-reset credential; anyone with log access could hijack the
        // account before the user clicks it.
        logger.info('forgot-password: recovery link generated', { email: normalizedEmail });

        // Password reset is transactional and account-critical — like the
        // confirmation email, it deliberately does NOT honor the marketing
        // suppression list. sendAndLog records the EmailSend row (webhook
        // updates its status) and throws on Resend API failure, which we log
        // below — that failure surface is the observability the old
        // Supabase-delivered flow never had.
        await sendAndLog({
            from: '', // overridden by sendAndLog (transactional sender)
            to: normalizedEmail,
            subject: `Reset your ${brand.name} password`,
            html: buildResetEmailHtml(resetUrl),
        }, 'password_reset', { flow: 'forgot_password' });

        logger.info('forgot-password: reset email sent via Resend', { email: normalizedEmail });
    } catch (err) {
        // Send/infra failure — loudly logged (Sentry picks up logger.error),
        // but the response stays generic so failures can't be used to probe
        // for account existence.
        logger.error('forgot-password: reset email delivery failed', err);
    }

    return genericOk();
}
